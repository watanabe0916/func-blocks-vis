import { Value, Thunk, Env, FnValue, showValue } from './types';
import { FExpr, FProgram, PrimOp, canonicalVarId, canonicalUnboundId } from './functionalAst';

/**
 * ③純粋評価器（CLAUDE.md §4.3）。UIに一切依存しない純粋関数として、
 * 関数型AST（functionalAst.ts）のみを入力に取り、
 * { value を含む trace, consoleOutput } を返す。
 *
 * Launchbury対応関係（§4.7）:
 *   Lit     ↔ LIT規則（Γ,n ⇓ Γ,n）
 *   Var     ↔ VAR規則（Γ[x↦e],x ⇓ Δ[x↦v],v。ヒープ更新＝メモ化そのもの）
 *   Let     ↔ LET規則（Γ,letrec x=e in b ⇓ Δ,v）
 *             ↔ Haskellの `do{let decls;stmts} = let decls in do{stmts}`
 *   PrimApp ↔ PRIMOP拡張規則（固定の組込演算子への適用。本システムは
 *             ユーザー定義ラムダを持たないため、汎用APP規則ではなく
 *             このPRIMOP拡張のみで足りる＝現行スコープの単純化）
 *   If      ↔ CASE規則のBool特殊化（scrutineeのみWHNFまで評価し、
 *             選ばれた分岐の式の評価に移る。§5.1）
 *             ↔ Haskellの脱糖 `if c then a else b = case c of {True->a; False->b}`
 *   LetIn   ↔ LET規則（式レベル。Launchburyの計算ではletはもともと式）
 *   LetRec  ↔ LET規則の本来の一般性（相互再帰束縛）の回復。束縛される値は
 *             関数（ラムダ＝WHNF）のみで、閉包環境に自分自身を含める（不動点）
 *   Apply   ↔ APP規則の制限形（名前付き関数の飽和適用のみ。汎用APP規則は§5.4）
 *   Pair    ↔ コンストラクタ（WHNF＝外側のみ暴き、成分Thunkは未評価のまま。§3.2）
 *   Proj    ↔ CASE規則（scrutineeをWHNFまでforceし、選択された成分の
 *             forceに移る）
 *   Do      ↔ トップレベル評価の起点（需要の根、§3.4）
 *             ↔ Haskellの `do{e;stmts} = e >> do{stmts}`
 * 上記対応表は launchbury.md の要約である（齟齬がある場合は同文書を正とする）。
 */

// 適用回数の上限（CLAUDE.md §5.2(e)の決定事項、launchbury.md §2.5）。
// 正格化オプションは導入せず、非停止プログラムからのブラウザ保護・
// JSコールスタック保護・§4.5の線形性指標の維持をこの上限が担う。
// 意味論の一部ではなく、上限内で停止するプログラムの観測結果には影響しない。
const MAX_APPLICATIONS = 500;

export type TraceEvent =
    | { kind: 'force'; nodeId: string; order: number; value: Value; memoHit: boolean }
    | { kind: 'print'; nodeId: string; order: number; text: string }
    | { kind: 'error'; nodeId: string; order: number; message: string };

export interface EvalResult {
    trace: TraceEvent[];
    consoleOutput: string[];
}

// 演算子は特殊構文ではなく、すべて「Thunk配列を受け取り値を返す組込関数」
// として一様に定義する。And/Or の非正格性は関数の中身として表現され、
// Apply評価規則側には短絡評価のための特殊分岐は一切存在しない（§3.5）。
type Builtin = (args: Thunk[]) => Value;

export function evaluate(program: FProgram): EvalResult {
    const trace: TraceEvent[] = [];
    const consoleOutput: string[] = [];
    let order = 0;

    /**
     * Thunkを弱頭部正規形（WHNF）まで強制する。
     *
     * 一度 evaluated になったThunkは再計算されずキャッシュされた値を返す
     * （call-by-need = call-by-name + sharing, §3.3）。この可変セルによる
     * メモ化は外部から観測不可能な benign effect である：force() は
     * 同一のThunkに対して常に同じ値を返す純関数として振る舞い、
     * 「メモ化されている」という事実そのものは観測できない。
     * ゆえにこの可変性は「純粋関数型」という前提を破らない。
     *
     * UI・グラフノードへの一切の書き込みは行わない（旧実装からの変更点）。
     * 副作用は `trace` 配列への push のみであり、これは evaluate() 全体を
     * 呼び出し側から見て参照透過に保つ（同じ入力には常に同じ trace/戻り値）。
     */
    const force = (thunk: Thunk): Value => {
        let value: Value;
        let memoHit: boolean;
        if (thunk.cell.state === 'evaluated') {
            value = thunk.cell.value;
            memoHit = true;
        } else if (thunk.cell.state === 'forcing') {
            // ブラックホール：評価中のThunkへの再need＝循環定義（⊥）。
            // LaunchburyのVAR規則が「束縛の評価中、その束縛をヒープから
            // 取り除く」ことに対応する（launchbury.md §2.4）。この分岐に
            // 到達するのは意味論上⊥を表すプログラムのみであり、観測的
            // 純粋性は保たれる。
            throw new Error('循環定義を検出しました（自分自身の値を必要とする定義＝⊥）');
        } else {
            const compute = thunk.cell.compute;
            thunk.cell = { state: 'forcing' };
            value = compute();
            thunk.cell = { state: 'evaluated', value };
            memoHit = false;
        }
        trace.push({ kind: 'force', nodeId: thunk.nodeId, order: order++, value, memoHit });
        return value;
    };

    // 適用回数カウンタ（MAX_APPLICATIONS の説明を参照）。
    let applyCount = 0;

    const BUILTINS: Record<PrimOp, Builtin> = {
        Add: (a) => Number(force(a[0])) + Number(force(a[1])),
        Sub: (a) => Number(force(a[0])) - Number(force(a[1])),
        Mul: (a) => Number(force(a[0])) * Number(force(a[1])),
        // 0除算はIEEE754のネイティブ挙動（Infinity/-Infinity/NaN）に委ねる。
        Div: (a) => Number(force(a[0])) / Number(force(a[1])),
        Pow: (a) => Math.pow(Number(force(a[0])), Number(force(a[1]))),
        Mod: (a) => Number(force(a[0])) % Number(force(a[1])),
        Equal: (a) => force(a[0]) === force(a[1]),
        NotEqual: (a) => force(a[0]) !== force(a[1]),
        LessThan: (a) => (force(a[0]) as any) < (force(a[1]) as any),
        LessThanOrEqual: (a) => (force(a[0]) as any) <= (force(a[1]) as any),
        GreaterThan: (a) => (force(a[0]) as any) > (force(a[1]) as any),
        GreaterThanOrEqual: (a) => (force(a[0]) as any) >= (force(a[1]) as any),
        // and/or は通常の（非正格な）組込関数として定義する。短絡評価は
        // ここでの「右辺への言及の有無」から自然に創発する（§3.5）。
        And: (a) => (force(a[0]) ? Boolean(force(a[1])) : false),
        Or: (a) => (force(a[0]) ? true : Boolean(force(a[1]))),
        Not: (a) => !force(a[0]),
    };

    // 未束縛変数の⊥Thunkキャッシュ。同一名の複数参照が同じThunk（＝同じ
    // 正準ゴーストID）を共有する。
    const unboundGhosts = new Map<string, Thunk>();

    /**
     * 関数型ASTの式からThunkを構築する（Launchbury的には「クロージャの
     * 生成」に相当。この時点では一切forceしない）。
     */
    const buildThunk = (expr: FExpr, env: Env): Thunk => {
        if (expr.kind === 'Lit') {
            return { nodeId: expr.id, cell: { state: 'unevaluated', compute: () => expr.value } };
        }
        if (expr.kind === 'Var') {
            const bound = env.get(expr.name);
            if (bound) return bound;

            // 未束縛の変数参照：⊥（ボトム）として健全に存在させ、force
            // された場合にのみ制御されたエラーとして扱う（§3.6）。
            // 需要が届かなければ（短絡評価等）、このThunkは永遠にforce
            // されずプログラム全体は問題なく停止する。
            const ghostId = canonicalUnboundId(expr.name);
            let thunk = unboundGhosts.get(ghostId);
            if (!thunk) {
                thunk = {
                    nodeId: ghostId,
                    cell: {
                        state: 'unevaluated',
                        compute: () => { throw new Error(`未束縛の変数 '${expr.name}' が要求されました`); },
                    },
                };
                unboundGhosts.set(ghostId, thunk);
            }
            return thunk;
        }
        if (expr.kind === 'If') {
            // §5.1: scrutinee（条件）のみをWHNFまでforceし、選ばれた分岐
            // だけをforceする。選ばれなかった分岐のThunkには需要が届かず
            // 未評価のまま残る。And/Or（§3.5）と同様、if-then-elseにも
            // 特殊な簡約規則は不要で、非正格性は遅延評価から創発する。
            const condThunk = buildThunk(expr.cond, env);
            const thenThunk = buildThunk(expr.then, env);
            const elseThunk = buildThunk(expr.else, env);
            return {
                nodeId: expr.id,
                cell: {
                    state: 'unevaluated',
                    compute: () => (force(condThunk) ? force(thenThunk) : force(elseThunk)),
                },
            };
        }
        if (expr.kind === 'LetIn') {
            // 式レベルのlet（LET規則）。束縛時にforceしない。let自体は透明で、
            // LetIn式のThunkはbodyのThunkそのものである。
            // 注意: ループ本体内のLetInは反復ごとに同じ静的idで別のThunkが
            // 生成される。trace上は同一nodeIdの複数forceイベントとなり、
            // 可視化（renderGraph）は最初の発生＝初回反復の値を表示する。
            const rhs = buildThunk(expr.value, env);
            const newEnv: Env = new Map(env);
            newEnv.set(expr.name, {
                nodeId: expr.id,
                cell: { state: 'unevaluated', compute: () => force(rhs) },
            });
            return buildThunk(expr.body, newEnv);
        }
        if (expr.kind === 'Apply') {
            // APP規則の制限形（名前付き関数の飽和適用、launchbury.md §2.2）。
            // 実引数Thunkは呼び出し側の環境で一度だけ構築する。
            const argThunks = expr.args.map((a) => buildThunk(a, env));
            return {
                nodeId: expr.id,
                cell: {
                    state: 'unevaluated',
                    compute: () => {
                        const fnThunk = env.get(expr.fn);
                        if (!fnThunk) {
                            throw new Error(`未定義の関数 '${expr.fn}' が適用されました`);
                        }
                        const fnValue = force(fnThunk);
                        if (typeof fnValue !== 'object' || fnValue.kind !== 'fn') {
                            throw new Error(`'${expr.fn}' は関数ではない値に適用されました`);
                        }
                        applyCount++;
                        if (applyCount > MAX_APPLICATIONS) {
                            throw new Error(
                                `反復回数が上限（${MAX_APPLICATIONS}）を超えました。ループの条件が偽になるか確認してください`
                            );
                        }
                        // 関数の定義時環境（閉包）を仮引数↦実引数Thunkで拡張する
                        // ＝APP規則の代入 e'[x/y] の環境表現。仮引数の正準ノードID
                        // でラップし、可視化がループ先頭のφ（＝仮引数）の初回force
                        // 値を表示できるようにする。
                        const callEnv: Env = new Map(fnValue.env);
                        fnValue.params.forEach((p, i) => {
                            const arg = argThunks[i];
                            callEnv.set(p, {
                                nodeId: canonicalVarId(p),
                                cell: { state: 'unevaluated', compute: () => force(arg) },
                            });
                        });
                        return force(buildThunk(fnValue.body, callEnv));
                    },
                },
            };
        }
        if (expr.kind === 'Pair') {
            // コンストラクタ：forceはWHNFまで＝外側のセルだけを返し、
            // fst/sndのThunkは未評価のまま保持する（§3.2）。
            const fstThunk = buildThunk(expr.fst, env);
            const sndThunk = buildThunk(expr.snd, env);
            return {
                nodeId: expr.id,
                cell: { state: 'unevaluated', compute: () => ({ kind: 'pair', fst: fstThunk, snd: sndThunk }) },
            };
        }
        if (expr.kind === 'Proj') {
            // CASE規則：scrutinee（対）をWHNFまでforceし、選択された成分の
            // forceに移る。射影式が構文上複製されていても、到達する成分Thunkは
            // 対の中の同一オブジェクトであるため共有（§3.3）が保たれる。
            const pairThunk = buildThunk(expr.pair, env);
            return {
                nodeId: expr.id,
                cell: {
                    state: 'unevaluated',
                    compute: () => {
                        const p = force(pairThunk);
                        if (typeof p !== 'object' || p.kind !== 'pair') {
                            throw new Error('対（Pair）でない値への射影が要求されました');
                        }
                        return force(expr.which === 'fst' ? p.fst : p.snd);
                    },
                },
            };
        }
        // PrimApp: 引数Thunkは一度だけ構築する（forceのたびに再構築しない）。
        const argThunks = expr.args.map((a) => buildThunk(a, env));
        return {
            nodeId: expr.id,
            cell: { state: 'unevaluated', compute: () => BUILTINS[expr.op](argThunks) },
        };
    };

    /**
     * プログラム全体を評価する。Letは束縛するだけでforceしない（§3.4）。
     * Doに到達した時点で初めて、Print文（需要の根）を起点にforceが連鎖する。
     */
    const run = (node: FProgram, env: Env): void => {
        if (node.kind === 'Let') {
            const rhsThunk = buildThunk(node.value, env);
            const varThunk: Thunk = {
                nodeId: node.id,
                cell: { state: 'unevaluated', compute: () => force(rhsThunk) },
            };
            const newEnv: Env = new Map(env);
            newEnv.set(node.name, varThunk);
            run(node.body, newEnv);
            return;
        }

        if (node.kind === 'LetRec') {
            // 自己参照束縛（LET規則の本来の一般性、launchbury.md §2.1）。
            // 関数（ラムダ）はそれ自体がWHNFの値であるため evaluated 状態で
            // 束縛してよく、閉包環境 newEnv に自分自身を含めることで自己参照
            // （不動点）が成立する。Thunkは定義時にforceされないため、
            // 定義時の無限展開は起きない（§5.2）。
            const newEnv: Env = new Map(env);
            const fnValue: FnValue = {
                kind: 'fn',
                name: node.name,
                params: node.params,
                body: node.fnBody,
                env: newEnv,
            };
            newEnv.set(node.name, { nodeId: node.id, cell: { state: 'evaluated', value: fnValue } });
            run(node.body, newEnv);
            return;
        }

        // Do: 仮想コンソールへの出力を需要の根として、プログラム順にforce
        // する。1つのPrintの需要が失敗（⊥の強制）しても、後続のPrintの
        // 処理は継続する。
        node.actions.forEach((action) => {
            const thunk = buildThunk(action.expr, env);
            try {
                const value = force(thunk);
                trace.push({ kind: 'print', nodeId: action.id, order: order++, text: showValue(value) });
                consoleOutput.push(showValue(value));
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                trace.push({ kind: 'error', nodeId: action.id, order: order++, message });
                consoleOutput.push(`[エラー] ${message}`);
            }
        });
    };

    run(program, new Map());

    return { trace, consoleOutput };
}
