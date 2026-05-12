import { create } from 'zustand';

export const useStore = create((set) => ({
    nodes: [],
    edges: [],
    consoleOutput: [],
    // グラフデータを更新する関数
    updateGraph: (nodes, edges, consoleOutput) => set({ nodes, edges,
        consoleOutput }),
}));