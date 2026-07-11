import { describe, it, expect } from 'vitest';
import { ASTNode } from './types';
import { transpileToFunctionalAst } from './transpiler';
import { evaluate } from './evaluator';
import { renderGraph } from './renderGraph';

describe('renderGraph: pure trace-driven graph derivation', () => {
    it('folds a literal-only comparison (Elision) once evaluated', () => {
        const ast: ASTNode[] = [
            { type: 'Print', val: { type: 'Apply', op: 'LessThan', args: [{ type: 'Literal', value: 3 }, { type: 'Literal', value: 5 }] } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace } = evaluate(program);
        const { nodes } = renderGraph(program, trace);

        const opNode = nodes.find((n) => n.type === 'opNode');
        expect(opNode?.data.evalState).toBe('evaluated');
        expect(opNode?.data.folded).toBe(true);
        expect(opNode?.data.result).toBe(true);
    });

    it('marks a short-circuited right-hand node as unevaluated (unforcedInputs badge)', () => {
        const ast: ASTNode[] = [
            {
                type: 'Print',
                val: {
                    type: 'Apply',
                    op: 'And',
                    args: [
                        { type: 'Literal', value: false },
                        { type: 'Apply', op: 'GreaterThan', args: [{ type: 'Var', name: 'y' }, { type: 'Literal', value: 0 }] },
                    ],
                },
            },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace } = evaluate(program);
        const { nodes } = renderGraph(program, trace);

        const andNode = nodes.find((n) => n.type === 'opNode' && n.data.op === 'And');
        expect(andNode?.data.evalState).toBe('evaluated');
        expect(andNode?.data.unforcedInputs).toContain('right');

        const gtNode = nodes.find((n) => n.type === 'opNode' && n.data.op === 'GreaterThan');
        expect(gtNode?.data.evalState).toBe('unevaluated');

        const ghostNode = nodes.find((n) => n.data.unbound);
        expect(ghostNode?.data.evalState).toBe('unevaluated');
        expect(ghostNode?.data.varName).toBe('y');
    });

    it('labels every edge with a static type, including edges into unevaluated nodes', () => {
        const ast: ASTNode[] = [
            {
                type: 'Print',
                val: {
                    type: 'Apply',
                    op: 'And',
                    args: [
                        { type: 'Literal', value: false },
                        { type: 'Apply', op: 'GreaterThan', args: [{ type: 'Var', name: 'y' }, { type: 'Literal', value: 0 }] },
                    ],
                },
            },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace } = evaluate(program);
        const { edges } = renderGraph(program, trace);

        expect(edges.length).toBeGreaterThan(0);
        edges.forEach((edge) => {
            expect(['Number', 'String', 'Boolean', 'Unknown']).toContain(edge.label);
        });

        const gtEdge = edges.find((e) => e.target && e.label === 'Boolean' && e.animated === false);
        expect(gtEdge).toBeDefined();
    });

    it('resolves a Var reference to the canonical binding node (not a separate Var node)', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 3 } },
            { type: 'Print', val: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 5 }] } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace } = evaluate(program);
        const { nodes, edges } = renderGraph(program, trace);

        const varNode = nodes.find((n) => n.data.isVar && n.data.varName === 'x');
        expect(varNode).toBeDefined();
        expect(varNode?.data.label).toBe('x_1');

        // x_1 ノードから比較演算ノードへ、直接1本のエッジが伸びていること
        const opNode = nodes.find((n) => n.type === 'opNode');
        const edgeFromVar = edges.find((e) => e.source === varNode!.id && e.target === opNode!.id);
        expect(edgeFromVar).toBeDefined();
    });

    it('keeps node/edge count small and finite for a short program (no runaway generation)', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 3 } },
            { type: 'Print', val: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 5 }] } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace } = evaluate(program);
        const { nodes, edges } = renderGraph(program, trace);

        expect(nodes.length).toBeLessThan(10);
        expect(edges.length).toBeLessThan(10);
    });

    it('§5.1: renders an ifNode with three typed edges and marks the skipped branch as ghost', () => {
        // x=1; if (x<5) { y=10 } else { y=20 }; print y
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 1 } },
            {
                type: 'If',
                cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 5 }] },
                then: [{ type: 'Assign', var: 'y', val: { type: 'Literal', value: 10 } }],
                else: [{ type: 'Assign', var: 'y', val: { type: 'Literal', value: 20 } }],
            },
            { type: 'Print', val: { type: 'Var', name: 'y' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace } = evaluate(program);
        const { nodes, edges } = renderGraph(program, trace);

        const ifNode = nodes.find((n) => n.type === 'ifNode');
        expect(ifNode).toBeDefined();
        expect(ifNode?.data.evalState).toBe('evaluated');
        expect(ifNode?.data.result).toBe(10);
        // 条件が true だったので else 側がスキップされたと判定される
        expect(ifNode?.data.skippedBranch).toBe('else');

        // cond/then/else の3本のエッジがあり、すべて型ラベルを持つ
        const inEdges = edges.filter((e) => e.target === ifNode!.id);
        expect(inEdges).toHaveLength(3);
        expect(inEdges.map((e) => e.targetHandle).sort()).toEqual(['cond', 'else', 'then']);
        inEdges.forEach((e) => {
            expect(['Number', 'String', 'Boolean', 'Unknown']).toContain(e.label);
        });

        // 選ばれなかったelse側の束縛ノード（y_2）は未評価ゴーストのまま残る
        const elseArm = nodes.find((n) => n.id === 'var_y_2');
        expect(elseArm?.data.evalState).toBe('unevaluated');
        // 選ばれたthen側の束縛ノード（y_1）は評価済み
        const thenArm = nodes.find((n) => n.id === 'var_y_1');
        expect(thenArm?.data.evalState).toBe('evaluated');
    });

    it('§5.2: renders a while loop as a loopNode with parameter nodes and apply nodes', () => {
        // sum=0; i=0; while (i<3) { sum=sum+i; i=i+1 }; print sum
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'sum', val: { type: 'Literal', value: 0 } },
            { type: 'Assign', var: 'i', val: { type: 'Literal', value: 0 } },
            {
                type: 'While',
                cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'i' }, { type: 'Literal', value: 3 }] },
                body: [
                    { type: 'Assign', var: 'sum', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'sum' }, { type: 'Var', name: 'i' }] } },
                    { type: 'Assign', var: 'i', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'i' }, { type: 'Literal', value: 1 }] } },
                ],
            },
            { type: 'Print', val: { type: 'Var', name: 'sum' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace } = evaluate(program);
        const { nodes, edges } = renderGraph(program, trace);

        // letrec関数定義ノード（破線枠）と、末尾自己呼び出し＋初回起動の
        // 2つのapplyノード（小さな四角）が描かれる
        const loopNode = nodes.find((n) => n.type === 'loopNode');
        expect(loopNode).toBeDefined();
        expect(loopNode?.data.evalState).toBe('evaluated');
        const applyNodes = nodes.filter((n) => n.type === 'applyNode');
        expect(applyNodes.length).toBe(2);

        // 仮引数（ループ先頭のφ）ノードが存在し、初回反復の値（初期値）を表示する
        const paramSum = nodes.find((n) => n.id === 'var_sum_2');
        const paramI = nodes.find((n) => n.id === 'var_i_2');
        expect(paramSum?.data.evalState).toBe('evaluated');
        expect(paramSum?.data.result).toBe(0);
        expect(paramI?.data.result).toBe(0);

        // 健全性指標：ノード数はブロック数に対して線形に収まる
        expect(nodes.length).toBeLessThan(40);
        expect(edges.length).toBeLessThan(40);
    });

    it('§5.2: draws a free-variable capture edge from a loop-invariant binding into the loop body', () => {
        // n=5; x=0; while (x<n) { x=x+n }; print x
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'n', val: { type: 'Literal', value: 5 } },
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 0 } },
            {
                type: 'While',
                cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'x' }, { type: 'Var', name: 'n' }] },
                body: [
                    { type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Var', name: 'n' }] } },
                ],
            },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace } = evaluate(program);
        const { edges } = renderGraph(program, trace);

        // ループ不変変数 n_1 の束縛ノードからループ本体内の演算ノードへ
        // エッジが伸びる（Weck & Tichy 原則4-2の自由変数捕捉エッジ）
        const captureEdges = edges.filter((e) => e.source === 'var_n_1');
        expect(captureEdges.length).toBeGreaterThan(0);
    });

    it('§5.1: renders a shared %cond binding as a single 条件 node feeding every φ', () => {
        // a=1; if (a<5) { x=1; y=2 } else { x=3 }; print x; print y
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'a', val: { type: 'Literal', value: 1 } },
            {
                type: 'If',
                cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'a' }, { type: 'Literal', value: 5 }] },
                then: [
                    { type: 'Assign', var: 'x', val: { type: 'Literal', value: 1 } },
                    { type: 'Assign', var: 'y', val: { type: 'Literal', value: 2 } },
                ],
                else: [{ type: 'Assign', var: 'x', val: { type: 'Literal', value: 3 } }],
            },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
            { type: 'Print', val: { type: 'Var', name: 'y' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace } = evaluate(program);
        const { nodes, edges } = renderGraph(program, trace);

        // 条件ノードは1つだけ（条件式の複製をしていない）
        const condNodes = nodes.filter((n) => n.data.isCondBinding);
        expect(condNodes).toHaveLength(1);

        // その条件ノードから両方のifノードへエッジが伸びている
        const ifNodes = nodes.filter((n) => n.type === 'ifNode');
        expect(ifNodes).toHaveLength(2);
        ifNodes.forEach((ifNode) => {
            const condEdge = edges.find((e) => e.target === ifNode.id && e.targetHandle === 'cond');
            expect(condEdge?.source).toBe(condNodes[0].id);
        });
    });
});
