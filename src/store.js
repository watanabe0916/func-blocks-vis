import { create } from 'zustand';

export const useStore = create((set) => ({
    nodes: [],
    edges: [],
    consoleOutput: [],
    // グラフデータを更新する関数
    updateGraph: (nodes, edges) => set({ nodes, edges }),
}));