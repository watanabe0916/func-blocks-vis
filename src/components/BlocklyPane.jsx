import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import 'blockly/blocks'; // 標準ブロックの読み込み
import * as Ja from 'blockly/msg/ja'; // 日本語化パッケージ
import { useStore } from '../store';

// Blocklyの表示言語を日本語に設定
Blockly.setLocale(Ja);

Blockly.Msg['VARIABLES_SET'] = '%1 = %2';
Blockly.Msg['MATH_CHANGE_TITLE'] = '%1 += %2';

// 左側に表示するブロックのメニュー（ツールボックス）の定義
const toolbox = {
    kind: 'categoryToolbox',
    contents: [
        {
            kind: 'category',
            name: '変数',
            colour: 330,
            custom: 'VARIABLE' // 変数の作成・取得・代入ブロックを自動生成
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
        // React 18のStrictModeによる二重描画を防ぐためのチェック
        if (!workspace.current && blocklyDiv.current) {
            workspace.current = Blockly.inject(blocklyDiv.current, {
                toolbox: toolbox,
                scrollbars: true,
                trashcan: true,
            });
        }
    }, []);

    const handleRun = () => {
        // 【モック】 現状はまだ変換器(トランスパイラ)が未実装のため、
        // 前回の「x=10, y=x, x=x+5」の固定DAGグラフを出力する
        const initialNodes = [
            { id: 'val_1', position: { x: 50, y: 50 }, data: { label: '[値] 10' } },
            { id: 'var_x_1', position: { x: 200, y: 50 }, data: { label: 'x_1' } },
            { id: 'var_y_1', position: { x: 350, y: 50 }, data: { label: 'y_1' } },
            { id: 'val_2', position: { x: 50, y: 150 }, data: { label: '[値] 5' } },
            { id: 'op_add', position: { x: 200, y: 150 }, data: { label: '[+] 加算' } },
            { id: 'var_x_2', position: { x: 350, y: 150 }, data: { label: 'x_2 (新規生成)' }, style: { background: '#ffeb3b' } },
        ];

        const initialEdges = [
            { id: 'e1', source: 'val_1', target: 'var_x_1', animated: true },
            { id: 'e2', source: 'var_x_1', target: 'var_y_1', animated: true },
            { id: 'e3', source: 'val_2', target: 'op_add', animated: true },
            { id: 'e4', source: 'var_x_1', target: 'op_add', animated: true },
            { id: 'e5', source: 'op_add', target: 'var_x_2', animated: true },
        ];

        updateGraph(initialNodes, initialEdges);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 上部コントロールパネル */}
            <div style={{ padding: '10px', borderBottom: '1px solid #ccc', backgroundColor: '#f9f9f9' }}>
                <button onClick={handleRun} style={{ padding: '8px 16px', cursor: 'pointer' }}>
                    関数型に変換して実行 (現在はモック)
                </button>
            </div>

            {/* Blockly描画領域 */}
            <div ref={blocklyDiv} style={{ flex: 1, width: '100%' }} />
        </div>
    );
}