import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as Ja from 'blockly/msg/ja';
import { useStore } from '../store';
import { extractAST, transpileToSSA } from '../compiler/transpiler'; // 追加: トランスパイラの読み込み

Blockly.setLocale(Ja);

Blockly.Msg['VARIABLES_SET'] = '%1 = %2';
Blockly.Msg['MATH_CHANGE_TITLE'] = '%1 += %2';

const toolbox = {
    kind: 'categoryToolbox',
    contents: [
        {
            kind: 'category',
            name: '変数',
            colour: 330,
            custom: 'VARIABLE'
        },
        {
            kind: 'category',
            name: '数学',
            colour: 230,
            contents: [
                { kind: 'block', type: 'math_number' },
                { kind: 'block', type: 'math_arithmetic' }
            ]
        },
        {
            kind: 'category',
            name: 'テキスト出力',
            colour: 160,
            contents: [
                { kind: 'block', type: 'text_print' }
            ]
        }
    ]
};

export default function BlocklyPane() {
    const blocklyDiv = useRef(null);
    const workspace = useRef(null);
    const updateGraph = useStore((state) => state.updateGraph);

    useEffect(() => {
        if (!workspace.current && blocklyDiv.current) {
            workspace.current = Blockly.inject(blocklyDiv.current, {
                toolbox: toolbox,
                scrollbars: true,
                trashcan: true,
            });
        }
    }, []);

    const handleRun = () => {
        // 1. 固定のモックではなく、transpiler.js からASTとグラフ・コンソール出力を生成する
        const ast = extractAST();
        const { nodes, edges, consoleOutput } = transpileToSSA(ast);

        // 2. Zustand(store) へ3つのデータをすべて渡す
        updateGraph(nodes, edges, consoleOutput);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '10px', borderBottom: '1px solid #ccc', backgroundColor: '#f9f9f9' }}>
                <button onClick={handleRun} style={{ padding: '8px 16px', cursor: 'pointer' }}>
                    関数型に変換して実行
                </button>
            </div>
            <div ref={blocklyDiv} style={{ flex: 1, width: '100%' }} />
        </div>
    );
}