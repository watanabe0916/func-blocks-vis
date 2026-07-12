import BlocklyPane from './components/BlocklyPane.tsx';
import FlowPane from './components/FlowPane.tsx';
import ConsolePanel from './components/ConsolePanel.tsx';
import { useStore } from './store.ts';

export default function App() {
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <div style={{ flex: 1, borderRight: '2px solid #ccc' }}>
        <BlocklyPane />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <FlowPane />
        </div>
        <ConsolePanel title="実行結果（関数型）">
          <ConsolePane />
        </ConsolePanel>
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
