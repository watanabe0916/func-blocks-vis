import { Value, Thunk, Env } from './types';
import { FExpr, FProgram, PrimOp, canonicalUnboundId } from './functionalAst';

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
 *   Do      ↔ トップレベル評価の起点（需要の根、§3.4）
 *             ↔ Haskellの `do{e;stmts} = e >> do{stmts}`
 * この対応が低コストで成立するのは、ユーザー定義ラムダ・自己参照letrecが
 * 存在しない現行スコープに限られる（§5.2/§5.4実装前）。
 */

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
        } else {
            value = thunk.cell.compute();
            thunk.cell = { state: 'evaluated', value };
            memoHit = false;
        }
        trace.push({ kind: 'force', nodeId: thunk.nodeId, order: order++, value, memoHit });
        return value;
    };

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

        // Do: 仮想コンソールへの出力を需要の根として、プログラム順にforce
        // する。1つのPrintの需要が失敗（⊥の強制）しても、後続のPrintの
        // 処理は継続する。
        node.actions.forEach((action) => {
            const thunk = buildThunk(action.expr, env);
            try {
                const value = force(thunk);
                trace.push({ kind: 'print', nodeId: action.id, order: order++, text: String(value) });
                consoleOutput.push(String(value));
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
