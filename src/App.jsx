//import React from 'react';
import BlocklyPane from './components/BlocklyPane';
import FlowPane from './components/FlowPane';
import { useStore } from './store';

export default function App() {
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <div style={{ flex: 1, borderRight: '2px solid #ccc' }}>
        <BlocklyPane />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 3 }}>
          <FlowPane />
        </div>
        <div style={{ flex: 1, backgroundColor: '#1e1e1e', color: '#fff', padding: '10px', overflowY: 'auto', fontFamily: 'monospace' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', borderBottom: '1px solid #555', paddingBottom: '5px' }}>実行結果</h3>
          <ConsolePane />
        </div>
      </div>
    </div>
  );
}

function ConsolePane() {
  const consoleOutput = useStore((state) => state.consoleOutput);
  return (
    <div>
      {consoleOutput.map((line, i) => (
        <div key={i}>{`> ${line}`}</div>
      ))}
    </div>
  );
}