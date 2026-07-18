import type { FExpr } from './functionalAst';

export type ASTNode = AssignNode | PrintNode | IfNode | WhileNode;

export type AssignNode = {
    type: 'Assign';
    var: string;
    val: ExpressionNode;
};

export type PrintNode = {
    type: 'Print';
    val: ExpressionNode;
};

// if-else文（§5.1）。関数型AST上の条件式（Ifノード）へ変換され、
// SSA合流点のφ関数はその返り値が担う（diamond型の値合流）。
// 分岐本体は文の列（入れ子のif-elseも可）。else無しは空配列で表す。
export type IfNode = {
    type: 'If';
    cond: ExpressionNode;
    then: ASTNode[];
    else: ASTNode[];
};

// while文（§5.2）。関数型AST上の自己参照束縛（LetRec）へ変換される。
// ループ内で再代入される変数はその関数の仮引数（＝ループ先頭のφ）となり、
// ループ不変変数は外側スコープの自由変数として捕捉される（transform.md §1）。
export type WhileNode = {
    type: 'While';
    cond: ExpressionNode;
    body: ASTNode[];
};

export type ExpressionNode =
    | LiteralNode
    | VarNode
    | ApplyNode;

export type LiteralNode = {
    type: 'Literal';
    value: number | string | boolean;
};

export type VarNode = {
    type: 'Var';
    name: string;
};

// 演算子は特殊構文ではなく、すべて第一級関数適用として統一的に扱う。
// AST上の args はあくまで構文（式）であり、値でもThunkでもない。
// Thunk（ヒープセル）はトランスパイラが構築するランタイム概念であり、
// Launchburyの自然意味論における「項（Term）」と「ヒープ（Heap）」の分離に対応する。
export type ApplyNode = {
    type: 'Apply';
    op: 'Add' | 'Sub' | 'Mul' | 'Div' | 'Pow' | 'Mod'
      | 'LessThan' | 'GreaterThan' | 'Equal' | 'NotEqual' | 'LessThanOrEqual' | 'GreaterThanOrEqual'
      | 'And' | 'Or' | 'Not';
    args: ExpressionNode[];
};

// --- call-by-need 評価モデル（CLAUDE.md §3, §4.1） ---

// 対（consセルの最小形、§5.2/§3.2）。WHNF＝外側のセルだけが暴かれ、
// fst/snd は未評価のThunkのまま保持される。
export type PairValue = { kind: 'pair'; fst: Thunk; snd: Thunk };

// 関数値（§5.2の制限付きAPP規則。名前付き・飽和適用のみ、第一級ラムダは§5.4）。
// ラムダはそれ自体がWHNFの値である。env は定義時環境（閉包）で、letrecでは
// 自分自身を含む（不動点）。body の型は循環importを避けるため type-only importで参照。
export type FnValue = { kind: 'fn'; name: string; params: string[]; body: FExpr; env: Env };

export type Value = number | string | boolean | PairValue | FnValue;

// 値の表示用文字列。対・関数は中身をforceせずWHNFのまま表示する。
export const showValue = (v: Value): string => {
    if (typeof v === 'object' && v !== null) {
        if (v.kind === 'pair') return '⟨組⟩';
        return `⟨関数 ${v.name.replace(/^%/, '')}⟩`;
    }
    return String(v);
};

export type EvalState = 'unevaluated' | 'evaluated';

// Thunkは「未評価（計算を再現するクロージャを保持）」「評価済み（値をメモ化保持）」
// の2状態を持つ有限状態機械である（§3.1）。
// `forcing` は評価中を表す過渡状態で、LaunchburyのVAR規則が「束縛の評価中、
// その束縛をヒープから取り除く」ことに対応する。forcing状態への再needは
// ブラックホール（循環定義＝⊥）として制御されたエラーになる（launchbury.md §2.4）。
// この状態が観測されるのは意味論上⊥を表すプログラムのみであり、
// 観測的純粋性（§3.3）は保たれる。
export type Thunk = {
    nodeId: string;
    cell:
        | { state: 'unevaluated'; compute: () => Value }
        | { state: 'forcing' }
        | { state: 'evaluated'; value: Value };
};

// 環境は値ではなくThunkを束縛する（§4.1）。
export type Env = Map<string, Thunk>;

export const OP_SYMBOLS: Record<ApplyNode['op'], string> = {
    Add: '+',
    Sub: '-',
    Mul: '*',
    Div: '/',
    Pow: '^',
    Mod: '%',
    Equal: '==',
    NotEqual: '!=',
    LessThan: '<',
    LessThanOrEqual: '<=',
    GreaterThan: '>',
    GreaterThanOrEqual: '>=',
    And: '&&',
    Or: '||',
    Not: '!',
};
