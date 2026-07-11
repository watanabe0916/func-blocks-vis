import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASTNode } from './types';
import { transpileToFunctionalAst } from './transpiler';
import { evaluate } from './evaluator';
import { printHaskell } from './haskellPrinter';

/**
 * §4.6 Phase 2: GHC検証オラクルの差分テストハーネス。
 *
 * 各fixture（手続型AST）に対して：
 *   1. `ghc -fno-code` — 生成Haskellソースの独立型検査
 *   2. `runghc` — 実行し、標準出力を evaluate() の consoleOutput と
 *      文字単位で突き合わせる（観測等価、launchbury.md §3）
 *
 * 実行方法: `npm run test:ghc`（環境変数 GHC_ORACLE=1 でゲート）。
 * 通常の `npm run test` ではスイート全体がスキップされ、GHCの無い環境を
 * 壊さない。GHC_ORACLE=1 なのに ghc/runghc が見つからない場合も
 * 警告してスキップする（CIでは haskell-actions/setup がGHCを保証する）。
 *
 * fixtureの制約（haskellPrinter.ts ヘッダの「既知の境界」）:
 * - 正常終了するプログラムに限る（⊥のforce・反復上限超過はHaskell側と
 *   エラー形式が揃わない）。
 * - 文脈から型が定まらない裸の⊥（printの引数が未束縛変数のみ等）は不可。
 * - 数値は通常の範囲（指数表記閾値の違いを避ける）。
 */

const enabled = process.env.GHC_ORACLE === '1';

const ghcAvailable = enabled && (() => {
    try {
        execFileSync('ghc', ['--version'], { stdio: 'ignore' });
        execFileSync('runghc', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

if (enabled && !ghcAvailable) {
    console.warn('[ghcOracle] GHC_ORACLE=1 ですが ghc/runghc が見つからないためスキップします');
}

// 検証項目（CLAUDE.md §7）と実装済み機能（§5.1/§5.2）を横断するfixture群
const FIXTURES: Record<string, ASTNode[]> = {
    // 算術・IEEE754の0除算・jsModの符号規約・文字列等価・比較
    basics: [
        { type: 'Assign', var: 'x', val: { type: 'Literal', value: 10 } },
        { type: 'Print', val: { type: 'Apply', op: 'Div', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 0 }] } },
        { type: 'Print', val: { type: 'Apply', op: 'Div', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 4 }] } },
        { type: 'Print', val: { type: 'Apply', op: 'Mod', args: [{ type: 'Literal', value: -7 }, { type: 'Literal', value: 3 }] } },
        { type: 'Print', val: { type: 'Apply', op: 'Equal', args: [{ type: 'Literal', value: 'abc' }, { type: 'Literal', value: 'abc' }] } },
        { type: 'Print', val: { type: 'Apply', op: 'LessThan', args: [{ type: 'Literal', value: 3 }, { type: 'Literal', value: 5 }] } },
        { type: 'Print', val: { type: 'Apply', op: 'Pow', args: [{ type: 'Literal', value: 2 }, { type: 'Literal', value: 10 }] } },
    ],
    // 論理演算（Not/Or）と文字列出力
    logic: [
        { type: 'Assign', var: 'b', val: { type: 'Literal', value: false } },
        { type: 'Print', val: { type: 'Apply', op: 'Not', args: [{ type: 'Var', name: 'b' }] } },
        { type: 'Print', val: { type: 'Apply', op: 'Or', args: [{ type: 'Var', name: 'b' }, { type: 'Literal', value: true }] } },
        { type: 'Print', val: { type: 'Literal', value: 'hello' } },
    ],
    // 短絡＝遅延の創発（§7-5）: 右辺の未束縛変数（⊥）にneedが届かない
    shortcircuit: [
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
    ],
    // SSAの複合代入（x += 相当の自己参照）とメモ化を跨ぐ複数print
    ssa: [
        { type: 'Assign', var: 'x', val: { type: 'Literal', value: 5 } },
        { type: 'Assign', var: 'y', val: { type: 'Var', name: 'x' } },
        { type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Var', name: 'y' }] } },
        { type: 'Print', val: { type: 'Var', name: 'x' } },
        { type: 'Print', val: { type: 'Var', name: 'y' } },
        { type: 'Print', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Var', name: 'y' }] } },
    ],
    // §5.1 if-else（φ＝三項演算子）、%cond共有つき
    ifelse: [
        { type: 'Assign', var: 'a', val: { type: 'Literal', value: 1 } },
        {
            type: 'If',
            cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'a' }, { type: 'Literal', value: 5 }] },
            then: [
                { type: 'Assign', var: 'x', val: { type: 'Literal', value: 10 } },
                { type: 'Assign', var: 'y', val: { type: 'Literal', value: 20 } },
            ],
            else: [
                { type: 'Assign', var: 'x', val: { type: 'Literal', value: 30 } },
                { type: 'Assign', var: 'y', val: { type: 'Literal', value: 40 } },
            ],
        },
        { type: 'Print', val: { type: 'Var', name: 'x' } },
        { type: 'Print', val: { type: 'Var', name: 'y' } },
    ],
    // §5.2 while（letrec・複数ループ変数・対と射影）
    sumloop: [
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
    ],
    // ループ不変変数の自由変数捕捉（transform.md (c)）
    freevar: [
        { type: 'Assign', var: 'n', val: { type: 'Literal', value: 5 } },
        { type: 'Assign', var: 'x', val: { type: 'Literal', value: 0 } },
        {
            type: 'While',
            cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'x' }, { type: 'Var', name: 'n' }] },
            body: [{ type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Var', name: 'n' }] } }],
        },
        { type: 'Print', val: { type: 'Var', name: 'x' } },
    ],
    // if分岐の中のwhile（巻き上げ）＋需要駆動（選ばれない側のループは走らない）
    nested: [
        { type: 'Assign', var: 'x', val: { type: 'Literal', value: 0 } },
        {
            type: 'If',
            cond: { type: 'Apply', op: 'GreaterThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 0 }] },
            then: [
                {
                    type: 'While',
                    cond: { type: 'Apply', op: 'LessThan', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 3 }] },
                    body: [{ type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Add', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 1 }] } }],
                },
            ],
            else: [
                {
                    type: 'While',
                    cond: { type: 'Apply', op: 'GreaterThanOrEqual', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: -5 }] },
                    body: [{ type: 'Assign', var: 'x', val: { type: 'Apply', op: 'Sub', args: [{ type: 'Var', name: 'x' }, { type: 'Literal', value: 1 }] } }],
                },
            ],
        },
        { type: 'Print', val: { type: 'Var', name: 'x' } },
    ],
};

describe.runIf(ghcAvailable)('GHC verification oracle: type check + differential test (§4.6)', () => {
    const dir = ghcAvailable ? mkdtempSync(join(tmpdir(), 'ghc-oracle-')) : '';

    Object.entries(FIXTURES).forEach(([name, ast]) => {
        it(`${name}: ghc -fno-code passes and runghc output equals evaluate()`, () => {
            const program = transpileToFunctionalAst(ast);
            const { consoleOutput } = evaluate(program);

            const file = join(dir, `${name}.hs`);
            writeFileSync(file, printHaskell(program));

            // 1. 独立型検査（コード生成を省略した軽量チェック）
            execFileSync('ghc', ['-fno-code', '-v0', file], { stdio: ['ignore', 'pipe', 'pipe'] });

            // 2. 差分テスト（観測等価: コンソール出力列の一致）
            const stdout = execFileSync('runghc', [file], { encoding: 'utf8' });
            const expected = consoleOutput.length > 0 ? consoleOutput.join('\n') + '\n' : '';
            expect(stdout).toBe(expected);
        }, 120000);
    });
});
