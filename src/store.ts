import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Node, Edge } from 'reactflow';

interface AppState {
    nodes: Node[];
    edges: Edge[];
    consoleOutput: string[];
    savedLayouts: Record<string, string>;
    updateGraph: (nodes: Node[], edges: Edge[], consoleOutput: string[]) => void;
    saveLayout: (name: string, stateText: string) => void;
    deleteLayout: (name: string) => void;
}

export const useStore = create<AppState>()(
    persist(
        (set) => ({
            nodes: [],
            edges: [],
            consoleOutput: [],
            savedLayouts: {},
            // グラフデータを更新する関数
            updateGraph: (nodes, edges, consoleOutput) => set({ nodes, edges, consoleOutput }),
            // レイアウトを保存
            saveLayout: (name, stateText) => set((state) => ({
                savedLayouts: { ...state.savedLayouts, [name]: stateText }
            })),
            // レイアウトを削除
            deleteLayout: (name) => set((state) => {
                const newLayouts = { ...state.savedLayouts };
                delete newLayouts[name];
                return { savedLayouts: newLayouts };
            }),
        }),
        {
            name: 'func-blocks-storage',
            partialize: (state) => ({ savedLayouts: state.savedLayouts }),
        }
    )
);
