import { describe, it, expect } from 'vitest';
import { ASTNode } from './types';
import { transpileToFunctionalAst } from './transpiler';
import { evaluate } from './evaluator';
import { FDo, FLet, FPrimApp } from './functionalAst';

describe('evaluator: pure evaluate() over the functional AST', () => {
    it('evaluates a literal comparison', () => {
        const ast: ASTNode[] = [
            { type: 'Print', val: { type: 'Apply', op: 'LessThan', args: [{ type: 'Literal', value: 3 }, { type: 'Literal', value: 5 }] } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['true']);
    });

    it('evaluates a variable partial application (x=3; print(x<5))', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 3 } },
            { type: 'Print', val: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 5 }] } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['true']);
    });

    it('reduces a logical AND of literals', () => {
        const ast: ASTNode[] = [
            { type: 'Print', val: { type: 'Apply', op: 'And', args: [{ type: 'Literal', value: true }, { type: 'Literal', value: false }] } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['false']);
    });

    it('short-circuits: false AND (unbound y > 0) does not force the right-hand side and does not crash', () => {
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
        const { trace, consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['false']);

        // 右辺の GreaterThan ノードのidを特定し、trace上に対応するforceイベントが
        // 一切存在しない（＝needが届かなかった）ことを確認する。
        const doNode = program as FDo;
        const andExpr = doNode.actions[0].expr as FPrimApp;
        const gtExpr = andExpr.args[1] as FPrimApp;
        expect(trace.some((ev) => ev.nodeId === gtExpr.id)).toBe(false);
    });

    it('follows IEEE754 for division by zero and compares strings by equality', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 10 } },
            { type: 'Print', val: { type: 'Apply', op: 'Div', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 0 }] } },
            { type: 'Print', val: { type: 'Apply', op: 'Equal', args: [{ type: 'Literal', value: 'abc' }, { type: 'Literal', value: 'abc' }] } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['Infinity', 'true']);
    });

    it('leaves an unused variable permanently unevaluated (demand-driven, §3.4)', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'unused', val: { type: 'Apply', op: 'Add', args: [{ type: 'Literal', value: 1 }, { type: 'Literal', value: 2 }] } },
            { type: 'Print', val: { type: 'Literal', value: 'hello' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace, consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['hello']);

        const letNode = program as FLet;
        expect(trace.some((ev) => ev.nodeId === letNode.id)).toBe(false);
    });

    it('prints a controlled error (not a crash) when directly printing an unbound variable', () => {
        const ast: ASTNode[] = [
            { type: 'Print', val: { type: 'Var', name: 'z' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { consoleOutput } = evaluate(program);
        expect(consoleOutput).toHaveLength(1);
        expect(consoleOutput[0]).toContain('エラー');
    });

    it('memoizes repeated references to the same variable (shares the same force result)', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Literal', value: 1 }, { type: 'Literal', value: 2 }] } },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace, consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['3', '3']);

        const letNode = program as FLet;
        const forceEvents = trace.filter((ev) => ev.kind === 'force' && ev.nodeId === letNode.id);
        expect(forceEvents).toHaveLength(2);
        expect(forceEvents[0]).toMatchObject({ memoHit: false });
        expect(forceEvents[1]).toMatchObject({ memoHit: true });
    });
});
