//import React from 'react';
import BlocklyPane from './components/BlocklyPane';
import FlowPane from './components/FlowPane';

export default function App() {
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      {/* 左画面：Blockly (50%) */}
      <div style={{ flex: 1, borderRight: '2px solid #ccc' }}>
        <BlocklyPane />
      </div>
      {/* 右画面：React Flow (50%) */}
      <div style={{ flex: 1 }}>
        <FlowPane />
      </div>
    </div>
  );
}