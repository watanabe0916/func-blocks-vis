import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import * as Ja from 'blockly/msg/ja';
import { useStore } from '../store.ts';
import { transpileToSSA } from '../compiler/transpiler.ts';
import { extractAST } from '../compiler/extractor.ts';

Blockly.setLocale(Ja as any);

// 標準の算術演算ブロックに剰余 (%) を追加する
if (Blockly.Blocks['math_arithmetic']) {
    const originalInit = Blockly.Blocks['math_arithmetic'].init;
    Blockly.Blocks['math_arithmetic'].init = function(this: Blockly.Block) {
        originalInit.call(this);
        const opField = this.getField('OP');
        if (opField && 'menuGenerator_' in opField) {
            const options = (opField as any).getOptions(false);
            if (!options.some((opt: any) => opt[1] === 'MODULO')) {
                (opField as any).menuGenerator_.push(['%', 'MODULO']);
            }
        }
    };
}

// 複合代入ブロック
Blockly.defineBlocksWithJsonArray([
  {
    "type": "math_change_ext",
    "message0": "%1 %2 %3",
    "args0": [
        {
            "type": "field_variable",
            "name": "VAR",
            "variable": "x"
        },
        {
            "type": "field_dropdown",
            "name": "OP",
            "options": [
                ["+=", "ADD"],
                ["-=", "MINUS"],
                ["*=", "MULTIPLY"],
                ["/=", "DIVIDE"],
                ["^=", "POWER"],
                ["%=", "MODULO"]
            ]
        },
        {
            "type": "input_value",
            "name": "DELTA",
            "check": "Number"
        }
    ],
    "previousStatement": null,
    "nextStatement": null,
    "colour": 230,
    "tooltip": "変数の値を計算して更新します（複合代入）",
    "helpUrl": ""
  },
  // logic_boolean_ext
  {
    "type": "logic_boolean_ext",
    "message0": "%1",
    "args0": [
        {
            "type": "field_dropdown",
            "name": "BOOL",
            "options": [
                ["true", "TRUE"],
                ["false", "FALSE"]
            ]
        }
    ],
    "output": "Boolean",
    "colour": 280,
    "tooltip": "真偽値リテラル（true または false）を返します。",
    "helpUrl": ""
  },
  // logic_compare_ext
  {
    "type": "logic_compare_ext",
    "message0": "%1 %2 %3",
    "args0": [
        {
            "type": "input_value",
            "name": "A",
            "check": ["Number", "String"]
        },
        {
            "type": "field_dropdown",
            "name": "OP",
            "options": [
                ["=", "EQ"],
                ["\u2260", "NEQ"],
                ["<", "LT"],
                ["\u2264", "LTE"],
                [">", "GT"],
                ["\u2265", "GTE"]
            ]
        },
        {
            "type": "input_value",
            "name": "B",
            "check": ["Number", "String"]
        }
    ],
    "output": "Boolean",
    "inputsInline": true,
    "colour": 280,
    "tooltip": "2つの値（数値または文字列）を比較します。",
    "helpUrl": ""
  },
  // logic_operation_ext
  {
    "type": "logic_operation_ext",
    "message0": "%1 %2 %3",
    "args0": [
        {
            "type": "input_value",
            "name": "A",
            "check": "Boolean"
        },
        {
            "type": "field_dropdown",
            "name": "OP",
            "options": [
                ["AND", "AND"],
                ["OR", "OR"]
            ]
        },
        {
            "type": "input_value",
            "name": "B",
            "check": "Boolean"
        }
    ],
    "output": "Boolean",
    "inputsInline": true,
    "colour": 280,
    "tooltip": "論理積(AND)または論理和(OR)を計算します。",
    "helpUrl": ""
  },
  // logic_negate_ext
  {
    "type": "logic_negate_ext",
    "message0": "NOT %1",
    "args0": [
        {
            "type": "input_value",
            "name": "BOOL",
            "check": "Boolean"
        }
    ],
    "output": "Boolean",
    "colour": 280,
    "tooltip": "真偽値を反転させます。",
    "helpUrl": ""
  }
]);

// 比較ブロックの型一致バリデーションフック
if (Blockly.Blocks['logic_compare_ext']) {
    Blockly.Blocks['logic_compare_ext'].onchange = function(this: Blockly.Block, e: any) {
        if (!this.workspace || (this.workspace as any).isDragging()) return;
        const inputA = this.getInput('A');
        const inputB = this.getInput('B');
        if (!inputA || !inputB) return;
        const connA = inputA.connection;
        const connB = inputB.connection;
        if (!connA || !connB) return;

        const targetA = connA.targetBlock();
        const targetB = connB.targetBlock();

        if (targetA && targetB) {
            const checkA = targetA.outputConnection?.getCheck();
            const checkB = targetB.outputConnection?.getCheck();

            if (checkA && checkB) {
                const arrA = Array.isArray(checkA) ? checkA : [checkA];
                const arrB = Array.isArray(checkB) ? checkB : [checkB];
                const hasIntersection = arrA.some(t => arrB.includes(t));

                if (!hasIntersection) {
                    this.setWarningText('型エラー：左右の入力ポートの型（数値/文字列）が一致していません！');
                    if (e && e.type === Blockly.Events.BLOCK_MOVE) {
                        if (e.blockId === targetB.id) {
                            targetB.outputConnection?.disconnect();
                        } else if (e.blockId === targetA.id) {
                            targetA.outputConnection?.disconnect();
                        }
                    }
                } else {
                    this.setWarningText(null);
                }
            } else {
                this.setWarningText(null);
            }
        } else {
            this.setWarningText(null);
        }
    };
}

// @ts-ignore
Blockly.Msg['VARIABLES_SET'] = '%1 = %2';

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
            name: '数学・計算',
            colour: 230,
            contents: [
                { kind: 'block', type: 'math_number' },
                { kind: 'block', type: 'math_arithmetic' },
                { kind: 'block', type: 'math_change_ext' }
            ]
        },
        {
            kind: 'category',
            name: '論理・比較',
            colour: 280,
            contents: [
                { kind: 'block', type: 'logic_boolean_ext' },
                { kind: 'block', type: 'logic_compare_ext' },
                { kind: 'block', type: 'logic_operation_ext' },
                { kind: 'block', type: 'logic_negate_ext' }
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
        console.log('--- Extracted AST ---', ast);

        // 2. SSAグラフと実行結果を生成する
        const result = transpileToSSA(ast);
        console.log('--- Transpilation Result (SSA Graph & Output) ---', result);

        // 3. Zustand(store) へデータを渡す
        const { nodes, edges, consoleOutput } = result;
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
