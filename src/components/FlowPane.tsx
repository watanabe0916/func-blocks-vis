import React from 'react';
import ReactFlow, { Background, Controls, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore } from '../store.ts';

// --- Custom Value Node Component ---
const ValNode = ({ data, style, selected }: any) => {
    const isBool = typeof data.value === 'boolean';
    const val = data.value;
    
    // 値の型に基づいてデザインを選択
    let bg = '#f5f7fa';
    let color = '#37474f';
    let borderColor = '#cfd8dc';
    
    if (data.isVar) {
        // 変数はストアやトランスパイラから指定された背景色を優先
        bg = style?.background || '#fff9c4';
        color = '#5d4037';
        borderColor = '#fbc02d';
    } else if (isBool) {
        if (val === true) {
            bg = '#e8f5e9';
            color = '#2e7d32';
            borderColor = '#81c784';
        } else {
            bg = '#ffebee';
            color = '#c62828';
            borderColor = '#e57373';
        }
    } else if (data.isLiteral) {
        bg = '#e3f2fd';
        color = '#1565c0';
        borderColor = '#90caf9';
    }

    return (
        <div style={{
            padding: '2px 8px',
            borderRadius: '4px',
            background: bg,
            color: color,
            border: `1.5px solid ${selected ? '#ff5722' : borderColor}`,
            fontSize: '11px',
            fontWeight: 'bold',
            fontFamily: 'Inter, sans-serif',
            boxShadow: selected ? '0 0 8px rgba(255, 87, 34, 0.5)' : '0 1px 3px rgba(0, 0, 0, 0.05)',
            width: 'max-content',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            minHeight: '20px',
            transition: 'border-color 0.2s, box-shadow 0.2s'
        }}>
            {/* 左側に入力用のターゲットハンドル（代入時にエッジが接続される） */}
            <Handle type="target" position={Position.Left} style={{ background: borderColor }} />
            
            {data.isVar ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '8px', opacity: 0.6, background: 'rgba(0,0,0,0.05)', padding: '1px 3px', borderRadius: '2px' }}>VAR</span>
                    <span style={{ fontSize: '11px' }}>{data.label}</span>
                    <span style={{ opacity: 0.4 }}>=</span>
                    <span style={{ fontSize: '11px', color: '#5d4037' }}>{String(val)}</span>
                </div>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '8px', opacity: 0.6, background: 'rgba(0,0,0,0.05)', padding: '1px 3px', borderRadius: '2px' }}>VALUE</span>
                    <span style={{ fontSize: '11px' }}>{String(val)}</span>
                </div>
            )}

            {/* 右側に出力用のソースハンドル */}
            <Handle type="source" position={Position.Right} style={{ background: borderColor }} />
        </div>
    );
};

// --- Custom Operator Node Component ---
const OpNode = ({ id, data, selected }: any) => {
    const toggleFold = useStore((state) => state.toggleNodeFold);
    const folded = data.folded;
    const isBoolResult = typeof data.result === 'boolean';
    const result = data.result;
    const isUnary = data.op === 'Not';

    // 結果に基づいて枠線・ヘッダーの色を変更
    let borderColor = '#90a4ae';
    let headerBg = '#eceff1';
    if (isBoolResult) {
        if (result === true) {
            borderColor = '#4caf50';
            headerBg = '#e8f5e9';
        } else {
            borderColor = '#f44336';
            headerBg = '#ffebee';
        }
    }

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation(); // React Flowの選択イベントへの伝播を防止
        toggleFold(id);
    };

    // 折りたたみ時に表示する数式の文字列表現を作成
    const getFormulaText = () => {
        const leftVal = data.args?.left 
            ? (data.args.left.isVar ? data.args.left.name : String(data.args.left.value)) 
            : '?';
        const rightVal = data.args?.right 
            ? (data.args.right.isVar ? data.args.right.name : String(data.args.right.value)) 
            : '?';
        const symbols: Record<string, string> = {
            'Equal': '==',
            'NotEqual': '!=',
            'LessThan': '<',
            'LessThanOrEqual': '<=',
            'GreaterThan': '>',
            'GreaterThanOrEqual': '>=',
            'And': '&&',
            'Or': '||',
            'Not': '!'
        };
        const symbol = symbols[data.op] || data.label || '';
        
        if (data.op === 'Not') {
            return `!${leftVal}`;
        }
        return `${leftVal} ${symbol} ${rightVal}`;
    };

    // 折りたたみ状態や埋め込み状態に応じた表示用のラベルを取得する
    const getDisplayLabel = () => {
        const symbols: Record<string, string> = {
            'Equal': '==',
            'NotEqual': '!=',
            'LessThan': '<',
            'LessThanOrEqual': '<=',
            'GreaterThan': '>',
            'GreaterThanOrEqual': '>=',
            'And': '&&',
            'Or': '||',
            'Not': '!'
        };
        const symbol = symbols[data.op] || data.label || '';
        
        if (folded) {
            if (data.embeddedLeft !== undefined) {
                return `${data.embeddedLeft} ${symbol}`;
            }
            if (data.embeddedRight !== undefined) {
                return `${symbol} ${data.embeddedRight}`;
            }
        }
        return symbol;
    };

    return (
        <div style={{
            borderRadius: '6px',
            border: `1.5px solid ${selected ? '#ff5722' : borderColor}`,
            background: '#ffffff',
            boxShadow: selected ? '0 0 8px rgba(255, 87, 34, 0.5)' : '0 2px 4px rgba(0,0,0,0.06)',
            fontSize: '11px',
            fontFamily: 'Inter, sans-serif',
            width: 'max-content',
            overflow: 'hidden',
            transition: 'border-color 0.2s, box-shadow 0.2s, all 0.2s ease-in-out',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* 左側に入力用のターゲットハンドル。Not の場合は中央に1つ、二項演算子の場合は上下に2つ配置 */}
            {isUnary ? (
                <Handle type="target" position={Position.Left} id="left" style={{ background: borderColor }} />
            ) : (
                <>
                    <Handle type="target" position={Position.Left} id="left" style={{ top: '25%', background: borderColor }} />
                    <Handle type="target" position={Position.Left} id="right" style={{ top: '75%', background: borderColor }} />
                </>
            )}

            {folded ? (
                // --- 簡約表示（Elision）状態：1行でコンパクトに表示 ---
                <div style={{ 
                    padding: '2px 8px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    whiteSpace: 'nowrap',
                    minHeight: isUnary ? '20px' : '28px'
                }}>
                    {!isUnary && (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            alignSelf: 'stretch',
                            fontSize: '7px',
                            fontWeight: 'bold',
                            color: '#90a4ae',
                            marginRight: '4px',
                            lineHeight: '1',
                            paddingTop: '2px',
                            paddingBottom: '2px'
                        }}>
                            <span>L</span>
                            <span>R</span>
                        </div>
                    )}
                    <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#78909c', background: '#eceff1', padding: '1px 3px', borderRadius: '2px' }}>OP</span>
                    <code style={{ fontSize: '11px', fontWeight: 'bold', color: '#37474f' }}>
                        {data.isElision ? getFormulaText() : getDisplayLabel()}
                    </code>
                    <span style={{ opacity: 0.4 }}>→</span>
                    <span style={{
                        padding: '1px 4px',
                        borderRadius: '8px',
                        background: result === true ? '#e8f5e9' : '#ffebee',
                        color: result === true ? '#2e7d32' : '#c62828',
                        fontWeight: 'bold',
                        fontSize: '10px'
                    }}>
                        {String(result)}
                    </span>
                    {(data.isElision || data.hasEmbeddedLiteral) && (
                        <button 
                            onClick={handleToggle}
                            style={{
                                border: 'none',
                                background: '#e0f7fa',
                                color: '#006064',
                                borderRadius: '3px',
                                fontSize: '8px',
                                padding: '1px 3px',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                            }}
                        >
                            展開 ▽
                        </button>
                    )}
                </div>
            ) : (
                // --- 詳細表示状態 ---
                <div style={{ whiteSpace: 'nowrap' }}>
                    <div style={{
                        background: headerBg,
                        padding: '2px 6px',
                        borderBottom: '1px solid rgba(0,0,0,0.06)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontWeight: 'bold',
                        color: '#455a64',
                        gap: '8px'
                    }}>
                        <span style={{ fontSize: '9px' }}>演算: {data.op || '算術'}</span>
                        {(data.isElision || data.hasEmbeddedLiteral) && (
                            <button 
                                onClick={handleToggle}
                                style={{
                                    border: 'none',
                                    background: '#eceff1',
                                    color: '#37474f',
                                    borderRadius: '3px',
                                    fontSize: '8px',
                                    padding: '1px 3px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                閉じる △
                            </button>
                        )}
                    </div>
                    <div style={{ 
                        padding: '4px 8px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px',
                        minHeight: isUnary ? 'auto' : '36px'
                    }}>
                        {!isUnary && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                height: '24px',
                                fontSize: '7px',
                                fontWeight: 'bold',
                                color: '#90a4ae',
                                marginRight: '4px',
                                lineHeight: '1'
                            }}>
                                <span>L</span>
                                <span>R</span>
                            </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#263238' }}>
                                {getDisplayLabel()}
                            </div>
                            {isBoolResult && (
                                <div style={{
                                    display: 'inline-block',
                                    padding: '1px 4px',
                                    borderRadius: '8px',
                                    background: result === true ? '#e8f5e9' : '#ffebee',
                                    color: result === true ? '#2e7d32' : '#c62828',
                                    fontWeight: 'bold',
                                    fontSize: '9px'
                                }}>
                                    結果: {String(result)}
                                </div>
                            )}
                            {data.shortCircuited && (
                                <div style={{
                                    marginTop: '2px',
                                    fontSize: '8px',
                                    color: '#e65100',
                                    fontWeight: 'bold'
                                }}>
                                    短絡評価 (右辺未評価)
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 右側に出力用のソースハンドル */}
            <Handle type="source" position={Position.Right} style={{ background: borderColor }} />
        </div>
    );
};

// --- Custom Print Node Component ---
const PrintNode = ({ data, selected }: any) => {
    return (
        <div style={{
            padding: '2px 8px',
            borderRadius: '4px',
            background: '#4caf50',
            color: '#ffffff',
            border: `1.5px solid ${selected ? '#ff5722' : '#2e7d32'}`,
            fontSize: '11px',
            fontWeight: 'bold',
            fontFamily: 'Inter, sans-serif',
            boxShadow: selected ? '0 0 8px rgba(255, 87, 34, 0.5)' : '0 1px 3px rgba(0, 0, 0, 0.05)',
            width: 'max-content',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            minHeight: '20px',
            transition: 'border-color 0.2s, box-shadow 0.2s'
        }}>
            <Handle type="target" position={Position.Left} style={{ background: '#2e7d32' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '8px', opacity: 0.8, background: 'rgba(255,255,255,0.2)', padding: '1px 3px', borderRadius: '2px' }}>PRINT</span>
                <span style={{ fontSize: '11px' }}>{String(data.value)}</span>
            </div>
        </div>
    );
};

// カスタムノードの登録
const nodeTypes = {
    valNode: ValNode,
    opNode: OpNode,
    printNode: PrintNode,
};

export default function FlowPane() {
    const { nodes, edges, onNodesChange, onEdgesChange } = useStore();

    // 折りたたまれている演算子ノードのIDセットを作成
    const foldedOpIds = new Set(
        nodes
            .filter(n => n.type === 'opNode' && n.data?.folded)
            .map(n => n.id)
    );

    // 親の演算子が折りたたまれているリテラル入力ノードを除外して表示
    const visibleNodes = nodes.filter(node => {
        if (node.data?.parentId && foldedOpIds.has(node.data.parentId)) {
            return false;
        }
        return true;
    });

    // 非表示となったノードへ繋がっていたエッジを除外して表示
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = edges.filter(edge => {
        return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
    });

    // 選択されているノードのIDを取得
    const selectedNode = visibleNodes.find(n => n.selected);
    const selectedNodeId = selectedNode ? selectedNode.id : null;

    // 選択されたノードと接続されているエッジをハイライトする
    const visibleEdgesWithHighlight = visibleEdges.map(edge => {
        const isConnected = selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
        
        if (selectedNodeId) {
            if (isConnected) {
                return {
                    ...edge,
                    animated: true,
                    style: {
                        ...edge.style,
                        stroke: '#ff5722', // 鮮やかなオレンジ
                        strokeWidth: 3,
                        transition: 'stroke 0.2s, stroke-width 0.2s'
                    }
                };
            } else {
                return {
                    ...edge,
                    animated: false,
                    style: {
                        ...edge.style,
                        stroke: '#eceff1', // 薄いグレーに減衰
                        opacity: 0.3,
                        transition: 'stroke 0.2s, opacity 0.2s'
                    }
                };
            }
        }
        return edge;
    });

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow 
                nodes={visibleNodes} 
                edges={visibleEdgesWithHighlight} 
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                fitView
            >
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    );
}
