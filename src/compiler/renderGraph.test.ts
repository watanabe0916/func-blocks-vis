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
