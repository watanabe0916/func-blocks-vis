import { describe, it, expect } from 'vitest';
import { ASTNode } from './types';
import { transpileToFunctionalAst } from './transpiler';
import { FProgram, FLet, FLetRec, FIf, FVar, FLetIn, FApply, FPair } from './functionalAst';

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
    if (program.kind === 'LetRec') {
        // 束縛名の一意性検査には関数名・仮引数名も含める（launchbury.md §3）
        acc.push(program.name, ...program.params);
        return collectLetNames(program.body, acc);
    }
    return acc;
}

function findLet(program: FProgram, name: string): FLet | null {
    if (program.kind === 'Let') {
        if (program.name === name) return program;
        return findLet(program.body, name);
    }
    if (program.kind === 'LetRec') {
        return findLet(program.body, name);
    }
    return null;
}

function findLetRec(program: FProgram, name: string): FLetRec | null {
    if (program.kind === 'LetRec') {
        if (program.name === name) return program;
        return findLetRec(program.body, name);
    }
    if (program.kind === 'Let') {
        return findLetRec(program.body, name);
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

describe('§5.1 if-else → 条件式If（φ = If ノードの返り値）', () => {
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

describe('§5.2 while → letrec自己参照関数（ループ先頭のφ = 仮引数）', () => {
    it('turns loop variables into parameters and returns the exit values as a pair', () => {
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

        // 束縛名（関数名・仮引数名を含む）の一意性
        const names = collectLetNames(program);
        expect(names).toEqual(['sum_1', 'i_1', '%loop_1', 'sum_2', 'i_2', '%r_1', 'sum_4', 'i_4']);
        expect(new Set(names).size).toBe(names.length);

        // ループ先頭のφ = 仮引数（sum_2, i_2）
        const loop = findLetRec(program, '%loop_1')!;
        expect(loop.params).toEqual(['sum_2', 'i_2']);

        // 本体：If(cond, LetIn sum_3 → LetIn i_3 → 末尾自己呼び出し, 出口の対)
        const fnBody = loop.fnBody as FIf;
        expect(fnBody.kind).toBe('If');
        const letSum = fnBody.then as FLetIn;
        expect(letSum.kind).toBe('LetIn');
        expect(letSum.name).toBe('sum_3');
        const letI = letSum.body as FLetIn;
        expect(letI.name).toBe('i_3');
        const tail = letI.body as FApply;
        expect(tail.kind).toBe('Apply');
        expect(tail.fn).toBe('%loop_1');
        expect(tail.args.map((a) => (a as FVar).name)).toEqual(['sum_3', 'i_3']);

        // 出口値は仮引数の対
        const exit = fnBody.else as FPair;
        expect(exit.kind).toBe('Pair');
        expect((exit.fst as FVar).name).toBe('sum_2');
        expect((exit.snd as FVar).name).toBe('i_2');

        // 合流後の版は %r_1 からの射影
        const r = findLet(program, '%r_1')!;
        expect(r.value.kind).toBe('Apply');
        expect((r.value as FApply).args.map((a) => (a as FVar).name)).toEqual(['sum_1', 'i_1']);
        expect(findLet(program, 'sum_4')!.value.kind).toBe('Proj');
        expect(findLet(program, 'i_4')!.value.kind).toBe('Proj');
    });

    it('captures loop-invariant variables as free variables, not parameters (transform.md (c))', () => {
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

        const loop = findLetRec(program, '%loop_1')!;
        // n はループ内で再代入されないため仮引数にならず、自由変数として捕捉される
        expect(loop.params).toEqual(['x_2']);
        expect(JSON.stringify(loop.fnBody)).toContain('"n_1"');

        // ループ変数が1つなら対を作らず、適用結果を直接束縛する（%r/射影なし）。
        // x_3 は本体内（LetIn）の版であり、ループ後の合流版は x_4 となる。
        const names = collectLetNames(program);
        expect(names).toEqual(['n_1', 'x_1', '%loop_1', 'x_2', 'x_4']);
        expect(findLet(program, 'x_4')!.value.kind).toBe('Apply');
    });

    it('rejects nested while loops with an explicit error (expression-level letrec is out of scope)', () => {
        const ast: ASTNode[] = [
            {
                type: 'While',
                cond: { type: 'Literal', value: true },
                body: [
                    {
                        type: 'While',
                        cond: { type: 'Literal', value: false },
                        body: [{ type: 'Assign', var: 'x', val: { type: 'Literal', value: 1 } }],
                    },
                ],
            },
        ];
        expect(() => transpileToFunctionalAst(ast)).toThrow(/入れ子/);
    });

    it('rejects a Print inside a loop body with an explicit error', () => {
        const ast: ASTNode[] = [
            {
                type: 'While',
                cond: { type: 'Literal', value: true },
                body: [{ type: 'Print', val: { type: 'Literal', value: 1 } }],
            },
        ];
        expect(() => transpileToFunctionalAst(ast)).toThrow(/未対応/);
    });
});
