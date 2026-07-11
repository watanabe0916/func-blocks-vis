import { ASTNode, ExpressionNode, IfNode } from './types';
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

    type Binding = { id: string; name: string; value: FExpr };
    const prints: FPrint[] = [];

    const processIf = (stmt: IfNode, bindings: Binding[]): void => {
        // 条件式は分岐前の版を参照して構築する。
        const condExpr = buildFExpr(stmt.cond);
        const saved = { ...current };

        const thenBindings: Binding[] = [];
        processStmts(stmt.then, thenBindings, false);
        const thenCurrent = current;

        current = { ...saved };
        const elseBindings: Binding[] = [];
        processStmts(stmt.else, elseBindings, false);
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
            bindings.push({ id: canonicalVarId(condName), name: condName, value: condExpr });
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
                id: canonicalVarId(name),
                name,
                value: { kind: 'If', id: nextId('if'), cond: condRef(), then: thenArm, else: elseArm },
            });
        });
    };

    const processStmts = (stmts: ASTNode[], bindings: Binding[], topLevel: boolean): void => {
        stmts.forEach((stmt) => {
            if (stmt.type === 'Assign') {
                // RHSを先に構築してからバージョンをインクリメントする。
                // math_change_ext（x += ..）等の自己参照が直前バージョンを
                // 正しく参照するために、この順序は厳密に守る必要がある。
                const valueExpr = buildFExpr(stmt.val);
                const ver = nextVersion(stmt.var);
                current[stmt.var] = ver;
                const name = `${stmt.var}_${ver}`;
                bindings.push({ id: canonicalVarId(name), name, value: valueExpr });
                return;
            }
            if (stmt.type === 'Print') {
                if (!topLevel) {
                    throw new Error(
                        'if-else分岐の内側に「表示」ブロックを置くことは現行スコープでは未対応です（表示ブロックは分岐の外に置いてください）'
                    );
                }
                // Print: 式を構築し、終端のDoへ集約するために収集するのみ。
                prints.push({ kind: 'Print', id: nextId('print'), expr: buildFExpr(stmt.val) });
                return;
            }
            processIf(stmt, bindings);
        });
    };

    const bindings: Binding[] = [];
    processStmts(ast, bindings, true);

    // 束縛列を右結合の入れ子Letに畳み込み、終端のDoで閉じる。
    // 平坦な束縛列と入れ子Letは等価（各Letのbodyが残り全体）であり、
    // 参照は常に「より外側（＝列の前方）のLet」だけに向かう。
    let program: FProgram = { kind: 'Do', id: nextId('do'), actions: prints };
    for (let i = bindings.length - 1; i >= 0; i--) {
        const b = bindings[i];
        program = { kind: 'Let', id: b.id, name: b.name, value: b.value, body: program };
    }
    return program;
}
