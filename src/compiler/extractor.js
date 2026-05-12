/**
 * Blocklyのワークスペースから独自形式の手続型AST（JSON）を抽出するジェネレータ
 */

export function extractAST(workspace) {
    if (!workspace) return [];
    
    // トップレベルのブロックを取得（実行順序を考慮）
    const topBlocks = workspace.getTopBlocks(true);
    const ast = [];

    topBlocks.forEach((block) => {
        let currentBlock = block;
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
function blockToAST(block) {
    switch (block.type) {
        case 'variables_set':
            return {
                type: 'Assign',
                var: block.getField('VAR').getText(),
                val: exprToAST(block.getInputTargetBlock('VALUE'))
            };

        case 'text_print':
            return {
                type: 'Print',
                val: exprToAST(block.getInputTargetBlock('TEXT'))
            };

        case 'math_change': { // x += 1
            const varName = block.getField('VAR').getText();
            return {
                type: 'Assign',
                var: varName,
                val: {
                    type: 'Add',
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
function exprToAST(block) {
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
                name: block.getField('VAR').getText() 
            };

        case 'math_arithmetic': {
            const op = block.getFieldValue('OP');
            const leftBlock = block.getInputTargetBlock('A');
            const rightBlock = block.getInputTargetBlock('B');
            
            // 四則演算のマッピング
            const opMap = {
                'ADD': 'Add',
                'MINUS': 'Sub',
                'MULTIPLY': 'Mul',
                'DIVIDE': 'Div'
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
