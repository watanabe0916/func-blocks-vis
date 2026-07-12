import React, { useState, useCallback } from 'react';

/**
 * ペイン下部に固定される実行結果コンソールの共通フレーム。
 * 左（手続型、BlocklyPane）と右（関数型、App）で同一の見た目を保証しつつ、
 * 上端の仕切りバーをドラッグすることで左右それぞれ独立に任意の高さへ
 * リサイズできる。
 */
interface ConsolePanelProps {
    title: string;
    defaultHeight?: number;
    children: React.ReactNode;
}

const MIN_HEIGHT = 40;

export default function ConsolePanel({ title, defaultHeight = 120, children }: ConsolePanelProps) {
    const [height, setHeight] = useState(defaultHeight);

    const startDrag = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = height;

        const onMove = (ev: MouseEvent) => {
            // 上へドラッグ＝コンソールを広げる。上限は画面の8割。
            const next = startHeight + (startY - ev.clientY);
            const max = Math.floor(window.innerHeight * 0.8);
            setHeight(Math.min(max, Math.max(MIN_HEIGHT, next)));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'row-resize';
    }, [height]);

    return (
        <div style={{ flexShrink: 0, height, display: 'flex', flexDirection: 'column' }}>
            {/* リサイズ用の仕切りバー */}
            <div
                onMouseDown={startDrag}
                title="ドラッグしてコンソールの高さを変更"
                style={{
                    height: '6px',
                    cursor: 'row-resize',
                    background: '#333',
                    borderTop: '1px solid #555',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                }}
            >
                <div style={{ width: '36px', height: '2px', borderRadius: '1px', background: '#777' }} />
            </div>
            <div style={{ flex: 1, minHeight: 0, backgroundColor: '#1e1e1e', color: '#fff', padding: '10px', overflowY: 'auto', fontFamily: 'monospace' }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', borderBottom: '1px solid #555', paddingBottom: '5px' }}>{title}</h3>
                {children}
            </div>
        </div>
    );
}
