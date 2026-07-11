import { describe, it, expect } from 'vitest';
import { ASTNode } from './types';
import { transpileToFunctionalAst } from './transpiler';
import { FProgram, FLet, FIf, FVar } from './functionalAst';

/**
 * [S]（住井ら, transform.md §2）の適格性(well-formedness)述語に倣い、
 * transpileToFunctionalAst の出力（②手続型AST→関数型ASTへの変換）が
 * 構造的に健全であることを機械的に検査する（CLAUDE.md §4.7）。
 *
 * 注意: [S]の適格性述語は「全Varが束縛済みであること」を含むが、これは
 * call-by-value言語におけるプログラムエラー検出を意図したものである。
 * 本システムは未束縛変数の参照を⊥として意図的に許容する（§3.6。
 * evaluator.test.ts でその健全な扱いを別途検証済み）ため、ここでは
 * そのまま採用しない。本システムで機械的に検査すべきは
 * 「生成されたSSA束縛名（Letのname）に重複がないこと」である。
 */
function collectLetNames(program: FProgram, acc: string[] = []): string[] {
    if (program.kind === 'Let') {
        acc.push(program.name);
        return collectLetNames(program.body, acc);
    }
    return acc;
}

function findLet(program: FProgram, name: string): FLet | null {
    if (program.kind === 'Let') {
        if (program.name === name) return program;
        return findLet(program.body, name);
    }
    return null;
}

describe('transpiler well-formedness (transform.md §2, [S]-style invariant)', () => {
    it('never generates duplicate SSA binder names, even under repeated reassignment', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 1 } },
            { type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 1 }] } },
            { type: 'Assign', var: 'y', val: { type: 'Var', name: 'x' } },
            { type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Var', name: 'y' }] } },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const names = collectLetNames(program);

        expect(names).toEqual(['x_1', 'x_2', 'y_1', 'x_3']);
        expect(new Set(names).size).toBe(names.length);
    });

    it('gives a reassignment its own version, distinct from the version it reads on the right-hand side (no self-reference cycle / black hole)', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 5 } },
            { type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 1 }] } },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
        ];
        const program = transpileToFunctionalAst(ast) as FLet;
        expect(program.name).toBe('x_1');

        const second = program.body as FLet;
        expect(second.name).toBe('x_2');

        // RHS（x_2の値）は直前バージョン x_1 を参照し、x_2自身を参照しては
        // ならない（自己循環＝ブラックホールを構造的に防ぐ。§5.2の
        // letrec自己参照とは異なり、現行スコープのLetは非自己参照である
        // ことがこの非循環性の理論的根拠になる）。
        const serializedValue = JSON.stringify(second.value);
        expect(serializedValue).toContain('"x_1"');
        expect(serializedValue).not.toContain('"x_2"');
    });
});

describe('§5.1 if-else → 三項演算子（φ = If ノードの返り値）', () => {
    it('merges a diamond reassignment through a φ binding referencing both branch versions', () => {
        // x=1; if (x<5) { x=10 } else { x=20 }; print x
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 1 } },
            {
                type: 'If',
                cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 5 }] },
                then: [{ type: 'Assign', var: 'x', val: { type: 'Literal', value: 10 } }],
                else: [{ type: 'Assign', var: 'x', val: { type: 'Literal', value: 20 } }],
            },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const names = collectLetNames(program);
        expect(names).toEqual(['x_1', 'x_2', 'x_3', 'x_4']);
        expect(new Set(names).size).toBe(names.length);

        // φ束縛 x_4 = If(cond, x_2, x_3)。φが1つだけなので条件式は
        // 合成束縛を作らず直接埋め込まれる。
        const phi = findLet(program, 'x_4')!;
        expect(phi.value.kind).toBe('If');
        const ifExpr = phi.value as FIf;
        expect(ifExpr.cond.kind).toBe('PrimApp');
        expect((ifExpr.then as FVar).name).toBe('x_2');
        expect((ifExpr.else as FVar).name).toBe('x_3');
    });

    it('binds the condition once (%cond) and shares it when multiple variables merge', () => {
        // a=1; if (a<5) { x=1; y=2 } else { x=3 }
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
        ];
        const program = transpileToFunctionalAst(ast);
        const names = collectLetNames(program);
        expect(names).toEqual(['a_1', '%cond_1', 'x_1', 'y_1', 'x_2', 'x_3', 'y_2']);
        expect(new Set(names).size).toBe(names.length);

        // 両φが同一の %cond_1 を変数参照する（条件式の複製＝sharing違反をしない）
        const phiX = findLet(program, 'x_3')!.value as FIf;
        const phiY = findLet(program, 'y_2')!.value as FIf;
        expect((phiX.cond as FVar).name).toBe('%cond_1');
        expect((phiY.cond as FVar).name).toBe('%cond_1');

        // then側でしか代入されなかった y の else腕は、分岐前の版（未束縛の
        // 版0＝⊥）を参照する。手続型の「elseを通るとyは未定義」と一致する。
        expect((phiY.else as FVar).name).toBe('y_0');
    });

    it('keeps binder names unique across nested if-else (nested diamonds)', () => {
        const ast: ASTNode[] = [
            {
                type: 'If',
                cond: { type: 'Literal', value: true },
                then: [
                    {
                        type: 'If',
                        cond: { type: 'Literal', value: false },
                        then: [{ type: 'Assign', var: 'x', val: { type: 'Literal', value: 1 } }],
                        else: [{ type: 'Assign', var: 'x', val: { type: 'Literal', value: 2 } }],
                    },
                ],
                else: [{ type: 'Assign', var: 'x', val: { type: 'Literal', value: 3 } }],
            },
            { type: 'Print', val: { type: 'Var', name: 'x' } },
        ];
        const program = transpileToFunctionalAst(ast);
        const names = collectLetNames(program);
        expect(names).toEqual(['x_1', 'x_2', 'x_3', 'x_4', 'x_5']);
        expect(new Set(names).size).toBe(names.length);

        // 外側のφ（x_5）のthen腕は内側のφ（x_3）を参照する
        const outerPhi = findLet(program, 'x_5')!.value as FIf;
        expect((outerPhi.then as FVar).name).toBe('x_3');
        expect((outerPhi.else as FVar).name).toBe('x_4');
    });

    it('rejects a Print inside a branch with an explicit error (conditional IO is out of scope)', () => {
        const ast: ASTNode[] = [
            {
                type: 'If',
                cond: { type: 'Literal', value: true },
                then: [{ type: 'Print', val: { type: 'Literal', value: 1 } }],
                else: [],
            },
        ];
        expect(() => transpileToFunctionalAst(ast)).toThrow(/if-else/);
    });

    it('emits nothing for an if-else whose branches bind nothing (demand never arises)', () => {
        const ast: ASTNode[] = [
            {
                type: 'If',
                cond: { type: 'Literal', value: true },
                then: [],
                else: [],
            },
            { type: 'Print', val: { type: 'Literal', value: 'ok' } },
        ];
        const program = transpileToFunctionalAst(ast);
        expect(collectLetNames(program)).toEqual([]);
        expect(program.kind).toBe('Do');
    });
});
