import { describe, it, expect } from 'vitest';
import { ASTNode } from './types';
import { transpileToFunctionalAst } from './transpiler';
import { printHaskell } from './haskellPrinter';

/**
 * §4.6 haskellPrinter のゴールデンテスト。生成されるHaskellソースの形を固定
 * する（GHC不要）。GHCによる型検査・差分テストは `npm run test:ghc`（Phase 2）
 * が担い、ここでは脱糖規則の構造のみを検証する。
 */

// main = do 以下の文列だけを取り出す（プレリュードの変更にテストが揺れないように）
function mainBody(src: string): string[] {
    const lines = src.split('\n');
    const start = lines.indexOf('main = do');
    expect(start).toBeGreaterThan(-1);
    return lines.slice(start + 1).filter((l) => l.trim() !== '').map((l) => l.trim());
}

describe('haskellPrinter: functional AST → do-notation Haskell (§4.6)', () => {
    it('desugars Let / PrimApp / Do into do-notation let statements and putStrLn', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: 'x', val: { type: 'Literal', value: 3 } },
            { type: 'Print', val: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 5 }] } },
        ];
        const src = printHaskell(transpileToFunctionalAst(ast));
        expect(mainBody(src)).toEqual([
            'let v_x_1 = (3 :: Double)',
            'putStrLn (showJS (v_x_1 < (5 :: Double)))',
        ]);
        // コンパイルに必要なプレリュードが含まれること
        expect(src).toContain('module Main where');
        expect(src).toContain('class ShowJS a where');
    });

    it('maps an unbound variable (⊥, §3.6) to Haskell undefined — the exact same denotation', () => {
        // print(false && (y > 0)) — 検証項目§7-5の短絡プログラム
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
        const src = printHaskell(transpileToFunctionalAst(ast));
        expect(mainBody(src)).toEqual([
            'putStrLn (showJS (False && (undefined > (0 :: Double))))',
        ]);
    });

    it('desugars an if-else φ binding into if-then-else', () => {
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
        const src = printHaskell(transpileToFunctionalAst(ast));
        expect(mainBody(src)).toEqual([
            'let v_x_1 = (1 :: Double)',
            'let v_y_1 = (10 :: Double)',
            'let v_y_2 = (20 :: Double)',
            'let v_y_3 = (if (v_x_1 < (5 :: Double)) then v_y_1 else v_y_2)',
            'putStrLn (showJS v_y_3)',
        ]);
    });

    it('mangles the shared %cond binding into phi_cond (valid Haskell identifier)', () => {
        // 複数φ → %cond_1 が生成されるプログラム
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
        const src = printHaskell(transpileToFunctionalAst(ast));
        expect(src).toContain('let phi_cond_1 = (v_a_1 < (5 :: Double))');
        expect(src).toContain('let v_x_3 = (if phi_cond_1 then v_x_1 else v_x_2)');
        // then側でしか代入されなかったyのelse腕は未束縛（版0）＝undefined
        expect(src).toContain('let v_y_2 = (if phi_cond_1 then v_y_1 else undefined)');
    });

    it('desugars a while loop into a recursive let function with a tuple exit and projections', () => {
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
        const src = printHaskell(transpileToFunctionalAst(ast));
        // letrec＝Haskellのlet関数束縛。仮引数（ループ先頭のφ）・LetIn連鎖・
        // 末尾自己呼び出し・タプルの出口
        expect(src).toContain(
            'let phi_loop_1 v_sum_2 v_i_2 = (if (v_i_2 < (3 :: Double)) then (let v_sum_3 = (v_sum_2 + v_i_2) in (let v_i_3 = (v_i_2 + (1 :: Double)) in (phi_loop_1 v_sum_3 v_i_3))) else (v_sum_2, v_i_2))'
        );
        // 適用結果の共有束縛と射影
        expect(src).toContain('let phi_r_1 = (phi_loop_1 v_sum_1 v_i_1)');
        expect(src).toContain('let v_sum_4 = (fst phi_r_1)');
        expect(src).toContain('let v_i_4 = (snd phi_r_1)');
    });

    it('escapes non-ASCII variable names into valid Haskell identifiers', () => {
        const ast: ASTNode[] = [
            { type: 'Assign', var: '数', val: { type: 'Literal', value: 1 } },
            { type: 'Print', val: { type: 'Var', name: '数' } },
        ];
        const src = printHaskell(transpileToFunctionalAst(ast));
        // '数' (U+6570) → _u6570_
        expect(src).toContain('let v__u6570__1 = (1 :: Double)');
        expect(src).toContain('putStrLn (showJS v__u6570__1)');
    });
});
