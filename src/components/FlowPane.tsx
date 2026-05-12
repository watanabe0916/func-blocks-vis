import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore } from '../store.ts';

export default function FlowPane() {
    const { nodes, edges } = useStore();

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow nodes={nodes} edges={edges} fitView>
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    );
}
