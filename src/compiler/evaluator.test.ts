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

    it('§5.1: forces only the scrutinee and the chosen branch of an if-else', () => {
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
        const { trace, consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['10']);

        // 選ばれなかったelse側の束縛（y_2、正準ID var_y_2）には需要が
        // 届かず、trace上に一切のイベントが存在しないこと。
        expect(trace.some((ev) => ev.nodeId === 'var_y_2')).toBe(false);
        // 選ばれたthen側の束縛（y_1）はforceされていること。
        expect(trace.some((ev) => ev.kind === 'force' && ev.nodeId === 'var_y_1')).toBe(true);
    });

    it('§5.2: runs a while loop as a letrec (sum of 0..2), sharing the pair components across projections', () => {
        // sum=0; i=0; while (i<3) { sum=sum+i; i=i+1 }; print sum; print i
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
            { type: 'Print', val: { type: 'Var', name: 'i' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['3', '3']);
    });

    it('§5.2: never runs a loop whose result is not demanded (demand-driven, §3.4)', () => {
        // while (true) { x=x+1 }; print("hi")  — 結果xに需要が無いのでループは一度も走らず停止する
        const ast: ASTNode[] = [
            {
                type: 'While',
                cond: { type: 'Literal', value: true },
                body: [{ type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 1 }] } }],
            },
            { type: 'Print', val: { type: 'Literal', value: 'hi' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { trace, consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['hi']);
        // 適用（ループの起動）そのものが一度もforceされていないこと
        expect(trace.some((ev) => ev.kind === 'force' && typeof ev.value === 'object')).toBe(false);
    });

    it('§5.2: reports a controlled error when the iteration cap is exceeded (launchbury.md §2.5)', () => {
        // x=0; while (true) { x=x+1 }; print x
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 0 } },
            {
                type: 'While',
                cond: { type: 'Literal', value: true },
                body: [{ type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 1 }] } }],
            },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { consoleOutput } = evaluate(program);
        expect(consoleOutput).toHaveLength(1);
        expect(consoleOutput[0]).toContain('エラー');
        expect(consoleOutput[0]).toContain('上限');
    });

    it('§5.2: completes 300 iterations within the cap without stack overflow', () => {
        // i=0; while (i<300) { i=i+1 }; print i
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'i', val: { type: 'Literal', value: 0 } },
            {
                type: 'While',
                cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'i' }, { type: 'Literal', value: 300 }] },
                body: [{ type: 'Assign', var: 'i', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'i' }, { type: 'Literal', value: 1 }] } }],
            },
            { type: 'Print', val: { type: 'Var', name: 'i' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['300']);
    });

    it('§5.1: does not crash when the unchosen branch contains an unbound variable (⊥ stays unforced)', () => {
        // if (true) { x=1 } else { x=z+1 }; print x  （zは未束縛）
        const ast: ASTNode[] = [
            {
                type: 'If',
                cond: { type: 'Literal', value: true },
                then: [{ type: 'Assign', var: 'x', val: { type: 'Literal', value: 1 } }],
                else: [{ type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'z' }, { type: 'Literal', value: 1 }] } }],
            },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const { consoleOutput } = evaluate(program);
        expect(consoleOutput).toEqual(['1']);
    });
});
