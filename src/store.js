import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useStore = create(
    persist(
        (set) => ({
            nodes: [],
            edges: [],
            consoleOutput: [],
            savedLayouts: {}, // { name: xmlText }
            // グラフデータを更新する関数
            updateGraph: (nodes, edges, consoleOutput) => set({ nodes, edges, consoleOutput }),
            // レイアウトを保存
            saveLayout: (name, xmlText) => set((state) => ({
                savedLayouts: { ...state.savedLayouts, [name]: xmlText }
            })),
            // レイアウトを削除（必要に応じて）
            deleteLayout: (name) => set((state) => {
                const newLayouts = { ...state.savedLayouts };
                delete newLayouts[name];
                return { savedLayouts: newLayouts };
            }),
        }),
        {
            name: 'func-blocks-storage',
            partialize: (state) => ({ savedLayouts: state.savedLayouts }), // savedLayoutsのみ永続化
        }
    )
);