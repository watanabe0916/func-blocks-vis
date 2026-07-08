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
});
