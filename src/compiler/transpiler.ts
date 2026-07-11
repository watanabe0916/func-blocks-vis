import { ASTNode, ExpressionNode, IfNode, WhileNode } from './types';
import { FExpr, FProgram, FPrint, canonicalVarId } from './functionalAst';

/**
 * ①手続型AST → ②関数型ASTへの変換のみを行う（CLAUDE.md §4.4）。
 * 評価ロジック（force/BUILTINS等）は一切持たず、評価器（evaluator.ts）へ
 * 完全に委譲する。SSAバージョニング（変数再代入時の新環境生成）は
 * 本ステージの責務のまま維持し、`Let` ノードの生成規則として表現する。
 *
 * 各Assign文はネストした `Let` を構築し、全Print文を集めた1つの `Do` で
 * 終端する（`let x_1 = .. in let x_2 = .. in do { print ..; print .. }`
 * という direct style の入れ子。CLAUDE.md §2の評価戦略と一致）。
 * Print文はどこに書かれていても、この終端の `Do` へ元の記述順のまま
 * 集約される（＝需要の根はプログラム全体で単一。評価器の需要駆動評価と対応）。
 *
 * if-else文（§5.1）の変換規則:
 * - 分岐内で代入された各変数 v に対し、合流点でφ束縛
 *   `let v_new = If(cond, v_then版, v_else版)` を生成する。SSAのφ関数は
 *   三項演算子の返り値そのものが担う（diamond型の値合流。
 *   Appel "SSA is Functional Programming" の対応）。
 * - 分岐内の束縛は合流点より前へ「巻き上げ」て平坦なLet連鎖に並べる。
 *   call-by-need では束縛＝評価ではない（LaunchburyのLET規則はヒープへの
 *   割り当てのみ）ため、選ばれなかった分岐の束縛には需要が届かず未評価の
 *   まま残る。正格言語では不健全なこの変換が、§3の意味論の下では健全になる。
 * - 条件式はφが複数あるとき合成束縛 `%cond_n` として一度だけlet束縛し、
 *   各φから変数参照させて共有する（条件式の複製は同一計算の多重評価＝
 *   sharing違反とグラフノードの重複を招く。Launchburyの正規化「適用の
 *   引数は変数でなければならない」への対応でもある）。
 * - 分岐内のPrintは現行スコープでは未対応とし、明示エラーを投げる
 *   （需要の根が条件付きになり、無条件のPrint列であるDoの意味論を超えるため）。
 *
 * while文（§5.2）の変換規則（transform.md §1 の (a)〜(c)）:
 * - (a) ループ本体は letrec による自己参照関数（%loop_n）として表現する
 *   （基本ブロック＝関数、ジャンプ＝末尾呼び出し、[S]§2.1）。
 * - (b) ループ内で再代入される変数はその関数の仮引数とする。初回呼び出しの
 *   実引数はループ突入前の版、末尾自己呼び出しの実引数は各周回での更新後の
 *   版——これが「ループ先頭のφ = 仮引数」（[K]§4・[M]§8.1・[S]の一致した知見。
 *   §5.1のdiamond型φ＝三項演算子とは異なり、ループ先頭のφは三項演算子では
 *   表現できない）。
 * - (c) ループ内で再代入されないループ不変変数は仮引数にせず、外側スコープの
 *   自由変数として閉包に捕捉させる（[M]§3の貢献。エッジ数の線形性にも寄与）。
 * - 複数のループ変数を持つwhileの出口値は入れ子の対（Pair）で返し、合流後の
 *   新しい版は %r_n から射影（Proj）して束縛する。%r_n を一度だけlet束縛して
 *   から射影するのは、Launchburyの正規化「適用の引数は変数」への対応
 *   （launchbury.md §1・§2.3。射影式が複製されても対の中の同一Thunkを
 *   共有するため再計算は起きない）。
 * - 分岐内Printと同じ理由でループ内Printは未対応（明示エラー）。ループの
 *   入れ子（whileの中のwhile）は式レベルletrecが必要になるため現行スコープ
 *   では未対応とし、明示エラーを投げる（if分岐の中のwhileは、束縛の巻き上げに
 *   よりプログラムレベルに現れるため対応済み）。
 *
 * なお、Blocklyの入力は構造化制御フロー（if/whileはブロックの入れ子）で
 * あり任意のgotoを持たないため、[K][M]（transform.md）が扱う支配木
 * （dominator tree）計算は不要である。構文の入れ子に沿って束縛を生成
 * すればスコープの正しさは自動的に保証される（transform.md §1-3）。
 */
export function transpileToFunctionalAst(ast: ASTNode[]): FProgram {
    let idCounter = 0;
    const nextId = (prefix: string) => `${prefix}_${idCounter++}`;

    // SSA版数管理は2層に分離する（§5.1導入に伴う一般化）:
    // - versionCounter: 変数ごとの単調増加カウンタ。分岐に入っても決して
    //   巻き戻さない。これが適格性述語「SSA束縛名に重複がないこと」
    //   （transform.md §2、transpiler.test.ts）を構造的に保証する。
    // - current: 「いま参照すべき版」。then/else で独立に進行し、
    //   合流点でφの新しい版に置き換わる。版0＝未束縛（⊥、§3.6）。
    const versionCounter: Record<string, number> = {};
    let current: Record<string, number> = {};
    const nextVersion = (name: string) => {
        versionCounter[name] = (versionCounter[name] || 0) + 1;
        return versionCounter[name];
    };

    const buildFExpr = (expr: ExpressionNode | undefined): FExpr => {
        if (!expr) {
            // 空のソケット（未接続の入力）。安全な既定値を割り当てる。
            return { kind: 'Lit', id: nextId('lit'), value: 0 };
        }
        if (expr.type === 'Literal') {
            return { kind: 'Lit', id: nextId('lit'), value: expr.value };
        }
        if (expr.type === 'Var') {
            // 現在のSSAバージョンを名前に埋め込む。未束縛かどうかの判定は
            // ここでは一切行わず（AST層の関心事ではない）、評価器（§3.6）に
            // 一本化する。
            const name = `${expr.name}_${current[expr.name] || 0}`;
            return { kind: 'Var', id: nextId('var'), name };
        }
        // Apply（算術・比較・論理演算は第一級関数適用として統一的に扱う）
        return {
            kind: 'PrimApp',
            id: nextId(`op_${expr.op.toLowerCase()}`),
            op: expr.op,
            args: expr.args.map(buildFExpr),
        };
    };

    type Binding =
        | { kind: 'plain'; id: string; name: string; value: FExpr }
        | { kind: 'rec'; id: string; name: string; params: string[]; fnBody: FExpr };
    type Ctx = { topLevel: boolean; inLoop: boolean };
    const prints: FPrint[] = [];

    // 手続型ASTの文列を静的に走査し、代入される変数名を出現順に収集する
    // （whileのループ変数＝仮引数の決定に使う。transform.md (b)）。
    const collectAssignedVars = (stmts: ASTNode[], acc: string[] = []): string[] => {
        stmts.forEach((s) => {
            if (s.type === 'Assign') {
                if (!acc.includes(s.var)) acc.push(s.var);
            } else if (s.type === 'If') {
                collectAssignedVars(s.then, acc);
                collectAssignedVars(s.else, acc);
            } else if (s.type === 'While') {
                collectAssignedVars(s.body, acc);
            }
        });
        return acc;
    };

    const processIf = (stmt: IfNode, bindings: Binding[], ctx: Ctx): void => {
        // 条件式は分岐前の版を参照して構築する。
        const condExpr = buildFExpr(stmt.cond);
        const saved = { ...current };

        const branchCtx: Ctx = { topLevel: false, inLoop: ctx.inLoop };
        const thenBindings: Binding[] = [];
        processStmts(stmt.then, thenBindings, branchCtx);
        const thenCurrent = current;

        current = { ...saved };
        const elseBindings: Binding[] = [];
        processStmts(stmt.else, elseBindings, branchCtx);
        const elseCurrent = current;

        current = { ...saved };

        // φ対象 = いずれかの分岐で版が進行した（＝代入された）変数。
        const phiVars: string[] = [];
        const consider = (branchCurrent: Record<string, number>) => {
            Object.keys(branchCurrent).forEach((v) => {
                if ((branchCurrent[v] || 0) !== (saved[v] || 0) && !phiVars.includes(v)) {
                    phiVars.push(v);
                }
            });
        };
        consider(thenCurrent);
        consider(elseCurrent);

        if (phiVars.length === 0) {
            // どちらの分岐も何も束縛しないif-elseは観測可能な効果を持たず、
            // 需要が発生しえないため何も生成しない（需要駆動の帰結）。
            return;
        }

        // 条件式の参照方法を決定する（上記docコメントの共有規則）。
        // - 条件が最初からVarなら既存の束縛を参照するだけで共有される。
        // - φが1つだけなら参照は1回きりなので直接埋め込んでよい。
        // - φが複数なら合成束縛 %cond_n を作って共有する。%cond は
        //   versionCounter を通常変数と共有するため名前は衝突しない。
        //   current には登録しない（ユーザー変数の参照解決を汚染しない）。
        let condRef: () => FExpr;
        if (condExpr.kind === 'Var') {
            const condName = condExpr.name;
            condRef = () => ({ kind: 'Var', id: nextId('var'), name: condName });
        } else if (phiVars.length === 1) {
            condRef = () => condExpr;
        } else {
            const condName = `%cond_${nextVersion('%cond')}`;
            bindings.push({ kind: 'plain', id: canonicalVarId(condName), name: condName, value: condExpr });
            condRef = () => ({ kind: 'Var', id: nextId('var'), name: condName });
        }

        // 分岐内の束縛を巻き上げる（then→elseの順。互いを参照することは
        // ない——else側の構築時に current は分岐前へ巻き戻されている）。
        bindings.push(...thenBindings, ...elseBindings);

        // φ束縛の生成。片側の分岐でしか代入されなかった変数の反対側の腕は
        // 分岐前の版（未代入なら版0＝未束縛⊥）を参照する。これは手続型の
        // 「elseを通った場合その変数は未定義」という意味論と正確に一致する。
        phiVars.forEach((v) => {
            const thenArm: FExpr = { kind: 'Var', id: nextId('var'), name: `${v}_${thenCurrent[v] || 0}` };
            const elseArm: FExpr = { kind: 'Var', id: nextId('var'), name: `${v}_${elseCurrent[v] || 0}` };
            const ver = nextVersion(v);
            current[v] = ver;
            const name = `${v}_${ver}`;
            bindings.push({
                kind: 'plain',
                id: canonicalVarId(name),
                name,
                value: { kind: 'If', id: nextId('if'), cond: condRef(), then: thenArm, else: elseArm },
            });
        });
    };

    const processWhile = (stmt: WhileNode, bindings: Binding[]): void => {
        // ループ変数 = 本体内で代入される変数（transform.md (b)）。それ以外の
        // 参照はすべて外側スコープの自由変数として閉包に捕捉される（(c)）。
        const loopVars = collectAssignedVars(stmt.body);
        if (loopVars.length === 0) {
            // 何も束縛しないループには需要が発生しえず、生成しても永遠に
            // forceされないため何も生成しない（空if-elseと同じ需要駆動の帰結）。
            // ただしPrint等の未対応構成は明示エラーにする必要があるため、
            // 本体を一度走査してから捨てる（代入が無いので束縛は生じない）。
            const discarded: Binding[] = [];
            processStmts(stmt.body, discarded, { topLevel: false, inLoop: true });
            return;
        }

        const fnName = `%loop_${nextVersion('%loop')}`;

        // 初回呼び出しの実引数 = ループ突入前の版（未代入なら版0＝⊥）。
        const initArgs: FExpr[] = loopVars.map((v) => ({
            kind: 'Var', id: nextId('var'), name: `${v}_${current[v] || 0}`,
        }));

        const saved = { ...current };

        // 仮引数 = ループ先頭のφ（各周回の開始時点の値を受け取る新しい版）。
        const paramNames = loopVars.map((v) => {
            const ver = nextVersion(v);
            current[v] = ver;
            return `${v}_${ver}`;
        });

        // whileは本体実行前に判定するため、条件は仮引数の版を参照して構築する。
        const condExpr = buildFExpr(stmt.cond);

        // 本体（反復ごとに新しい環境で評価される式レベルの束縛列）。
        const bodyBindings: Binding[] = [];
        processStmts(stmt.body, bodyBindings, { topLevel: false, inLoop: true });

        // 末尾自己呼び出しの実引数 = 本体末尾での各ループ変数の版。
        const tailArgs: FExpr[] = loopVars.map((v) => ({
            kind: 'Var', id: nextId('var'), name: `${v}_${current[v] || 0}`,
        }));

        // 出口値：条件不成立時点の値＝仮引数の版。ループ変数が1つなら単独で、
        // 複数なら入れ子の対（Pair）で返す。
        const paramVar = (i: number): FExpr => ({ kind: 'Var', id: nextId('var'), name: paramNames[i] });
        let exitExpr: FExpr = paramVar(loopVars.length - 1);
        for (let i = loopVars.length - 2; i >= 0; i--) {
            exitExpr = { kind: 'Pair', id: nextId('pair'), fst: paramVar(i), snd: exitExpr };
        }

        // 本体束縛はthen腕の内側にLetInとして畳む（反復ごとに評価されるため
        // プログラムレベルへ巻き上げられない）。
        let thenBranch: FExpr = { kind: 'Apply', id: nextId('apply'), fn: fnName, args: tailArgs };
        for (let i = bodyBindings.length - 1; i >= 0; i--) {
            const b = bodyBindings[i];
            if (b.kind !== 'plain') {
                throw new Error('内部エラー: ループ本体に想定外の束縛種別が現れました');
            }
            thenBranch = { kind: 'LetIn', id: b.id, name: b.name, value: b.value, body: thenBranch };
        }
        const fnBody: FExpr = { kind: 'If', id: nextId('if'), cond: condExpr, then: thenBranch, else: exitExpr };

        bindings.push({ kind: 'rec', id: canonicalVarId(fnName), name: fnName, params: paramNames, fnBody });

        // 合流後（ループ脱出後）の新しい版を束縛する。複数ループ変数の場合は
        // 適用結果 %r_n を一度だけlet束縛してから射影する（launchbury.md §1）。
        current = { ...saved };
        if (loopVars.length === 1) {
            const v = loopVars[0];
            const ver = nextVersion(v);
            current[v] = ver;
            const name = `${v}_${ver}`;
            bindings.push({
                kind: 'plain', id: canonicalVarId(name), name,
                value: { kind: 'Apply', id: nextId('apply'), fn: fnName, args: initArgs },
            });
        } else {
            const rName = `%r_${nextVersion('%r')}`;
            bindings.push({
                kind: 'plain', id: canonicalVarId(rName), name: rName,
                value: { kind: 'Apply', id: nextId('apply'), fn: fnName, args: initArgs },
            });
            // 射影式は構文上複製されるが、force が到達するのは対の中の同一の
            // 成分Thunkであるため、共有（§3.3）は保たれ再計算は起きない。
            loopVars.forEach((v, i) => {
                let proj: FExpr = { kind: 'Var', id: nextId('var'), name: rName };
                for (let d = 0; d < i; d++) {
                    proj = { kind: 'Proj', id: nextId('proj'), which: 'snd', pair: proj };
                }
                if (i < loopVars.length - 1) {
                    proj = { kind: 'Proj', id: nextId('proj'), which: 'fst', pair: proj };
                }
                const ver = nextVersion(v);
                current[v] = ver;
                const name = `${v}_${ver}`;
                bindings.push({ kind: 'plain', id: canonicalVarId(name), name, value: proj });
            });
        }
    };

    const processStmts = (stmts: ASTNode[], bindings: Binding[], ctx: Ctx): void => {
        stmts.forEach((stmt) => {
            if (stmt.type === 'Assign') {
                // RHSを先に構築してからバージョンをインクリメントする。
                // math_change_ext（x += ..）等の自己参照が直前バージョンを
                // 正しく参照するために、この順序は厳密に守る必要がある。
                const valueExpr = buildFExpr(stmt.val);
                const ver = nextVersion(stmt.var);
                current[stmt.var] = ver;
                const name = `${stmt.var}_${ver}`;
                bindings.push({ kind: 'plain', id: canonicalVarId(name), name, value: valueExpr });
                return;
            }
            if (stmt.type === 'Print') {
                if (!ctx.topLevel) {
                    throw new Error(
                        'if-else分岐やループの内側に「表示」ブロックを置くことは現行スコープでは未対応です（表示ブロックは外側に置いてください）'
                    );
                }
                // Print: 式を構築し、終端のDoへ集約するために収集するのみ。
                prints.push({ kind: 'Print', id: nextId('print'), expr: buildFExpr(stmt.val) });
                return;
            }
            if (stmt.type === 'While') {
                if (ctx.inLoop) {
                    throw new Error(
                        'ループの入れ子（くり返しの中のくり返し）は現行スコープでは未対応です'
                    );
                }
                processWhile(stmt, bindings);
                return;
            }
            processIf(stmt, bindings, ctx);
        });
    };

    const bindings: Binding[] = [];
    processStmts(ast, bindings, { topLevel: true, inLoop: false });

    // 束縛列を右結合の入れ子Let/LetRecに畳み込み、終端のDoで閉じる。
    // 平坦な束縛列と入れ子Letは等価（各Letのbodyが残り全体）であり、
    // 参照は常に「より外側（＝列の前方）のLet」だけに向かう。
    let program: FProgram = { kind: 'Do', id: nextId('do'), actions: prints };
    for (let i = bindings.length - 1; i >= 0; i--) {
        const b = bindings[i];
        program = b.kind === 'rec'
            ? { kind: 'LetRec', id: b.id, name: b.name, params: b.params, fnBody: b.fnBody, body: program }
            : { kind: 'Let', id: b.id, name: b.name, value: b.value, body: program };
    }
    return program;
}
