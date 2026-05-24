import { Node, Edge } from 'reactflow';
import { ASTNode, ExpressionNode } from './types';

interface TranspileResult {
    nodes: Node[];
    edges: Edge[];
    consoleOutput: string[];
}

function getOpLabel(op: string, embeddedLeft?: any, embeddedRight?: any): string {
    const symbols: Record<string, string> = {
        'Equal': '==',
        'NotEqual': '!=',
        'LessThan': '<',
        'LessThanOrEqual': '<=',
        'GreaterThan': '>',
        'GreaterThanOrEqual': '>=',
        'And': '&&',
        'Or': '||',
        'Not': '!'
    };
    const symbol = symbols[op] || op;
    if (op === 'Not') {
        return `!`;
    }
    if (embeddedLeft !== undefined) {
        return `${embeddedLeft} ${symbol}`;
    }
    if (embeddedRight !== undefined) {
        return `${symbol} ${embeddedRight}`;
    }
    return symbol;
}

/**
 * SSAグラフの生成と、実行結果（コンソール出力）の算出を行う
 */
export function transpileToSSA(ast: ASTNode[]): TranspileResult {
    const env: Record<string, number> = {}; // 変数のバージョン管理 { x: 1, y: 1 }
    const values: Record<string, string | number | boolean> = {}; // バージョンごとの値を保持 { var_x_1: 10 }
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const consoleOutput: string[] = [];
    let yOffset = 50;

    const getVarVersion = (name: string) => env[name] || 0;
    const incrementVarVersion = (name: string) => {
        env[name] = getVarVersion(name) + 1;
        return env[name];
    };

    const setLiteralParent = (childId: string, parentId: string) => {
        const childNode = nodes.find(n => n.id === childId);
        if (childNode && childNode.data && childNode.data.isLiteral) {
            childNode.data.parentId = parentId;
        }
    };

    /**
     * 式の評価とグラフノードの生成
     */
    const processExpr = (expr: ExpressionNode | undefined, currentY: number): { id: string; value: string | number | boolean } => {
        if (!expr) return { id: 'null', value: 0 };

        if (expr.type === 'Literal') {
            const id = `val_${Math.random().toString(36).substr(2, 9)}`;
            nodes.push({ 
                id, 
                type: 'valNode',
                position: { x: 50, y: currentY }, 
                data: { 
                    label: `${expr.value}`,
                    value: expr.value,
                    isLiteral: true
                } 
            });
            return { id, value: expr.value };

        } else if (expr.type === 'Var') {
            const ver = getVarVersion(expr.name);
            const id = `var_${expr.name}_${ver}`;
            // 最新のバージョンの値を参照
            return { id, value: values[id] !== undefined ? values[id] : 0 };

        } else if (expr.type === 'Add' || expr.type === 'Sub' || expr.type === 'Mul' || expr.type === 'Div' || expr.type === 'Pow' || expr.type === 'Mod') {
            const left = processExpr(expr.left, currentY - 35);
            const right = processExpr(expr.right, currentY + 35);
            
            const opId = `op_${expr.type.toLowerCase()}_${Math.random().toString(36).substr(2, 9)}`;
            const labels: Record<string, string> = { 
                'Add': '+', 
                'Sub': '-', 
                'Mul': '*', 
                'Div': '/', 
                'Pow': '^',
                'Mod': '%'
            };
            
            // 計算の実行
            let result: number = 0;
            const lVal = Number(left.value);
            const rVal = Number(right.value);
            if (expr.type === 'Add') result = lVal + rVal;
            if (expr.type === 'Sub') result = lVal - rVal;
            if (expr.type === 'Mul') result = lVal * rVal;
            if (expr.type === 'Div') result = rVal !== 0 ? lVal / rVal : 0;
            if (expr.type === 'Pow') result = Math.pow(lVal, rVal);
            if (expr.type === 'Mod') result = rVal !== 0 ? lVal % rVal : 0;

            nodes.push({ 
                id: opId, 
                type: 'opNode',
                position: { x: 175, y: currentY }, 
                data: { 
                    label: labels[expr.type] || expr.type,
                    op: expr.type,
                    result,
                    folded: false
                } 
            });

            edges.push({ id: `e_${left.id}_${opId}`, source: left.id, target: opId, animated: true });
            edges.push({ id: `e_${right.id}_${opId}`, source: right.id, target: opId, animated: true });

            setLiteralParent(left.id, opId);
            setLiteralParent(right.id, opId);

            return { id: opId, value: result };

        } else if (expr.type === 'Apply') {
            const op = expr.op;
            const opId = `op_${op.toLowerCase()}_${Math.random().toString(36).substr(2, 9)}`;

            let result: boolean = false;
            let leftRes: { id: string; value: any } | null = null;
            let rightRes: { id: string; value: any } | null = null;
            let shortCircuited = false;

            const leftExpr = expr.args[0];
            const rightExpr = expr.args[1];

            if (op === 'Not') {
                leftRes = processExpr(leftExpr, currentY);
                result = !leftRes.value;
            } else if (op === 'And' || op === 'Or') {
                leftRes = processExpr(leftExpr, currentY - 45);
                const lVal = !!leftRes.value;
                if (op === 'And') {
                    if (lVal === false) {
                        result = false;
                        shortCircuited = true;
                    } else {
                        rightRes = processExpr(rightExpr, currentY + 45);
                        result = lVal && !!rightRes.value;
                    }
                } else { // Or
                    if (lVal === true) {
                        result = true;
                        shortCircuited = true;
                    } else {
                        rightRes = processExpr(rightExpr, currentY + 45);
                        result = lVal || !!rightRes.value;
                    }
                }
            } else {
                // Comparison operators
                leftRes = processExpr(leftExpr, currentY - 45);
                rightRes = processExpr(rightExpr, currentY + 45);
                const lVal = leftRes.value;
                const rVal = rightRes.value;

                if (op === 'Equal') result = lVal === rVal;
                else if (op === 'NotEqual') result = lVal !== rVal;
                else if (op === 'LessThan') result = lVal < rVal;
                else if (op === 'LessThanOrEqual') result = lVal <= rVal;
                else if (op === 'GreaterThan') result = lVal > rVal;
                else if (op === 'GreaterThanOrEqual') result = lVal >= rVal;
            }

            const isLeftLiteral = leftExpr?.type === 'Literal';
            const isRightLiteral = rightExpr ? rightExpr.type === 'Literal' : true;
            const isElision = isLeftLiteral && (shortCircuited ? true : isRightLiteral);

            const embeddedRight = (!isElision && rightExpr?.type === 'Literal') ? rightRes?.value : undefined;
            const embeddedLeft = (!isElision && leftExpr?.type === 'Literal') ? leftRes?.value : undefined;
            const hasEmbeddedLiteral = (embeddedLeft !== undefined || embeddedRight !== undefined);

            nodes.push({
                id: opId,
                type: 'opNode',
                position: { x: 175, y: currentY },
                data: {
                    op,
                    label: getOpLabel(op, embeddedLeft, embeddedRight),
                    result,
                    folded: isElision || hasEmbeddedLiteral,
                    isElision,
                    embeddedLeft,
                    embeddedRight,
                    hasEmbeddedLiteral,
                    args: {
                        left: leftRes ? { id: leftRes.id, value: leftRes.value, isVar: leftExpr?.type === 'Var', name: leftExpr?.type === 'Var' ? (leftExpr as any).name : undefined } : null,
                        right: rightRes ? { id: rightRes.id, value: rightRes.value, isVar: rightExpr?.type === 'Var', name: rightExpr?.type === 'Var' ? (rightExpr as any).name : undefined } : null,
                    },
                    shortCircuited
                }
            });

            if (leftRes) {
                edges.push({ id: `e_${leftRes.id}_${opId}`, source: leftRes.id, target: opId, animated: true });
                setLiteralParent(leftRes.id, opId);
            }
            if (rightRes) {
                edges.push({ id: `e_${rightRes.id}_${opId}`, source: rightRes.id, target: opId, animated: true });
                setLiteralParent(rightRes.id, opId);
            }

            return { id: opId, value: result };
        }

        return { id: 'null', value: 0 };
    };

    const varLatestNodeId: Record<string, string> = {}; // 各変数の最新ノードIDを記録

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

            // 以前のバージョンがあれば、その強調（黄色）を解除する
            if (varLatestNodeId[stmt.var]) {
                const prevNodeId = varLatestNodeId[stmt.var];
                const prevNode = nodes.find(n => n.id === prevNodeId);
                if (prevNode) {
                    prevNode.style = { ...prevNode.style, background: undefined };
                }
            }

            // 新しいノードを黄色で作成し、最新IDを更新
            nodes.push({
                id: varId,
                type: 'valNode',
                position: { x: 300, y: yOffset },
                data: { 
                    label: `${stmt.var}_${ver}`,
                    value: res.value,
                    isVar: true,
                    varName: stmt.var,
                    version: ver
                },
                style: { background: '#ffeb3b' } // 常に最初は強調
            });
            varLatestNodeId[stmt.var] = varId;

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
                data: { label: `Print(${res.value})` }, 
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
