import { Node, Edge } from 'reactflow';
import { Value, OP_SYMBOLS } from './types';
import { FExpr, FProgram, PrimOp, canonicalVarId, canonicalUnboundId } from './functionalAst';
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

    // --- 束縛インデックス（§5.2でプログラムレベルのLet以外に、LetRecの
    // 仮引数・関数名、式レベルのLetInが束縛の発生源に加わったため、事前に
    // 全束縛を名前→{正準ノードid, 束縛式}で索引する）。Varはノードを生成せず、
    // このインデックス経由で束縛元ノードへ解決される。 ---
    const binderIndex = new Map<string, { id: string; value?: FExpr }>();
    const indexExpr = (e: FExpr): void => {
        switch (e.kind) {
            case 'LetIn':
                binderIndex.set(e.name, { id: e.id, value: e.value });
                indexExpr(e.value);
                indexExpr(e.body);
                break;
            case 'PrimApp':
                e.args.forEach(indexExpr);
                break;
            case 'If':
                indexExpr(e.cond);
                indexExpr(e.then);
                indexExpr(e.else);
                break;
            case 'Apply':
                e.args.forEach(indexExpr);
                break;
            case 'Pair':
                indexExpr(e.fst);
                indexExpr(e.snd);
                break;
            case 'Proj':
                indexExpr(e.pair);
                break;
            default:
                break;
        }
    };
    const indexProgram = (p: FProgram): void => {
        if (p.kind === 'Let') {
            binderIndex.set(p.name, { id: p.id, value: p.value });
            indexExpr(p.value);
            indexProgram(p.body);
        } else if (p.kind === 'LetRec') {
            binderIndex.set(p.name, { id: p.id });
            // 仮引数＝ループ先頭のφ。値式を持たないため型は Unknown となる。
            p.params.forEach((par) => binderIndex.set(par, { id: canonicalVarId(par) }));
            indexExpr(p.fnBody);
            indexProgram(p.body);
        } else {
            p.actions.forEach((a) => indexExpr(a.expr));
        }
    };
    indexProgram(program);

    // --- 静的型推論（DateFlow.md原則3-1・CLAUDE.md §4.5）。
    // forceを一切誘発しないため、未評価（ゴースト）ノードへ向かうエッジにも
    // 型ラベルを付与できる。 ---
    const inferType = (expr: FExpr): TypeLabel => {
        if (expr.kind === 'Lit') {
            if (typeof expr.value === 'number') return 'Number';
            if (typeof expr.value === 'string') return 'String';
            return 'Boolean';
        }
        if (expr.kind === 'PrimApp') {
            return ARITH_OPS.has(expr.op) ? 'Number' : 'Boolean';
        }
        if (expr.kind === 'If') {
            // φ（三項演算子）の型は両腕の型の合流。片腕が未束縛（⊥）なら
            // もう一方の型を採用する——⊥は全型に属する（§3.6）ため健全。
            const thenType = inferType(expr.then);
            const elseType = inferType(expr.else);
            if (thenType === 'Unknown') return elseType;
            if (elseType === 'Unknown') return thenType;
            return thenType === elseType ? thenType : 'Unknown';
        }
        if (expr.kind === 'LetIn') {
            return inferType(expr.body);
        }
        if (expr.kind === 'Apply' || expr.kind === 'Pair' || expr.kind === 'Proj') {
            // 関数適用・対・射影の返り値型は仮引数（値式を持たない）を経由する
            // ため静的には確定しない。§5.4のラムダ導入時に型注釈と併せて拡張する。
            return 'Unknown';
        }
        // Var
        const binding = binderIndex.get(expr.name);
        return binding?.value ? inferType(binding.value) : 'Unknown';
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
            const binding = binderIndex.get(expr.name);
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

        if (expr.kind === 'If') {
            // 三項演算子（φ合流、§5.1）。cond/then/else の3入力を持つ専用
            // ノードとして描く。選ばれなかった分岐の腕はtrace上にforce
            // イベントを持たないため、既存のエッジ減光規則（source未評価→
            // ゴースト破線）だけで「分岐のスキップ」が自動的に可視化される。
            const condRes = place(expr.cond, x - xSpan / 2, y - 120, xSpan / 3);
            const thenRes = place(expr.then, x, y - 120, xSpan / 3);
            const elseRes = place(expr.else, x + xSpan / 2, y - 120, xSpan / 3);

            const evalInfo = forceIndex.get(expr.id);
            nodes.push({
                id: expr.id,
                type: 'ifNode',
                position: { x, y },
                data: {
                    label: 'if',
                    evalState: evalInfo ? 'evaluated' : 'unevaluated',
                    result: evalInfo?.value,
                    args: {
                        cond: { id: condRes.nodeId },
                        then: { id: thenRes.nodeId },
                        else: { id: elseRes.nodeId },
                    },
                },
            });

            (
                [
                    ['cond', condRes],
                    ['then', thenRes],
                    ['else', elseRes],
                ] as const
            ).forEach(([handle, r]) => {
                edges.push({
                    id: `e_${r.nodeId}_${expr.id}_${handle}`,
                    source: r.nodeId,
                    target: expr.id,
                    targetHandle: handle,
                    animated: false,
                    label: r.typeLabel,
                });
            });

            return { nodeId: expr.id, typeLabel };
        }

        if (expr.kind === 'LetIn') {
            // 式レベルの束縛（ループ本体内のSSA束縛、§5.2）。let は透明であり、
            // LetIn式のデータフロー上の出力は body の出力そのものである。
            // 束縛変数ノードは値式の下に描き、評価状態は trace の最初の発生
            // （＝初回反復）の値を表示する。
            const valRes = place(expr.value, x - 60, y - 60, xSpan / 2);
            if (!findNode(expr.id)) {
                const evalInfo = forceIndex.get(expr.id);
                nodes.push({
                    id: expr.id,
                    type: 'valNode',
                    position: { x: x - 60, y },
                    data: {
                        label: expr.name,
                        isVar: true,
                        varName: expr.name.replace(/_\d+$/, ''),
                        evalState: evalInfo ? 'evaluated' : 'unevaluated',
                        result: evalInfo?.value,
                    },
                });
                edges.push({
                    id: `e_${valRes.nodeId}_${expr.id}`,
                    source: valRes.nodeId,
                    target: expr.id,
                    animated: false,
                    label: valRes.typeLabel,
                });
            }
            return place(expr.body, x + 140, y, xSpan);
        }

        if (expr.kind === 'Apply') {
            // 関数適用は小さな四角の apply ノード（CLAUDE.md §4.5）。
            // 関数定義（LetRecノード）からは破線のエッジを引き、静的定義と
            // 動的適用を視覚的に区別する。末尾自己呼び出しの場合、このエッジは
            // グラフ上のサイクルとなり、再帰そのものを表す。
            const argCount = expr.args.length;
            const step = argCount > 1 ? xSpan / (argCount - 1) : 0;
            const argResults = expr.args.map((a, i) =>
                place(a, x + (i - (argCount - 1) / 2) * step, y - 120, xSpan / Math.max(2, argCount))
            );

            const evalInfo = forceIndex.get(expr.id);
            nodes.push({
                id: expr.id,
                type: 'applyNode',
                position: { x, y },
                data: {
                    label: expr.fn.replace(/^%/, ''),
                    fnName: expr.fn,
                    evalState: evalInfo ? 'evaluated' : 'unevaluated',
                    result: evalInfo?.value,
                },
            });

            argResults.forEach((r, i) => {
                edges.push({
                    id: `e_${r.nodeId}_${expr.id}_arg${i}`,
                    source: r.nodeId,
                    target: expr.id,
                    animated: false,
                    label: r.typeLabel,
                });
            });
            const fnBinding = binderIndex.get(expr.fn);
            if (fnBinding) {
                edges.push({
                    id: `e_${fnBinding.id}_${expr.id}_fn`,
                    source: fnBinding.id,
                    target: expr.id,
                    targetHandle: 'fn',
                    animated: false,
                    style: { strokeDasharray: '6 4' },
                });
            }
            return { nodeId: expr.id, typeLabel };
        }

        if (expr.kind === 'Pair') {
            // 対のコンストラクタ（WHNF、§3.2）。二項演算と同じ矩形で描く。
            const leftRes = place(expr.fst, x - xSpan / 2, y - 120, xSpan / 2);
            const rightRes = place(expr.snd, x + xSpan / 2, y - 120, xSpan / 2);
            const evalInfo = forceIndex.get(expr.id);
            nodes.push({
                id: expr.id,
                type: 'opNode',
                position: { x, y },
                data: {
                    op: 'Pair',
                    label: '⟨ , ⟩',
                    evalState: evalInfo ? 'evaluated' : 'unevaluated',
                    result: evalInfo?.value,
                    folded: false,
                    isElision: false,
                    hasEmbeddedLiteral: false,
                    args: {
                        left: { id: leftRes.nodeId },
                        right: { id: rightRes.nodeId },
                    },
                },
            });
            edges.push(
                { id: `e_${leftRes.nodeId}_${expr.id}_left`, source: leftRes.nodeId, target: expr.id, targetHandle: 'left', animated: false, label: leftRes.typeLabel },
                { id: `e_${rightRes.nodeId}_${expr.id}_right`, source: rightRes.nodeId, target: expr.id, targetHandle: 'right', animated: false, label: rightRes.typeLabel }
            );
            return { nodeId: expr.id, typeLabel };
        }

        if (expr.kind === 'Proj') {
            // 射影（fst/snd）。単項演算と同じ形で描く。
            const innerRes = place(expr.pair, x, y - 120, xSpan);
            const evalInfo = forceIndex.get(expr.id);
            nodes.push({
                id: expr.id,
                type: 'opNode',
                position: { x, y },
                data: {
                    op: expr.which === 'fst' ? 'Fst' : 'Snd',
                    label: expr.which,
                    evalState: evalInfo ? 'evaluated' : 'unevaluated',
                    result: evalInfo?.value,
                    folded: false,
                    isElision: false,
                    hasEmbeddedLiteral: false,
                    args: {
                        left: { id: innerRes.nodeId },
                        right: null,
                    },
                },
            });
            edges.push({
                id: `e_${innerRes.nodeId}_${expr.id}_left`,
                source: innerRes.nodeId,
                target: expr.id,
                targetHandle: 'left',
                animated: false,
                label: innerRes.typeLabel,
            });
            return { nodeId: expr.id, typeLabel };
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
            // トランスパイラが条件式の共有のために生成した合成束縛
            // （%cond_n、§5.1）。ユーザー変数ではないため「最新版の
            // ハイライト」の対象にせず、「条件」ノードとして描く。
            const isCondBinding = bareName === '%cond';

            if (!isCondBinding && varLatestId[bareName]) {
                const prevNode = findNode(varLatestId[bareName]);
                if (prevNode) prevNode.style = { ...prevNode.style, background: undefined };
            }

            const evalInfo = forceIndex.get(node.id);
            nodes.push({
                id: node.id,
                type: 'valNode',
                position: { x: baseX, y: 450 },
                data: {
                    label: isCondBinding ? '条件' : node.name,
                    isVar: true,
                    isCondBinding,
                    varName: bareName,
                    evalState: evalInfo ? 'evaluated' : 'unevaluated',
                    result: evalInfo?.value,
                },
                style: isCondBinding ? undefined : { background: '#ffeb3b' },
            });
            if (!isCondBinding) varLatestId[bareName] = node.id;

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

        if (node.kind === 'LetRec') {
            // whileループの自己参照関数（§5.2）。仮引数（ループ先頭のφ）を
            // 上段に並べ、関数本体のデータフローをその下に描き、末尾を
            // 関数定義ノード（loopNode）へ束ねる。ループ不変変数（自由変数）
            // への参照は binderIndex 経由で外側の束縛ノードへ自然に接続され、
            // transform.md (c) / Weck & Tichy 原則4-2（自由変数捕捉エッジ）の
            // 可視化がそのまま得られる。
            const baseX = 50 + statementIndex * 300;

            node.params.forEach((p, i) => {
                const pid = canonicalVarId(p);
                const evalInfo = forceIndex.get(pid);
                nodes.push({
                    id: pid,
                    type: 'valNode',
                    position: { x: baseX + i * 150, y: 30 },
                    data: {
                        label: p,
                        isVar: true,
                        isLoopParam: true,
                        varName: p.replace(/_\d+$/, ''),
                        evalState: evalInfo ? 'evaluated' : 'unevaluated',
                        result: evalInfo?.value,
                    },
                });
            });

            const res = place(node.fnBody, baseX + 150, 340, 240);

            const evalInfo = forceIndex.get(node.id);
            nodes.push({
                id: node.id,
                type: 'loopNode',
                position: { x: baseX + 150, y: 470 },
                data: {
                    label: node.name.replace(/^%/, ''),
                    params: node.params,
                    evalState: evalInfo ? 'evaluated' : 'unevaluated',
                },
            });
            edges.push({
                id: `e_${res.nodeId}_${node.id}`,
                source: res.nodeId,
                target: node.id,
                animated: false,
                label: res.typeLabel,
            });

            statementIndex += 2;
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
        if (node.type === 'ifNode') {
            // 評価済みのifノードでは、条件の値から選ばれなかった側の分岐を
            // 確定してバッジ表示に使う（traceの読み取りのみで判定する）。
            const condInfo = forceIndex.get(node.data.args?.cond?.id);
            node.data.skippedBranch =
                node.data.evalState === 'evaluated' && condInfo
                    ? condInfo.value
                        ? 'else'
                        : 'then'
                    : null;
            return;
        }
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
