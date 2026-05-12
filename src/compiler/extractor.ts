import * as Blockly from 'blockly/core';
import { ASTNode, ExpressionNode, ArithmeticNode } from './types';

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
            
            const opMap: Record<string, ArithmeticNode['type']> = {
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
                    type: opMap[op] || 'Add',
                    left: { type: 'Var', name: varName },
                    right: exprToAST(block.getInputTargetBlock('DELTA'))
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

        case 'math_arithmetic':
        case 'math_arithmetic_ext': {
            const op = block.getFieldValue('OP') as string;
            const leftBlock = block.getInputTargetBlock('A');
            const rightBlock = block.getInputTargetBlock('B');
            
            // 四則演算のマッピング
            const opMap: Record<string, ArithmeticNode['type']> = {
                'ADD': 'Add',
                'MINUS': 'Sub',
                'MULTIPLY': 'Mul',
                'DIVIDE': 'Div',
                'POWER': 'Pow',
                'MODULO': 'Mod'
            };

            return {
                type: opMap[op] || 'Add',
                left: exprToAST(leftBlock),
                right: exprToAST(rightBlock)
            };
        }

        case 'text':
            return {
                type: 'Literal',
                value: block.getFieldValue('TEXT')
            };

        default:
            return { type: 'Literal', value: 0 };
    }
}
