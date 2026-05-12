import { Node, Edge } from 'reactflow';
import { ASTNode, ExpressionNode } from './types';

interface TranspileResult {
    nodes: Node[];
    edges: Edge[];
    consoleOutput: string[];
}

/**
 * SSAグラフの生成と、実行結果（コンソール出力）の算出を行う
 */
export function transpileToSSA(ast: ASTNode[]): TranspileResult {
    const env: Record<string, number> = {}; // 変数のバージョン管理 { x: 1, y: 1 }
    const values: Record<string, string | number> = {}; // バージョンごとの値を保持 { var_x_1: 10 }
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const consoleOutput: string[] = [];
    let yOffset = 50;

    const getVarVersion = (name: string) => env[name] || 0;
    const incrementVarVersion = (name: string) => {
        env[name] = getVarVersion(name) + 1;
        return env[name];
    };

    /**
     * 式の評価とグラフノードの生成
     */
    const processExpr = (expr: ExpressionNode | undefined, currentY: number): { id: string; value: string | number } => {
        if (!expr) return { id: 'null', value: 0 };

        if (expr.type === 'Literal') {
            const id = `val_${Math.random().toString(36).substr(2, 9)}`;
            nodes.push({ 
                id, 
                position: { x: 50, y: currentY }, 
                data: { label: `[値] ${expr.value}` } 
            });
            return { id, value: expr.value };

        } else if (expr.type === 'Var') {
            const ver = getVarVersion(expr.name);
            const id = `var_${expr.name}_${ver}`;
            // 最新のバージョンの値を参照
            return { id, value: values[id] || 0 };

        } else if (['Add', 'Sub', 'Mul', 'Div'].includes(expr.type)) {
            const left = processExpr(expr.left, currentY - 30);
            const right = processExpr(expr.right, currentY + 30);
            
            const opId = `op_${expr.type.toLowerCase()}_${Math.random().toString(36).substr(2, 9)}`;
            const labels: Record<string, string> = { 'Add': '[+] 加算', 'Sub': '[-] 減算', 'Mul': '[*] 乗算', 'Div': '[/] 除算' };
            
            nodes.push({ 
                id: opId, 
                position: { x: 175, y: currentY }, 
                data: { label: labels[expr.type] } 
            });

            edges.push({ id: `e_${left.id}_${opId}`, source: left.id, target: opId, animated: true });
            edges.push({ id: `e_${right.id}_${opId}`, source: right.id, target: opId, animated: true });

            // 計算の実行
            let result: number = 0;
            const lVal = Number(left.value);
            const rVal = Number(right.value);
            if (expr.type === 'Add') result = lVal + rVal;
            if (expr.type === 'Sub') result = lVal - rVal;
            if (expr.type === 'Mul') result = lVal * rVal;
            if (expr.type === 'Div') result = rVal !== 0 ? lVal / rVal : 0;

            return { id: opId, value: result };
        }

        return { id: 'null', value: 0 };
    };

    // ASTを一行ずつ走査
    ast.forEach((stmt, index) => {
        if (stmt.type === 'Assign') {
            // 右辺の評価
            const res = processExpr(stmt.val, yOffset);
            
            // 左辺（変数）の新しいバージョンを作成
            const ver = incrementVarVersion(stmt.var);
            const varId = `var_${stmt.var}_${ver}`;

            // 値を保存
            values[varId] = res.value;

            nodes.push({
                id: varId,
                position: { x: 300, y: yOffset },
                data: { label: `${stmt.var}_${ver}` },
                style: ver > 1 ? { background: '#ffeb3b' } : {} // 再代入（シャドウイング）を強調
            });

            // 評価結果から変数ノードへのエッジ
            edges.push({ id: `e_${res.id}_${varId}`, source: res.id, target: varId, animated: true });
            yOffset += 140;

        } else if (stmt.type === 'Print') {
            // 出力対象の評価
            const res = processExpr(stmt.val, yOffset);
            const printId = `print_${index}`;

            nodes.push({ 
                id: printId, 
                position: { x: 500, y: yOffset }, 
                data: { label: 'Print()' }, 
                style: { background: '#4caf50', color: '#fff' } 
            });

            edges.push({ id: `e_${res.id}_${printId}`, source: res.id, target: printId, animated: true });

            // 仮想コンソールへの出力
            consoleOutput.push(String(res.value));
            yOffset += 140;
        }
    });

    return { nodes, edges, consoleOutput };
}
