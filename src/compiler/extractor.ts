import * as Blockly from 'blockly/core';
import { ASTNode, ExpressionNode, ApplyNode } from './types';

/**
 * Blocklyのワークスペースから独自形式の手続型AST（JSON）を抽出するジェネレータ
 */
export function extractAST(workspace: Blockly.Workspace | null): ASTNode[] {
    if (!workspace) return [];
    
    // トップレベルのブロックを取得（実行順序を考慮）
    const topBlocks = workspace.getTopBlocks(true);
    const ast: ASTNode[] = [];

    topBlocks.forEach((block) => {
        let currentBlock: Blockly.Block | null = block;
        while (currentBlock) {
            const stmt = blockToAST(currentBlock);
            if (stmt) {
                ast.push(stmt);
            }
            // 次に接続されているブロックへ移動
            currentBlock = currentBlock.getNextBlock();
        }
    });

    return ast;
}

/**
 * 各ブロックをASTノードに変換
 */
function blockToAST(block: Blockly.Block): ASTNode | null {
    switch (block.type) {
        case 'variables_set':
            return {
                type: 'Assign',
                var: block.getField('VAR')!.getText(),
                val: exprToAST(block.getInputTargetBlock('VALUE'))
            };

        case 'text_print':
            return {
                type: 'Print',
                val: exprToAST(block.getInputTargetBlock('TEXT'))
            };

        case 'math_change_ext': { // 新しい複合代入ブロック
            const varName = block.getField('VAR')!.getText();
            const op = block.getFieldValue('OP');

            const opMap: Record<string, ApplyNode['op']> = {
                'ADD': 'Add',
                'MINUS': 'Sub',
                'MULTIPLY': 'Mul',
                'DIVIDE': 'Div',
                'POWER': 'Pow',
                'MODULO': 'Mod'
            };

            return {
                type: 'Assign',
                var: varName,
                val: {
                    type: 'Apply',
                    op: opMap[op] || 'Add',
                    args: [
                        { type: 'Var', name: varName },
                        exprToAST(block.getInputTargetBlock('DELTA'))
                    ]
                }
            };
        }

        default:
            // 対応していないブロックはスキップ
            return null;
    }
}

/**
 * 式（値）を抽出する
 */
function exprToAST(block: Blockly.Block | null): ExpressionNode {
    if (!block) return { type: 'Literal', value: 0 };

    switch (block.type) {
        case 'math_number':
            return { 
                type: 'Literal', 
                value: Number(block.getFieldValue('NUM')) 
            };

        case 'variables_get':
            return { 
                type: 'Var', 
                name: block.getField('VAR')!.getText() 
            };

        case 'math_arithmetic': {
            const op = block.getFieldValue('OP') as string;
            const leftBlock = block.getInputTargetBlock('A');
            const rightBlock = block.getInputTargetBlock('B');

            // 四則演算のマッピング（第一級関数適用として統一）
            const opMap: Record<string, ApplyNode['op']> = {
                'ADD': 'Add',
                'MINUS': 'Sub',
                'MULTIPLY': 'Mul',
                'DIVIDE': 'Div',
                'POWER': 'Pow',
                'MODULO': 'Mod'
            };

            return {
                type: 'Apply',
                op: opMap[op] || 'Add',
                args: [exprToAST(leftBlock), exprToAST(rightBlock)]
            };
        }

        case 'text':
            return {
                type: 'Literal',
                value: block.getFieldValue('TEXT')
            };

        case 'logic_boolean_ext':
            return {
                type: 'Literal',
                value: block.getFieldValue('BOOL') === 'TRUE'
            };

        case 'logic_compare_ext': {
            const op = block.getFieldValue('OP') as string;
            const leftBlock = block.getInputTargetBlock('A');
            const rightBlock = block.getInputTargetBlock('B');

            const opMap: Record<string, ApplyNode['op']> = {
                'EQ': 'Equal',
                'NEQ': 'NotEqual',
                'LT': 'LessThan',
                'LTE': 'LessThanOrEqual',
                'GT': 'GreaterThan',
                'GTE': 'GreaterThanOrEqual'
            };

            return {
                type: 'Apply',
                op: opMap[op] || 'Equal',
                args: [exprToAST(leftBlock), exprToAST(rightBlock)]
            };
        }

        case 'logic_operation_ext': {
            const op = block.getFieldValue('OP') as string;
            const leftBlock = block.getInputTargetBlock('A');
            const rightBlock = block.getInputTargetBlock('B');

            const opMap: Record<string, ApplyNode['op']> = {
                'AND': 'And',
                'OR': 'Or'
            };

            return {
                type: 'Apply',
                op: opMap[op] || 'And',
                args: [exprToAST(leftBlock), exprToAST(rightBlock)]
            };
        }

        case 'logic_negate_ext': {
            const boolBlock = block.getInputTargetBlock('BOOL');
            return {
                type: 'Apply',
                op: 'Not',
                args: [exprToAST(boolBlock)]
            };
        }

        default:
            return { type: 'Literal', value: 0 };
    }
}
