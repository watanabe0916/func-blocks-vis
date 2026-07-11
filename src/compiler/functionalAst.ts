import { ApplyNode, Value } from './types';

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

// 三項演算子 `cond ? then : else`（§5.1）。手続型if-else文のSSA合流点
// （φ関数）は、このノードの返り値そのものが担う（diamond型の値合流に
// 限る。ループ先頭のφは§5.2のletrec仮引数が担い、本ノードでは表現
// しない）。評価器はscrutinee（cond）のみWHNFまでforceし、選ばれ
// なかった分岐Thunkには需要が届かない。
export type FIf = { kind: 'If'; id: string; cond: FExpr; then: FExpr; else: FExpr };

export type FExpr = FLit | FVar | FPrimApp | FIf;

// SSA代入に対応する束縛（`let x_n = e in ...` というネストした direct style。
// CLAUDE.md §2の評価戦略と一致）。
export type FLet = { kind: 'Let'; id: string; name: string; value: FExpr; body: FProgram };

// Print文（IOアクション）。
export type FPrint = { kind: 'Print'; id: string; expr: FExpr };

// `Print` 文の列（IOアクションの逐次実行に対応する需要の根、§3.4）。
export type FDo = { kind: 'Do'; id: string; actions: FPrint[] };

export type FProgram = FLet | FDo;

// Let束縛（変数）の正準ノードID。評価器・renderGraphの双方がこの規則で
// 変数のヒープ位置を参照する（FVar.name からの解決先）。
export const canonicalVarId = (name: string): string => `var_${name}`;

// 未束縛変数参照の正準ゴーストID。同一名の複数参照が同じ⊥Thunk/ノードを
// 共有するために用いる。
export const canonicalUnboundId = (name: string): string => `var_${name}_unbound`;
