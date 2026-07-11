export type ASTNode = AssignNode | PrintNode | IfNode;

export type AssignNode = {
    type: 'Assign';
    var: string;
    val: ExpressionNode;
};

export type PrintNode = {
    type: 'Print';
    val: ExpressionNode;
};

// if-else文（§5.1）。関数型AST上の三項演算子（Ifノード）へ変換され、
// SSA合流点のφ関数はその返り値が担う（diamond型の値合流）。
// 分岐本体は文の列（入れ子のif-elseも可）。else無しは空配列で表す。
export type IfNode = {
    type: 'If';
    cond: ExpressionNode;
    then: ASTNode[];
    else: ASTNode[];
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

export type Value = number | string | boolean;

export type EvalState = 'unevaluated' | 'evaluated';

// Thunkは「未評価（計算を再現するクロージャを保持）」「評価済み（値をメモ化保持）」
// の2状態を持つ有限状態機械である（§3.1）。
export type Thunk = {
    nodeId: string;
    cell:
        | { state: 'unevaluated'; compute: () => Value }
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
