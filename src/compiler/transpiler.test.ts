import { describe, it, expect } from 'vitest';
import { ASTNode } from './types';
import { transpileToFunctionalAst } from './transpiler';
import { FProgram, FLet } from './functionalAst';

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
