import { Node, Edge } from 'reactflow';
import { Value, OP_SYMBOLS } from './types';
import { FExpr, FProgram, FLet, PrimOp, canonicalUnboundId } from './functionalAst';
import { TraceEvent } from './evaluator';

/**
 * ⑤トレース駆動グラフ描画（CLAUDE.md §4.5）。評価を一切行わない純粋関数。
 * 視覚語彙は Weck & Tichy の設計原則（DateFlow.md）を採用する：
 * ノード種別ごとの外観区別、全エッジへの型ラベル付与、上から下への
 * レイアウト、Elision（force済み＋メモ化ノードの折りたたみ）。
 */

type TypeLabel = 'Number' | 'String' | 'Boolean' | 'Unknown';

const ARITH_OPS = new Set<PrimOp>(['Add', 'Sub', 'Mul', 'Div', 'Pow', 'Mod']);

function getOpLabel(op: PrimOp, embeddedLeft?: Value, embeddedRight?: Value): string {
    const symbol = OP_SYMBOLS[op];
    if (op === 'Not') return symbol;
    if (embeddedLeft !== undefined) return `${embeddedLeft} ${symbol}`;
    if (embeddedRight !== undefined) return `${symbol} ${embeddedRight}`;
    return symbol;
}

export function renderGraph(program: FProgram, trace: TraceEvent[]): { nodes: Node[]; edges: Edge[] } {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const findNode = (id: string) => nodes.find((n) => n.id === id);

    // --- トレースのインデックス化（同一nodeIdは最初の発生＝最初に需要が
    // 届いた時点を採用する） ---
    const forceIndex = new Map<string, { value: Value; memoHit: boolean }>();
    const printIndex = new Map<string, { ok: true; text: string } | { ok: false; message: string }>();
    trace.forEach((ev) => {
        if (ev.kind === 'force') {
            if (!forceIndex.has(ev.nodeId)) forceIndex.set(ev.nodeId, { value: ev.value, memoHit: ev.memoHit });
        } else if (ev.kind === 'print') {
            if (!printIndex.has(ev.nodeId)) printIndex.set(ev.nodeId, { ok: true, text: ev.text });
        } else {
            if (!printIndex.has(ev.nodeId)) printIndex.set(ev.nodeId, { ok: false, message: ev.message });
        }
    });

    // --- 静的型推論（DateFlow.md原則3-1・CLAUDE.md §4.5）。
    // forceを一切誘発しないため、未評価（ゴースト）ノードへ向かうエッジにも
    // 型ラベルを付与できる。 ---
    const findLetByName = (node: FProgram, name: string): FLet | null => {
        if (node.kind === 'Let') {
            if (node.name === name) return node;
            return findLetByName(node.body, name);
        }
        return null;
    };

    const inferType = (expr: FExpr): TypeLabel => {
        if (expr.kind === 'Lit') {
            if (typeof expr.value === 'number') return 'Number';
            if (typeof expr.value === 'string') return 'String';
            return 'Boolean';
        }
        if (expr.kind === 'PrimApp') {
            return ARITH_OPS.has(expr.op) ? 'Number' : 'Boolean';
        }
        // Var
        const binding = findLetByName(program, expr.name);
        return binding ? inferType(binding.value) : 'Unknown';
    };

    const setLiteralParent = (childId: string, parentId: string) => {
        const childNode = findNode(childId);
        if (childNode && childNode.data && childNode.data.isLiteral) {
            childNode.data.parentId = parentId;
        }
    };

    /**
     * 式を配置する（構造の再構築のみ。評価は一切行わない）。
     * レイアウトは上から下へ（CLAUDE.md §4.5）：深さ＝Y（浅い子=上、
     * 親に近いほど下）、兄弟の広がり＝X。
     */
    const place = (expr: FExpr, x: number, y: number, xSpan: number): { nodeId: string; typeLabel: TypeLabel } => {
        const typeLabel = inferType(expr);

        if (expr.kind === 'Lit') {
            const id = expr.id;
            const evalInfo = forceIndex.get(id);
            nodes.push({
                id,
                type: 'valNode',
                position: { x, y },
                data: {
                    label: `${expr.value}`,
                    isLiteral: true,
                    evalState: evalInfo ? 'evaluated' : 'unevaluated',
                    result: evalInfo?.value,
                },
            });
            return { nodeId: id, typeLabel };
        }

        if (expr.kind === 'Var') {
            const binding = findLetByName(program, expr.name);
            if (binding) {
                return { nodeId: binding.id, typeLabel };
            }
            // 未束縛の変数参照：⊥として健全にグラフ化する（§3.6）。
            // 同名の複数参照は同じ正準ゴーストIDを共有する。
            const ghostId = canonicalUnboundId(expr.name);
            const bareName = expr.name.replace(/_\d+$/, '');
            if (!findNode(ghostId)) {
                const evalInfo = forceIndex.get(ghostId);
                nodes.push({
                    id: ghostId,
                    type: 'valNode',
                    position: { x, y },
                    data: {
                        label: `${bareName} (未束縛)`,
                        isVar: true,
                        varName: bareName,
                        unbound: true,
                        evalState: evalInfo ? 'evaluated' : 'unevaluated',
                        result: evalInfo?.value,
                    },
                });
            }
            return { nodeId: ghostId, typeLabel };
        }

        // PrimApp（算術・比較・論理演算は第一級関数適用として統一的に扱う）
        const op = expr.op;
        const isUnary = op === 'Not';
        const opId = expr.id;

        const argSlots: Array<'left' | 'right'> = isUnary ? ['left'] : ['left', 'right'];
        const childResults = isUnary
            ? [place(expr.args[0], x, y - 120, xSpan)]
            : [
                  place(expr.args[0], x - xSpan / 2, y - 120, xSpan / 2),
                  place(expr.args[1], x + xSpan / 2, y - 120, xSpan / 2),
              ];

        const leftExpr = expr.args[0];
        const rightExpr = isUnary ? undefined : expr.args[1];
        const isLeftLiteral = leftExpr?.kind === 'Lit';
        const isRightLiteral = isUnary ? true : rightExpr?.kind === 'Lit';
        const isElision = isUnary ? isLeftLiteral : isLeftLiteral && isRightLiteral;
        const embeddedRight = !isElision && !isUnary && rightExpr?.kind === 'Lit' ? rightExpr.value : undefined;
        const embeddedLeft = !isElision && leftExpr?.kind === 'Lit' ? leftExpr.value : undefined;
        const hasEmbeddedLiteral = embeddedLeft !== undefined || embeddedRight !== undefined;

        const evalInfo = forceIndex.get(opId);

        nodes.push({
            id: opId,
            type: 'opNode',
            position: { x, y },
            data: {
                op,
                label: getOpLabel(op, embeddedLeft, embeddedRight),
                evalState: evalInfo ? 'evaluated' : 'unevaluated',
                result: evalInfo?.value,
                folded: false, // finalizeパスで確定
                isElision,
                embeddedLeft,
                embeddedRight,
                hasEmbeddedLiteral,
                args: {
                    left: {
                        id: childResults[0].nodeId,
                        isVar: leftExpr?.kind === 'Var',
                        name: leftExpr?.kind === 'Var' ? leftExpr.name : undefined,
                        value: leftExpr?.kind === 'Lit' ? leftExpr.value : undefined,
                    },
                    right: isUnary
                        ? null
                        : {
                              id: childResults[1].nodeId,
                              isVar: rightExpr?.kind === 'Var',
                              name: rightExpr?.kind === 'Var' ? rightExpr.name : undefined,
                              value: rightExpr?.kind === 'Lit' ? rightExpr.value : undefined,
                          },
                },
            },
        });

        childResults.forEach((r, i) => {
            const handle = argSlots[i];
            edges.push({
                id: `e_${r.nodeId}_${opId}_${handle}`,
                source: r.nodeId,
                target: opId,
                targetHandle: handle,
                animated: false,
                label: r.typeLabel,
            });
            setLiteralParent(r.nodeId, opId);
        });

        return { nodeId: opId, typeLabel };
    };

    // --- プログラム全体の走査（Letチェイン→終端Do） ---
    let statementIndex = 0;
    const varLatestId: Record<string, string> = {};

    const walkProgram = (node: FProgram): void => {
        if (node.kind === 'Let') {
            const baseX = 50 + statementIndex * 300;
            const res = place(node.value, baseX, 300, 160);

            const bareName = node.name.replace(/_\d+$/, '');
            if (varLatestId[bareName]) {
                const prevNode = findNode(varLatestId[bareName]);
                if (prevNode) prevNode.style = { ...prevNode.style, background: undefined };
            }

            const evalInfo = forceIndex.get(node.id);
            nodes.push({
                id: node.id,
                type: 'valNode',
                position: { x: baseX, y: 450 },
                data: {
                    label: node.name,
                    isVar: true,
                    varName: bareName,
                    evalState: evalInfo ? 'evaluated' : 'unevaluated',
                    result: evalInfo?.value,
                },
                style: { background: '#ffeb3b' },
            });
            varLatestId[bareName] = node.id;

            edges.push({
                id: `e_${res.nodeId}_${node.id}`,
                source: res.nodeId,
                target: node.id,
                animated: false,
                label: res.typeLabel,
            });

            statementIndex++;
            walkProgram(node.body);
            return;
        }

        // Do
        node.actions.forEach((action) => {
            const baseX = 50 + statementIndex * 300;
            const res = place(action.expr, baseX, 300, 160);
            const printResult = printIndex.get(action.id);

            nodes.push({
                id: action.id,
                type: 'printNode',
                position: { x: baseX, y: 450 },
                data: printResult
                    ? printResult.ok
                        ? { label: `Print(${printResult.text})`, evalState: 'evaluated', result: printResult.text }
                        : { label: 'Print(⊥)', error: true, evalState: 'evaluated' }
                    : { label: 'Print(?)', evalState: 'unevaluated' },
            });

            edges.push({
                id: `e_${res.nodeId}_${action.id}`,
                source: res.nodeId,
                target: action.id,
                animated: false,
                label: res.typeLabel,
            });

            statementIndex++;
        });
    };

    walkProgram(program);

    // --- Finalize: 評価状態が確定した後で、折りたたみ（Elision）と
    // 「forceされなかった入力」バッジ、エッジの需要到達状況を決定する。 ---
    nodes.forEach((node) => {
        if (node.type !== 'opNode') return;
        const evaluated = node.data.evalState === 'evaluated';
        node.data.folded = evaluated && (node.data.isElision || node.data.hasEmbeddedLiteral);

        const unforcedInputs: Array<'left' | 'right'> = [];
        if (evaluated) {
            const leftId = node.data.args?.left?.id;
            const rightId = node.data.args?.right?.id;
            if (leftId) {
                const n = findNode(leftId);
                if (n && n.data.evalState !== 'evaluated') unforcedInputs.push('left');
            }
            if (rightId) {
                const n = findNode(rightId);
                if (n && n.data.evalState !== 'evaluated') unforcedInputs.push('right');
            }
        }
        node.data.unforcedInputs = unforcedInputs;
    });

    edges.forEach((edge) => {
        const srcNode = findNode(edge.source);
        const srcEvaluated = srcNode?.data?.evalState === 'evaluated';
        edge.animated = !!srcEvaluated;
        edge.labelStyle = { fontSize: 9, fill: '#78909c', fontWeight: 600 };
        edge.labelBgStyle = { fill: '#ffffff', fillOpacity: 0.85 };
        if (!srcEvaluated) {
            edge.style = { ...edge.style, opacity: 0.35, strokeDasharray: '4 3' };
        }
    });

    return { nodes, edges };
}
