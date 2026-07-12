import { ASTNode, ExpressionNode } from './types';

/**
 * 手続型参照インタプリタ（CLAUDE.md §4.8）。
 *
 * 手続型AST（①extractor.tsの出力）を、関数型ASTへの変換を経由せず、
 * 正格・逐次・可変な変数表で「手続型言語の直感どおり」に直接実行する。
 *
 * 目的:
 * (a) HCI —— 左ペイン下部に「手続型としての実行結果」を表示し、右ペインの
 *     関数型実行（仮想コンソール）と並べることで、変換の意味保存と
 *     遅延評価の差（需要の無い無限ループのスキップ等）を学習者に体感させる。
 * (b) 理論 —— §4.7の意味保存テンプレート（住井ら）の「①変換元の操作的
 *     意味論の定義」の実行可能な形であり、観測等価の左辺を機械化する。
 *     将来の3者比較（本結果 = evaluate() = runghc）の左辺になる。
 *
 * 意味論:
 * - 正格・逐次実行。式は即時に値まで評価され、代入は変数表を破壊的に更新する。
 * - And/Or は手続型言語の慣習どおり短絡評価（JS準拠）。
 * - Div/Mod は IEEE754（JSネイティブ挙動）。評価器のBUILTINSと同じ観測結果に
 *   なるが、コードは意図的に共有しない（共通バグの混入を避ける独立参照実装）。
 * - 未束縛変数の参照は即時エラーで実行停止する（⊥として許容し需要が届くまで
 *   顕在化しない関数型側 §3.6 と対照的。この差自体が教材である）。
 *
 * 無限ループ対策:
 * - ループ反復の総数に上限（maxSteps）を設け、超過時は 'timeout' ステータスと
 *   「途中までの出力」を返す。手続型側が打ち切られ関数型側が停止する非対称は、
 *   「call-by-needはより多くのプログラムを停止させる」（§4.7の非対称
 *   シミュレーション）の実例として意図的にそのまま見せる。
 */

export type ProcStatus = 'ok' | 'timeout' | 'error';

export interface ProcResult {
    output: string[];
    status: ProcStatus;
    /** timeout / error のときの説明（表示用） */
    message?: string;
}

type ProcValue = number | string | boolean;

export const PROC_MAX_STEPS = 10000;

export function runProcedural(ast: ASTNode[], maxSteps: number = PROC_MAX_STEPS): ProcResult {
    const vars = new Map<string, ProcValue>();
    const output: string[] = [];
    let steps = 0;

    // 打ち切りを通常のエラーと区別するための内部例外
    class TimeoutSignal extends Error {}

    const evalExpr = (expr: ExpressionNode | undefined): ProcValue => {
        if (!expr) return 0; // 空ソケットの既定値（transpilerと同じ規約）
        if (expr.type === 'Literal') return expr.value;
        if (expr.type === 'Var') {
            if (!vars.has(expr.name)) {
                throw new Error(`変数 '${expr.name}' は定義されていません`);
            }
            return vars.get(expr.name)!;
        }
        // Apply。正格評価だが、And/Or だけは手続型言語の慣習（JS準拠）どおり
        // 左辺の値によって右辺の評価をスキップする（短絡評価）。
        const op = expr.op;
        if (op === 'And') {
            return evalExpr(expr.args[0]) ? Boolean(evalExpr(expr.args[1])) : false;
        }
        if (op === 'Or') {
            return evalExpr(expr.args[0]) ? true : Boolean(evalExpr(expr.args[1]));
        }
        if (op === 'Not') {
            return !evalExpr(expr.args[0]);
        }
        const a = evalExpr(expr.args[0]);
        const b = evalExpr(expr.args[1]);
        switch (op) {
            case 'Add': return Number(a) + Number(b);
            case 'Sub': return Number(a) - Number(b);
            case 'Mul': return Number(a) * Number(b);
            // 0除算はIEEE754のネイティブ挙動（Infinity/-Infinity/NaN）に委ねる
            case 'Div': return Number(a) / Number(b);
            case 'Pow': return Math.pow(Number(a), Number(b));
            case 'Mod': return Number(a) % Number(b);
            case 'Equal': return a === b;
            case 'NotEqual': return a !== b;
            /* eslint-disable @typescript-eslint/no-explicit-any */
            case 'LessThan': return (a as any) < (b as any);
            case 'LessThanOrEqual': return (a as any) <= (b as any);
            case 'GreaterThan': return (a as any) > (b as any);
            case 'GreaterThanOrEqual': return (a as any) >= (b as any);
            /* eslint-enable @typescript-eslint/no-explicit-any */
        }
        // 到達しない（opの網羅はTypeScriptが保証する）
        throw new Error(`未対応の演算子: ${op}`);
    };

    const execStmts = (stmts: ASTNode[]): void => {
        stmts.forEach((stmt) => {
            if (stmt.type === 'Assign') {
                vars.set(stmt.var, evalExpr(stmt.val));
                return;
            }
            if (stmt.type === 'Print') {
                output.push(String(evalExpr(stmt.val)));
                return;
            }
            if (stmt.type === 'If') {
                if (evalExpr(stmt.cond)) {
                    execStmts(stmt.then);
                } else {
                    execStmts(stmt.else);
                }
                return;
            }
            // While: 手続型なので入れ子のループ・ループ内Printにも制限はない
            // （関数型への変換側の現行スコープ制限とは独立）。
            while (evalExpr(stmt.cond)) {
                steps++;
                if (steps > maxSteps) {
                    throw new TimeoutSignal();
                }
                execStmts(stmt.body);
            }
        });
    };

    try {
        execStmts(ast);
        return { output, status: 'ok' };
    } catch (e) {
        if (e instanceof TimeoutSignal) {
            return {
                output,
                status: 'timeout',
                message: `${maxSteps}回の反復を超えたため打ち切りました（無限ループの可能性）`,
            };
        }
        const message = e instanceof Error ? e.message : String(e);
        return { output, status: 'error', message };
    }
}
