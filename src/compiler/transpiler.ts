import { Node, Edge } from 'reactflow';
import { ASTNode, ExpressionNode, ApplyNode, Value, Thunk, Env, OP_SYMBOLS } from './types';

interface TranspileResult {
    nodes: Node[];
    edges: Edge[];
    consoleOutput: string[];
}

// 演算子は特殊構文ではなく、すべて「Thunk配列を受け取り値を返す組込関数」として
// 一様に定義する。And/Or の非正格性（右辺を状況次第でしか force しない）は
// 関数の中身として表現され、評価器（Applyの適用規則）側には
// 短絡評価のための特殊分岐は一切存在しない（CLAUDE.md §3.5）。
type Builtin = (args: Thunk[]) => Value;

function getOpLabel(op: ApplyNode['op'], embeddedLeft?: Value, embeddedRight?: Value): string {
    const symbol = OP_SYMBOLS[op];
    if (op === 'Not') return symbol;
    if (embeddedLeft !== undefined) return `${embeddedLeft} ${symbol}`;
    if (embeddedRight !== undefined) return `${symbol} ${embeddedRight}`;
    return symbol;
}

/**
 * SSAグラフの生成（構造構築）と、需要駆動評価（force）による
 * 実行結果（コンソール出力）の算出を行う。
 *
 * Pass 1（構造構築）: AST全体を無条件に走査し、すべての部分式をノード/エッジとして
 * グラフ化する。この時点では一切の値計算を行わない（すべて unevaluated）。
 * Pass 2（需要駆動評価）: 仮想コンソールへの出力（Print文）を需要の根とし、
 * そこから force() を辿ることで、実際に必要な部分だけが評価される。
 * 需要が届かなかったThunk（短絡された右辺・未使用の変数など）は
 * 最後まで unevaluated のまま残る（§3.4）。
 */
export function transpileToSSA(ast: ASTNode[]): TranspileResult {
    const versions: Record<string, number> = {}; // 変数のバージョン管理（構造的な命名の関心事） { x: 1, y: 1 }
    const env: Env = new Map(); // 変数名+バージョン -> Thunk（値の束縛。§4.1）
    const unboundGhosts = new Map<string, Thunk>(); // 未束縛変数の⊥Thunkキャッシュ
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const consoleOutput: string[] = [];
    let yOffset = 50;
    let idCounter = 0;

    const nextId = (prefix: string) => `${prefix}_${idCounter++}`;
    const findNode = (id: string) => nodes.find(n => n.id === id);

    const getVarVersion = (name: string) => versions[name] || 0;
    const incrementVarVersion = (name: string) => {
        versions[name] = getVarVersion(name) + 1;
        return versions[name];
    };

    const setLiteralParent = (childId: string, parentId: string) => {
        const childNode = findNode(childId);
        if (childNode && childNode.data && childNode.data.isLiteral) {
            childNode.data.parentId = parentId;
        }
    };

    /**
     * Thunkを弱頭部正規形（WHNF）まで強制し、対応するグラフノードへ
     * evalState/result を書き戻す（可視化のための副作用）。
     *
     * 一度 evaluated になったThunkは再計算されずキャッシュされた値を返す
     * （call-by-need = call-by-name + sharing, §3.3）。この可変セルによる
     * メモ化は外部から観測不可能な benign effect である：force() は
     * 同一のThunkに対して常に同じ値を返す純関数として振る舞い、
     * 「メモ化されている」という事実そのものは観測できない。
     * ゆえにこの可変性は「純粋関数型」という前提を破らない。
     */
    const force = (thunk: Thunk): Value => {
        if (thunk.cell.state === 'evaluated') {
            return thunk.cell.value;
        }
        const value = thunk.cell.compute();
        thunk.cell = { state: 'evaluated', value };
        const node = findNode(thunk.nodeId);
        if (node) {
            node.data = { ...node.data, evalState: 'evaluated', result: value };
        }
        return value;
    };

    const BUILTINS: Record<ApplyNode['op'], Builtin> = {
        Add: (a) => Number(force(a[0])) + Number(force(a[1])),
        Sub: (a) => Number(force(a[0])) - Number(force(a[1])),
        Mul: (a) => Number(force(a[0])) * Number(force(a[1])),
        // 0除算はIEEE754のネイティブ挙動（Infinity/-Infinity/NaN）に委ねる。
        // 「静かに0を返す」ような特殊ガードは設けない。
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

    /**
     * 式のグラフ化（Pass 1: 構造構築）。すべての部分式を無条件にノード化する。
     * 値の計算は一切行わない（force()が呼ばれるまで実行されない）。
     */
    const buildExpr = (
        expr: ExpressionNode | undefined,
        currentX: number,
        currentY: number,
        ySpan: number
    ): { nodeId: string; thunk: Thunk } => {
        if (!expr) {
            // 空のソケット（未接続の入力）。落ちないよう安全な既定値のThunkを割り当てる。
            const id = nextId('val');
            nodes.push({
                id,
                type: 'valNode',
                position: { x: currentX, y: currentY },
                data: { label: '0', isLiteral: true, evalState: 'unevaluated' }
            });
            const thunk: Thunk = { nodeId: id, cell: { state: 'unevaluated', compute: () => 0 } };
            return { nodeId: id, thunk };
        }

        if (expr.type === 'Literal') {
            const id = nextId('val');
            nodes.push({
                id,
                type: 'valNode',
                position: { x: currentX, y: currentY },
                data: { label: `${expr.value}`, isLiteral: true, evalState: 'unevaluated' }
            });
            const thunk: Thunk = { nodeId: id, cell: { state: 'unevaluated', compute: () => expr.value } };
            return { nodeId: id, thunk };
        }

        if (expr.type === 'Var') {
            const ver = getVarVersion(expr.name);
            const id = `var_${expr.name}_${ver}`;
            const bound = env.get(id);
            if (bound) {
                return { nodeId: id, thunk: bound };
            }

            // 未束縛の変数参照：⊥（ボトム）としてグラフには健全に存在させ、
            // forceされた場合にのみ制御されたエラーとして扱う（§3.6）。
            // 需要が届かなければ（例：短絡評価で読まれない右辺）、
            // このThunkは永遠にforceされずプログラム全体は問題なく停止する。
            const ghostId = `var_${expr.name}_unbound`;
            let thunk = unboundGhosts.get(ghostId);
            if (!thunk) {
                nodes.push({
                    id: ghostId,
                    type: 'valNode',
                    position: { x: currentX, y: currentY },
                    data: { label: `${expr.name} (未束縛)`, isVar: true, varName: expr.name, unbound: true, evalState: 'unevaluated' }
                });
                thunk = {
                    nodeId: ghostId,
                    cell: {
                        state: 'unevaluated',
                        compute: () => { throw new Error(`未束縛の変数 '${expr.name}' が要求されました`); }
                    }
                };
                unboundGhosts.set(ghostId, thunk);
            }
            return { nodeId: ghostId, thunk };
        }

        // Apply（算術・比較・論理演算はすべて第一級関数適用として統一的に扱う）
        const op = expr.op;
        const isUnary = op === 'Not';
        const opId = nextId(`op_${op.toLowerCase()}`);

        const argSlots: Array<'left' | 'right'> = isUnary ? ['left'] : ['left', 'right'];
        const argResults = isUnary
            ? [buildExpr(expr.args[0], currentX - 120, currentY, ySpan)]
            : [
                buildExpr(expr.args[0], currentX - 120, currentY - ySpan / 2, ySpan / 2),
                buildExpr(expr.args[1], currentX - 120, currentY + ySpan / 2, ySpan / 2),
              ];
        const argThunks = argResults.map(r => r.thunk);

        const leftExpr = expr.args[0];
        const rightExpr = isUnary ? undefined : expr.args[1];
        const isLeftLiteral = leftExpr?.type === 'Literal';
        const isRightLiteral = isUnary ? true : rightExpr?.type === 'Literal';
        const isElision = isUnary ? isLeftLiteral : (isLeftLiteral && isRightLiteral);
        const embeddedRight = (!isElision && !isUnary && rightExpr?.type === 'Literal') ? rightExpr.value : undefined;
        const embeddedLeft = (!isElision && leftExpr?.type === 'Literal') ? leftExpr.value : undefined;
        const hasEmbeddedLiteral = embeddedLeft !== undefined || embeddedRight !== undefined;

        nodes.push({
            id: opId,
            type: 'opNode',
            position: { x: currentX, y: currentY },
            data: {
                op,
                label: getOpLabel(op, embeddedLeft, embeddedRight),
                evalState: 'unevaluated',
                folded: false,
                isElision,
                embeddedLeft,
                embeddedRight,
                hasEmbeddedLiteral,
                args: {
                    left: { id: argResults[0].nodeId, isVar: leftExpr?.type === 'Var', name: leftExpr?.type === 'Var' ? leftExpr.name : undefined, value: leftExpr?.type === 'Literal' ? leftExpr.value : undefined },
                    right: isUnary ? null : { id: argResults[1].nodeId, isVar: rightExpr?.type === 'Var', name: rightExpr?.type === 'Var' ? rightExpr.name : undefined, value: rightExpr?.type === 'Literal' ? rightExpr.value : undefined },
                },
            }
        });

        argResults.forEach((r, i) => {
            const handle = argSlots[i];
            edges.push({ id: `e_${r.nodeId}_${opId}_${handle}`, source: r.nodeId, target: opId, targetHandle: handle, animated: false });
            setLiteralParent(r.nodeId, opId);
        });

        const thunk: Thunk = {
            nodeId: opId,
            cell: { state: 'unevaluated', compute: () => BUILTINS[op](argThunks) }
        };

        return { nodeId: opId, thunk };
    };

    const varLatestNodeId: Record<string, string> = {}; // 各変数の最新ノードIDを記録
    const pendingPrints: Array<{ printId: string; thunk: Thunk }> = [];

    // Pass 1: ASTを一行ずつ走査し、グラフ構造をすべて構築する（評価は行わない）
    ast.forEach((stmt, index) => {
        if (stmt.type === 'Assign') {
            const res = buildExpr(stmt.val, 300, yOffset, 160);

            const ver = incrementVarVersion(stmt.var);
            const varId = `var_${stmt.var}_${ver}`;

            // 以前のバージョンがあれば、その強調（黄色）を解除する
            if (varLatestNodeId[stmt.var]) {
                const prevNode = findNode(varLatestNodeId[stmt.var]);
                if (prevNode) {
                    prevNode.style = { ...prevNode.style, background: undefined };
                }
            }

            nodes.push({
                id: varId,
                type: 'valNode',
                position: { x: 450, y: yOffset },
                data: {
                    label: `${stmt.var}_${ver}`,
                    isVar: true,
                    varName: stmt.var,
                    version: ver,
                    evalState: 'unevaluated'
                },
                style: { background: '#ffeb3b' } // 常に最初は強調
            });
            varLatestNodeId[stmt.var] = varId;

            edges.push({ id: `e_${res.nodeId}_${varId}`, source: res.nodeId, target: varId, animated: false });

            // 代入は束縛するだけで force しない（§3.4）。値は需要が届いた時点で初めて評価される。
            const varThunk: Thunk = {
                nodeId: varId,
                cell: { state: 'unevaluated', compute: () => force(res.thunk) }
            };
            env.set(varId, varThunk);

            yOffset += 160;

        } else if (stmt.type === 'Print') {
            const res = buildExpr(stmt.val, 420, yOffset, 160);
            const printId = `print_${index}`;

            nodes.push({
                id: printId,
                type: 'printNode',
                position: { x: 570, y: yOffset },
                data: { label: 'Print(?)', evalState: 'unevaluated' }
            });

            edges.push({ id: `e_${res.nodeId}_${printId}`, source: res.nodeId, target: printId, animated: false });

            pendingPrints.push({ printId, thunk: res.thunk });
            yOffset += 160;
        }
    });

    // Pass 2: 仮想コンソール（Print文）を需要の根として、必要な部分だけをforceする。
    // 1つのPrintの需要が失敗（⊥の強制）しても、後続のPrintの処理は継続する。
    pendingPrints.forEach(({ printId, thunk }) => {
        const printNode = findNode(printId);
        try {
            const value = force(thunk);
            if (printNode) {
                printNode.data = { ...printNode.data, evalState: 'evaluated', result: value, label: `Print(${value})` };
            }
            consoleOutput.push(String(value));
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (printNode) {
                printNode.data = { ...printNode.data, error: true, label: 'Print(⊥)' };
            }
            consoleOutput.push(`[エラー] ${message}`);
        }
    });

    // Finalize: 評価状態が確定した後で、折りたたみ（Elision）と
    // 「forceされなかった入力」バッジ、エッジの需要到達状況を決定する。
    nodes.forEach(node => {
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

    edges.forEach(edge => {
        const srcNode = findNode(edge.source);
        const srcEvaluated = srcNode?.data?.evalState === 'evaluated';
        edge.animated = !!srcEvaluated;
        if (!srcEvaluated) {
            edge.style = { ...edge.style, opacity: 0.35, strokeDasharray: '4 3' };
        }
    });

    return { nodes, edges, consoleOutput };
}
