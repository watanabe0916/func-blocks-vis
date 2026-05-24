import ReactFlow, { Background, Controls, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore } from '../store.ts';

// --- Custom Value Node Component ---
const ValNode = ({ data, style }: any) => {
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
            padding: '10px 15px',
            borderRadius: '8px',
            background: bg,
            color: color,
            border: `2px solid ${borderColor}`,
            fontSize: '13px',
            fontWeight: 'bold',
            fontFamily: 'Inter, sans-serif',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
            minWidth: '80px',
            textAlign: 'center',
            position: 'relative'
        }}>
            {/* 左側に入力用のターゲットハンドル（代入時にエッジが接続される） */}
            <Handle type="target" position={Position.Left} style={{ background: borderColor }} />
            
            <div>
                {data.isVar ? (
                    <div>
                        <span style={{ fontSize: '10px', opacity: 0.6, display: 'block', marginBottom: '2px' }}>VAR</span>
                        {data.label}
                        <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '4px', color: '#5d4037' }}>
                            値: {String(val)}
                        </span>
                    </div>
                ) : (
                    <div>
                        <span style={{ fontSize: '10px', opacity: 0.6, display: 'block', marginBottom: '2px' }}>VALUE</span>
                        {String(val)}
                    </div>
                )}
            </div>

            {/* 右側に出力用のソースハンドル */}
            <Handle type="source" position={Position.Right} style={{ background: borderColor }} />
        </div>
    );
};

// --- Custom Operator Node Component ---
const OpNode = ({ id, data }: any) => {
    const toggleFold = useStore((state) => state.toggleNodeFold);
    const folded = data.folded;
    const isBoolResult = typeof data.result === 'boolean';
    const result = data.result;

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
            borderRadius: '10px',
            border: `2px solid ${borderColor}`,
            background: '#ffffff',
            boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
            fontSize: '12px',
            fontFamily: 'Inter, sans-serif',
            minWidth: folded ? '140px' : '100px',
            overflow: 'hidden',
            transition: 'all 0.2s ease-in-out',
            position: 'relative'
        }}>
            {/* 左側に入力用のターゲットハンドル */}
            <Handle type="target" position={Position.Left} style={{ background: borderColor }} />

            {folded ? (
                // --- 簡約表示（Elision）状態 ---
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#78909c' }}>演算 (簡約)</span>
                        {(data.isElision || data.hasEmbeddedLiteral) && (
                            <button 
                                onClick={handleToggle}
                                style={{
                                    border: 'none',
                                    background: '#e0f7fa',
                                    color: '#006064',
                                    borderRadius: '4px',
                                    fontSize: '9px',
                                    padding: '2px 6px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                展開 ▽
                            </button>
                        )}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#37474f', margin: '4px 0' }}>
                        <code>{data.isElision ? getFormulaText() : getDisplayLabel()}</code>
                    </div>
                    <div style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        background: result === true ? '#e8f5e9' : '#ffebee',
                        color: result === true ? '#2e7d32' : '#c62828',
                        fontWeight: 'bold',
                        fontSize: '11px',
                        border: `1px solid ${result === true ? '#c8e6c9' : '#ffcdd2'}`
                    }}>
                        {String(result)}
                    </div>
                </div>
            ) : (
                // --- 詳細表示状態 ---
                <div>
                    <div style={{
                        background: headerBg,
                        padding: '6px 10px',
                        borderBottom: '1px solid rgba(0,0,0,0.06)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontWeight: 'bold',
                        color: '#455a64'
                    }}>
                        <span>演算: {data.op || '算術'}</span>
                        {(data.isElision || data.hasEmbeddedLiteral) && (
                            <button 
                                onClick={handleToggle}
                                style={{
                                    border: 'none',
                                    background: '#eceff1',
                                    color: '#37474f',
                                    borderRadius: '4px',
                                    fontSize: '9px',
                                    padding: '2px 6px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                閉じる △
                            </button>
                        )}
                    </div>
                    <div style={{ padding: '10px', textAlign: 'center' }}>
                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#263238', margin: '4px 0' }}>
                            {getDisplayLabel()}
                        </div>
                        {isBoolResult && (
                            <div style={{
                                marginTop: '6px',
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: result === true ? '#e8f5e9' : '#ffebee',
                                color: result === true ? '#2e7d32' : '#c62828',
                                fontWeight: 'bold',
                                fontSize: '10px'
                            }}>
                                結果: {String(result)}
                            </div>
                        )}
                        {data.shortCircuited && (
                            <div style={{
                                marginTop: '4px',
                                fontSize: '9px',
                                color: '#e65100',
                                fontWeight: 'bold'
                            }}>
                                短絡評価 (右辺未評価)
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 右側に出力用のソースハンドル */}
            <Handle type="source" position={Position.Right} style={{ background: borderColor }} />
        </div>
    );
};

// カスタムノードの登録
const nodeTypes = {
    valNode: ValNode,
    opNode: OpNode,
};

export default function FlowPane() {
    const { nodes, edges } = useStore();

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

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow 
                nodes={visibleNodes} 
                edges={visibleEdges} 
                nodeTypes={nodeTypes}
                fitView
            >
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    );
}
