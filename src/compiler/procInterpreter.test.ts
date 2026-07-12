import { describe, it, expect } from 'vitest';
import { ASTNode } from './types';
import { runProcedural } from './procInterpreter';
import { transpileToFunctionalAst } from './transpiler';
import { evaluate } from './evaluator';

/**
 * §4.8 手続型参照インタプリタのテスト。
 * 「①変換元の操作的意味論」の実行可能な定義として、(a) 停止するプログラム
 * では関数型実行（evaluate ∘ transpile）と観測等価であること、(b) 停止しない
 * プログラムでは両者の停止性が非対称になる（call-by-needがより多く停止する）
 * ことを機械的に確認する。
 */

describe('procInterpreter: strict sequential reference semantics (§4.8)', () => {
    it('matches the functional pipeline output on a terminating program (observational equivalence)', () => {
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
        const proc = runProcedural(ast);
        expect(proc.status).toBe('ok');
        expect(proc.output).toEqual(['3', '3']);

        const { consoleOutput } = evaluate(transpileToFunctionalAst(ast));
        expect(proc.output).toEqual(consoleOutput);
    });

    it('short-circuits And like a procedural language (JS-style), matching the functional side', () => {
        // print(false && (y > 0)) — yは未定義だが、手続型でも短絡により評価されない
        const ast: ASTNode[] = [
            {
                type: 'Print',
                val: {
                    type: 'Apply', op: 'And',
                    args: [
                        { type: 'Literal', value: false },
                        { type: 'Apply', op: 'GreaterThan', args: [{ type: 'Var', name: 'y' }, { type: 'Literal', value: 0 }] },
                    ],
                },
            },
        ];
        const proc = runProcedural(ast);
        expect(proc.status).toBe('ok');
        expect(proc.output).toEqual(['false']);
    });

    it('cuts off an infinite loop with a timeout status, keeping the output produced so far', () => {
        // print("start"); x=1; while (x>0) { x=x+1 }; print("end")
        const ast: ASTNode[] = [
            { type: 'Print', val: { type: 'Literal', value: 'start' } },
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 1 } },
            {
                type: 'While',
                cond: { type: 'Apply', op: 'GreaterThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 0 }] },
                body: [{ type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 1 }] } }],
            },
            { type: 'Print', val: { type: 'Literal', value: 'end' } },
        ];
        const proc = runProcedural(ast, 1000);
        expect(proc.status).toBe('timeout');
        // 打ち切り前の出力は保持され、ループ後のprintには到達しない
        expect(proc.output).toEqual(['start']);
        expect(proc.message).toContain('打ち切り');
    });

    it('demonstrates the termination asymmetry: procedural cuts off, call-by-need terminates (§4.7)', () => {
        // x=1; while (x>0) { x=x+1 }; print("hi") — ループ結果に需要が無い
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 1 } },
            {
                type: 'While',
                cond: { type: 'Apply', op: 'GreaterThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 0 }] },
                body: [{ type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 1 }] } }],
            },
            { type: 'Print', val: { type: 'Literal', value: 'hi' } },
        ];
        // 手続型: 逐次実行なのでループで打ち切られ、printに到達しない
        const proc = runProcedural(ast, 1000);
        expect(proc.status).toBe('timeout');
        expect(proc.output).toEqual([]);

        // 関数型: xの最終値に需要が届かないため、ループは走らず停止する
        const { consoleOutput } = evaluate(transpileToFunctionalAst(ast));
        expect(consoleOutput).toEqual(['hi']);
    });

    it('stops immediately with an error on an unbound variable (strict semantics, contrast with §3.6)', () => {
        // print("a"); print(z); print("b") — 正格なのでzのエラーで実行停止
        const ast: ASTNode[] = [
            { type: 'Print', val: { type: 'Literal', value: 'a' } },
            { type: 'Print', val: { type: 'Var', name: 'z' } },
            { type: 'Print', val: { type: 'Literal', value: 'b' } },
        ];
        const proc = runProcedural(ast);
        expect(proc.status).toBe('error');
        expect(proc.output).toEqual(['a']);
        expect(proc.message).toContain('z');
    });

    it('supports nested while loops (no conversion-side scope restriction applies here)', () => {
        // i=0; s=0; while (i<3) { j=0; while (j<2) { s=s+1; j=j+1 }; i=i+1 }; print s
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'i', val: { type: 'Literal', value: 0 } },
            { type: 'Assign', var: 's', val: { type: 'Literal', value: 0 } },
            {
                type: 'While',
                cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'i' }, { type: 'Literal', value: 3 }] },
                body: [
                    { type: 'Assign', var: 'j', val: { type: 'Literal', value: 0 } },
                    {
                        type: 'While',
                        cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'j' }, { type: 'Literal', value: 2 }] },
                        body: [
                            { type: 'Assign', var: 's', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 's' }, { type: 'Literal', value: 1 }] } },
                            { type: 'Assign', var: 'j', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'j' }, { type: 'Literal', value: 1 }] } },
                        ],
                    },
                    { type: 'Assign', var: 'i', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'i' }, { type: 'Literal', value: 1 }] } },
                ],
            },
            { type: 'Print', val: { type: 'Var', name: 's' } },
        ];
        const proc = runProcedural(ast);
        expect(proc.status).toBe('ok');
        expect(proc.output).toEqual(['6']);
    });
});
