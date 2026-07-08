import { ASTNode, ExpressionNode } from './types';
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
 */
export function transpileToFunctionalAst(ast: ASTNode[]): FProgram {
    let idCounter = 0;
    const nextId = (prefix: string) => `${prefix}_${idCounter++}`;

    const versions: Record<string, number> = {};
    const getVarVersion = (name: string) => versions[name] || 0;
    const incrementVarVersion = (name: string) => {
        versions[name] = getVarVersion(name) + 1;
        return versions[name];
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
            const name = `${expr.name}_${getVarVersion(expr.name)}`;
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

    const prints: FPrint[] = [];

    const buildProgram = (index: number): FProgram => {
        if (index >= ast.length) {
            return { kind: 'Do', id: nextId('do'), actions: prints };
        }
        const stmt = ast[index];
        if (stmt.type === 'Assign') {
            // RHSを先に構築してからバージョンをインクリメントする。
            // math_change_ext（x += ..）等の自己参照が直前バージョンを
            // 正しく参照するために、この順序は厳密に守る必要がある。
            const valueExpr = buildFExpr(stmt.val);
            const ver = incrementVarVersion(stmt.var);
            const name = `${stmt.var}_${ver}`;
            return {
                kind: 'Let',
                id: canonicalVarId(name),
                name,
                value: valueExpr,
                body: buildProgram(index + 1),
            };
        }
        // Print: 式を構築し、終端のDoへ集約するために収集するのみ。
        const expr = buildFExpr(stmt.val);
        prints.push({ kind: 'Print', id: nextId('print'), expr });
        return buildProgram(index + 1);
    };

    return buildProgram(0);
}
