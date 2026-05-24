export type ASTNode = AssignNode | PrintNode;

export type AssignNode = {
    type: 'Assign';
    var: string;
    val: ExpressionNode;
};

export type PrintNode = {
    type: 'Print';
    val: ExpressionNode;
};

export type ExpressionNode = 
    | LiteralNode 
    | VarNode 
    | ArithmeticNode
    | ApplyNode;

export type LiteralNode = {
    type: 'Literal';
    value: number | string | boolean;
};

export type VarNode = {
    type: 'Var';
    name: string;
};

export type ArithmeticNode = {
    type: 'Add' | 'Sub' | 'Mul' | 'Div' | 'Pow' | 'Mod';
    left: ExpressionNode;
    right: ExpressionNode;
};

export type ApplyNode = {
    type: 'Apply';
    op: 'LessThan' | 'GreaterThan' | 'Equal' | 'NotEqual' | 'LessThanOrEqual' | 'GreaterThanOrEqual' | 'And' | 'Or' | 'Not';
    args: ExpressionNode[];
};

