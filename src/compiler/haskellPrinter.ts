import { FExpr, FProgram, PrimOp } from './functionalAst';

/**
 * §4.6 GHC＝CI専用検証オラクル：関数型AST（functionalAst.ts）から、実際に
 * コンパイル可能なdo記法Haskellソースを生成する脱糖プリンタ。
 *
 * 本モジュールは本番の実行パスには一切組み込まない。用途は開発/CI時の
 * 2段階検証のみ：
 *   1. 型検査:    `ghc -fno-code Main.hs`（Blockly側の手書きバリデーションで
 *                 検出できない型不整合をGHCの型システムで機械的に検出する）
 *   2. 差分テスト: `runghc Main.hs` の標準出力を evaluate() の consoleOutput
 *                 （trace中のPrintイベント列）と突き合わせる（観測等価、
 *                 launchbury.md §3）
 *
 * 脱糖規則（launchbury.md の対応表に従う。§4.2チェックリスト(d)）:
 *   Let     → do記法内の let 文（do{let decls;stmts} = let decls in do{stmts}）
 *   LetRec  → let 文の関数束縛（Haskellのletはもともとletrec。仮引数＝
 *             ループ先頭のφ）
 *   LetIn   → 式レベルの let .. in ..（SSAにより束縛名がRHSに現れないため、
 *             Haskellのletrecと非再帰letの差は観測されない）
 *   If      → if-then-else（case of Bool の糖衣）
 *   PrimApp → 組込演算子（JSのIEEE754意味論に合わせる。/はDouble除算＝
 *             0除算はInfinity、%は自前の jsMod でJSの符号規約を再現）
 *   Apply   → 関数適用（飽和適用のみ）
 *   Pair    → タプル (,) / Proj → fst・snd
 *   Do      → main = do { putStrLn (showJS e); ... }
 *   未束縛Var → undefined（Haskellのundefinedはまさに⊥。§3.6の意味論と一致し、
 *             型検査を通過し、forceされた場合のみ実行時例外になる）
 *
 * 出力の正規化: JSの表示（true / 3 / Infinity / NaN）とHaskellのshow
 * （True / 3.0 …）の差異が差分テストの偽陽性にならないよう、生成ソースに
 * 表示ヘルパ showJS を埋め込み、evaluate() の出力と文字単位で一致させる。
 *
 * 識別子マングリング: Haskellの識別子は小文字始まりの英数字に限られるため、
 * ユーザー変数は `v_` 接頭辞＋不正文字のエスケープ、トランスパイラの合成束縛
 * （%cond/%loop/%r）は `phi_` 接頭辞に機械変換する。SSA束縛名の一意性は
 * 変換後も保たれる（接頭辞で名前空間が分離され、エスケープは単射）。
 *
 * 既知の境界（差分テストのfixture選定時の制約）:
 * - エラーを含む実行（⊥のforce・反復上限超過）はHaskell側と出力形式が
 *   揃わないため、差分テストは正常終了するプログラムに限定する。
 * - 文脈から型が定まらない裸の⊥（例: printの引数が未束縛変数のみ）は
 *   GHCが曖昧型エラーで拒否する（静的検査と動的意味論の境界）。
 * - 数値表示はJSとHaskellで極端な値（1e21以上、1e-7未満の指数表記閾値）が
 *   異なる。fixtureは通常の範囲の数値を使うこと。
 */

// 生成ソース共通のヘッダ（表示ヘルパと演算ヘルパ）。
const PRELUDE = `{-# LANGUAGE FlexibleInstances #-}
module Main where

import Numeric (showFFloat)

-- JSの表示規約（String(v)）に合わせた表示ヘルパ。
-- 整数値のDoubleは小数点なし（3.0 -> "3"）、真偽値は小文字、
-- Infinity/NaN はJSと同じ綴りになる。
class ShowJS a where
  showJS :: a -> String

instance ShowJS Double where
  showJS d
    | isNaN d = "NaN"
    | isInfinite d = if d > 0 then "Infinity" else "-Infinity"
    | d == fromInteger (round d) = show (round d :: Integer)
    | otherwise = showFFloat Nothing d ""

instance ShowJS Bool where
  showJS True = "true"
  showJS False = "false"

instance ShowJS [Char] where
  showJS s = s

-- JSの % （被除数の符号・truncated division）をDoubleで再現する。
-- 除数0等でq が有限でない場合はJSと同じく NaN。
jsMod :: Double -> Double -> Double
jsMod x y =
  let q = x / y
  in if isNaN q || isInfinite q then 0 / 0 else x - y * fromInteger (truncate q)
`;

// 不正文字を単射にエスケープする（例: 'あ' -> "_u3042_"）。
const sanitize = (s: string): string =>
    s.replace(/[^a-zA-Z0-9_]/g, (c) => `_u${c.charCodeAt(0).toString(16)}_`);

// SSA束縛名 → Haskell識別子。
const mangle = (name: string): string => {
    if (name.startsWith('%')) return `phi_${sanitize(name.slice(1))}`;
    return `v_${sanitize(name)}`;
};

// Haskell文字列リテラルのエスケープ。
const hsString = (s: string): string => {
    const escaped = s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/\r/g, '\\r');
    return `"${escaped}"`;
};

// 演算子の脱糖表。&&/|| は第2引数に非正格＝本システムのAnd/Orの短絡と一致する。
const OP_HS: Record<PrimOp, (args: string[]) => string> = {
    Add: ([a, b]) => `(${a} + ${b})`,
    Sub: ([a, b]) => `(${a} - ${b})`,
    Mul: ([a, b]) => `(${a} * ${b})`,
    Div: ([a, b]) => `(${a} / ${b})`,
    Pow: ([a, b]) => `(${a} ** ${b})`,
    Mod: ([a, b]) => `(jsMod ${a} ${b})`,
    Equal: ([a, b]) => `(${a} == ${b})`,
    NotEqual: ([a, b]) => `(${a} /= ${b})`,
    LessThan: ([a, b]) => `(${a} < ${b})`,
    LessThanOrEqual: ([a, b]) => `(${a} <= ${b})`,
    GreaterThan: ([a, b]) => `(${a} > ${b})`,
    GreaterThanOrEqual: ([a, b]) => `(${a} >= ${b})`,
    And: ([a, b]) => `(${a} && ${b})`,
    Or: ([a, b]) => `(${a} || ${b})`,
    Not: ([a]) => `(not ${a})`,
};

/**
 * 関数型AST全体をコンパイル可能なHaskellソース（文字列）へ脱糖する。
 */
export function printHaskell(program: FProgram): string {
    // 式の脱糖。bound は現在スコープで束縛済みのSSA名の集合で、
    // 未束縛のVar（⊥）を undefined へ落とすために使う。
    const printExpr = (expr: FExpr, bound: Set<string>): string => {
        if (expr.kind === 'Lit') {
            if (typeof expr.value === 'number') {
                // 数値リテラルは Double に固定して型推論を決定的にする
                // （defaulting による Integer/Double の揺れを防ぐ）。
                return `(${expr.value} :: Double)`;
            }
            if (typeof expr.value === 'string') {
                return hsString(expr.value);
            }
            return expr.value ? 'True' : 'False';
        }
        if (expr.kind === 'Var') {
            return bound.has(expr.name) ? mangle(expr.name) : 'undefined';
        }
        if (expr.kind === 'PrimApp') {
            return OP_HS[expr.op](expr.args.map((a) => printExpr(a, bound)));
        }
        if (expr.kind === 'If') {
            return `(if ${printExpr(expr.cond, bound)} then ${printExpr(expr.then, bound)} else ${printExpr(expr.else, bound)})`;
        }
        if (expr.kind === 'LetIn') {
            const inner = new Set(bound);
            inner.add(expr.name);
            return `(let ${mangle(expr.name)} = ${printExpr(expr.value, bound)} in ${printExpr(expr.body, inner)})`;
        }
        if (expr.kind === 'Apply') {
            const fn = bound.has(expr.fn) ? mangle(expr.fn) : 'undefined';
            return `(${fn} ${expr.args.map((a) => printExpr(a, bound)).join(' ')})`;
        }
        if (expr.kind === 'Pair') {
            return `(${printExpr(expr.fst, bound)}, ${printExpr(expr.snd, bound)})`;
        }
        // Proj
        return `(${expr.which} ${printExpr(expr.pair, bound)})`;
    };

    // プログラム（Let/LetRecの連鎖→終端Do）を main の do ブロックの文列へ。
    const bodyLines: string[] = [];
    const walk = (node: FProgram, bound: Set<string>): void => {
        if (node.kind === 'Let') {
            bodyLines.push(`let ${mangle(node.name)} = ${printExpr(node.value, bound)}`);
            const next = new Set(bound);
            next.add(node.name);
            walk(node.body, next);
            return;
        }
        if (node.kind === 'LetRec') {
            // Haskellのletはletrecなので、関数名を本体スコープに含めるだけで
            // 自己参照（末尾自己呼び出し）がそのまま成立する。
            const fnScope = new Set(bound);
            fnScope.add(node.name);
            node.params.forEach((p) => fnScope.add(p));
            bodyLines.push(
                `let ${mangle(node.name)} ${node.params.map(mangle).join(' ')} = ${printExpr(node.fnBody, fnScope)}`
            );
            const next = new Set(bound);
            next.add(node.name);
            walk(node.body, next);
            return;
        }
        // Do: 需要の根。printの列（Haskellの do{e;stmts} = e >> do{stmts}）。
        if (node.actions.length === 0) {
            bodyLines.push('return ()');
            return;
        }
        node.actions.forEach((action) => {
            bodyLines.push(`putStrLn (showJS ${printExpr(action.expr, bound)})`);
        });
    };
    walk(program, new Set());

    const main = ['main :: IO ()', 'main = do', ...bodyLines.map((l) => `  ${l}`)].join('\n');
    return `${PRELUDE}\n${main}\n`;
}
