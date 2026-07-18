import type { ApplyNode, Value } from './types';

// 関数型AST（CLAUDE.md §4.2）。React Flow・Zustandに一切依存しない、
// 単独でシリアライズ可能な型として定義する。
//
// Launchburyの計算断片（ユーザー定義ラムダなし、固定の組込演算子のみ、
// letrec自己参照なし＝§5.2/§5.4実装前の現行スコープ）に対応する
// 最小限のノード種別のみを持つ。
//
// 判別フィールドは `kind` とし、手続型AST（types.ts、判別フィールドは `type`）
// と視覚的・構造的に区別する。全ノードは trace 相関のための `id` を持つ
// （ただし FVar の id は使用しない。下記コメント参照）。
export type PrimOp = ApplyNode['op'];

export type FLit = { kind: 'Lit'; id: string; value: Value };

// FVar.id は評価器・renderGraphのいずれからも参照されない（トレース上に
// 対応するノードは存在しない）。Var の実体は「束縛しているLet（またはヒープに
// 存在しない場合は未束縛の正準ID）」であり、name をそちらへ解決することで
// エッジ・評価状態を求める。id フィールドはノード種別としての構造的一様性
// （全FExprがidを持つ）のためだけに存在する。
export type FVar = { kind: 'Var'; id: string; name: string };

export type FPrimApp = { kind: 'PrimApp'; id: string; op: PrimOp; args: FExpr[] };

// 条件式 `if cond then a else b`（§5.1。Haskellのif式に対応する「値を返す
// 条件式」）。手続型if-else文のSSA合流点
// （φ関数）は、このノードの返り値そのものが担う（diamond型の値合流に
// 限る。ループ先頭のφは§5.2のletrec仮引数が担い、本ノードでは表現
// しない）。評価器はscrutinee（cond）のみWHNFまでforceし、選ばれ
// なかった分岐Thunkには需要が届かない。
export type FIf = { kind: 'If'; id: string; cond: FExpr; then: FExpr; else: FExpr };

// 式レベルのlet（§5.2）。ループ本体は反復ごとに新しい環境で評価されるため、
// 本体内のSSA束縛はプログラムレベルのLetへ巻き上げられず、式の内側に現れる。
// LaunchburyのLET規則の直接の対応物（彼の計算では let はもともと式である）。
export type FLetIn = { kind: 'LetIn'; id: string; name: string; value: FExpr; body: FExpr };

// 名前付き関数の飽和適用（§5.2の制限付きAPP規則、launchbury.md §2.2）。
// 第一級のラムダ値・部分適用は§5.4で導入する。
export type FApply = { kind: 'Apply'; id: string; fn: string; args: FExpr[] };

// 対（consセルの最小形、launchbury.md §2.3）。複数ループ変数を持つwhileの
// 出口値を表現する。forceはWHNFまで＝外側のセルだけを暴き、fst/sndの
// Thunkは未評価のまま残る（§3.2。§5.3の無限リストの直接の準備）。
export type FPair = { kind: 'Pair'; id: string; fst: FExpr; snd: FExpr };

// 射影（fst/snd）。CASE規則の対応物：scrutinee（対）をWHNFまでforceし、
// 選択された成分Thunkのforceに移る。
export type FProj = { kind: 'Proj'; id: string; which: 'fst' | 'snd'; pair: FExpr };

export type FExpr = FLit | FVar | FPrimApp | FIf | FLetIn | FApply | FPair | FProj;

// SSA代入に対応する束縛（`let x_n = e in ...` というネストした direct style。
// CLAUDE.md §2の評価戦略と一致）。
export type FLet = { kind: 'Let'; id: string; name: string; value: FExpr; body: FProgram };

// Print文（IOアクション）。
export type FPrint = { kind: 'Print'; id: string; expr: FExpr };

// 自己参照束縛（letrec、§5.2）。whileループを表す名前付き再帰関数を束縛する。
// 束縛される値は関数（ラムダ＝WHNF）のみで、閉包環境に自分自身を含める
// （不動点）。LaunchburyのLET規則はもともと相互再帰的な束縛を扱うため、
// これはLET規則の本来の一般性の回復である（launchbury.md §2.1）。
// 値レベルの自己参照束縛（xs = cons(1, xs) 等）は§5.3で導入する。
export type FLetRec = { kind: 'LetRec'; id: string; name: string; params: string[]; fnBody: FExpr; body: FProgram };

// `Print` 文の列（IOアクションの逐次実行に対応する需要の根、§3.4）。
export type FDo = { kind: 'Do'; id: string; actions: FPrint[] };

export type FProgram = FLet | FLetRec | FDo;

// Let束縛（変数）の正準ノードID。評価器・renderGraphの双方がこの規則で
// 変数のヒープ位置を参照する（FVar.name からの解決先）。
export const canonicalVarId = (name: string): string => `var_${name}`;

// 未束縛変数参照の正準ゴーストID。同一名の複数参照が同じ⊥Thunk/ノードを
// 共有するために用いる。
export const canonicalUnboundId = (name: string): string => `var_${name}_unbound`;
