import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import * as Ja from 'blockly/msg/ja';
import { useStore } from '../store.ts';
import { transpileToSSA } from '../compiler/transpiler.ts';
import { extractAST } from '../compiler/extractor.ts';

Blockly.setLocale(Ja as any);

// @ts-ignore
Blockly.Msg['VARIABLES_SET'] = '%1 = %2';
// @ts-ignore
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
    const blocklyDiv = useRef<HTMLDivElement>(null);
    const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
    const updateGraph = useStore((state) => state.updateGraph);
    const { saveLayout, deleteLayout, savedLayouts } = useStore();
    const [selectedLayout, setSelectedLayout] = useState('');

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
        if (!workspace.current) return;
        // 1. ワークスペースから動的にASTを抽出する
        const ast = extractAST(workspace.current);
        const { nodes, edges, consoleOutput } = transpileToSSA(ast);

        // 2. Zustand(store) へ3つのデータをすべて渡す
        updateGraph(nodes, edges, consoleOutput);
    };

    const handleSave = () => {
        if (!workspace.current) return;
        const name = window.prompt('保存する名前を入力してください:');
        if (!name) return;

        // 現在のワークスペースの状態をJSON形式（推奨）で保存
        const state = Blockly.serialization.workspaces.save(workspace.current);
        const stateText = JSON.stringify(state);
        saveLayout(name, stateText);
        setSelectedLayout(name);
        alert(`「${name}」として保存しました。`);
    };

    const handleRestore = () => {
        if (!workspace.current || !selectedLayout || !savedLayouts[selectedLayout]) {
            alert('復元するレイアウトを選択してください。');
            return;
        }

        try {
            const stateText = savedLayouts[selectedLayout];
            const state = JSON.parse(stateText);
            workspace.current.clear();
            Blockly.serialization.workspaces.load(state, workspace.current);
        } catch (e) {
            console.error('復元エラー:', e);
            alert('復元に失敗しました。データ形式が古い可能性があります。');
        }
    };

    const handleDelete = () => {
        if (!selectedLayout || !savedLayouts[selectedLayout]) {
            alert('削除するレイアウトを選択してください。');
            return;
        }

        if (window.confirm(`「${selectedLayout}」を削除してもよろしいですか？`)) {
            deleteLayout(selectedLayout);
            setSelectedLayout('');
            alert('削除しました。');
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '10px', borderBottom: '1px solid #ccc', backgroundColor: '#f9f9f9', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={handleRun} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: '#4caf50', color: 'white', border: 'none', borderRadius: '4px' }}>
                    関数型に変換して実行
                </button>
                
                <div style={{ borderLeft: '1px solid #ccc', height: '24px', margin: '0 5px' }} />

                <button onClick={handleSave} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: '#2196f3', color: 'white', border: 'none', borderRadius: '4px' }}>
                    保存
                </button>

                <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                    <select 
                        value={selectedLayout} 
                        onChange={(e) => setSelectedLayout(e.target.value)}
                        style={{ padding: '7px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '120px' }}
                    >
                        <option value="">-- レイアウトを選択 --</option>
                        {Object.keys(savedLayouts).map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                    <button onClick={handleRestore} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: '#ff9800', color: 'white', border: 'none', borderRadius: '4px' }}>
                        復元
                    </button>
                    <button onClick={handleDelete} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '4px' }}>
                        削除
                    </button>
                </div>
            </div>
            <div ref={blocklyDiv} style={{ flex: 1, width: '100%' }} />
        </div>
    );
}
