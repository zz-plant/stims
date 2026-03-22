import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropRenderBackend,
} from '../types';

export function createMilkdropCatalogCoordinator({
  catalogStore,
  onCatalogChanged,
}: {
  catalogStore: MilkdropCatalogStore;
  onCatalogChanged: (
    entries: MilkdropCatalogEntry[],
    activePresetId: string,
    activeBackend: MilkdropRenderBackend,
  ) => void;
}) {
  let catalogEntries: MilkdropCatalogEntry[] = [];
  let selectionHistory: string[] = [];
  let selectionCursor = -1;
  let catalogSyncPromise: Promise<void> | null = null;
  let catalogSyncFrameId: number | null = null;

  const syncCatalog = async ({
    activePresetId,
    activeBackend,
  }: {
    activePresetId: string;
    activeBackend: MilkdropRenderBackend;
  }) => {
    catalogEntries = await catalogStore.listPresets();
    onCatalogChanged(catalogEntries, activePresetId, activeBackend);
  };

  const scheduleCatalogSync = (args: {
    activePresetId: string;
    activeBackend: MilkdropRenderBackend;
  }) => {
    if (catalogSyncPromise || catalogSyncFrameId !== null) {
      return catalogSyncPromise ?? Promise.resolve();
    }

    catalogSyncPromise = new Promise((resolve) => {
      catalogSyncFrameId = window.requestAnimationFrame(() => {
        catalogSyncFrameId = null;
        void syncCatalog(args).finally(() => {
          catalogSyncPromise = null;
          resolve();
        });
      });
    });

    return catalogSyncPromise;
  };

  const rememberSelection = async (id: string) => {
    if (selectionHistory[selectionCursor] !== id) {
      selectionHistory = selectionHistory.slice(0, selectionCursor + 1);
      selectionHistory.push(id);
      selectionCursor = selectionHistory.length - 1;
    }
    await catalogStore.recordRecent(id);
    await catalogStore.pushHistory(id);
  };

  const consumePreviousSelection = async () => {
    if (selectionCursor <= 0) {
      const persisted = await catalogStore.getHistory();
      if (persisted.length <= 1) {
        return null;
      }
      selectionHistory = [...persisted].reverse();
      selectionCursor = Math.max(0, selectionHistory.length - 2);
      return persisted[1] ?? null;
    }

    selectionCursor -= 1;
    return selectionHistory[selectionCursor] ?? null;
  };

  return {
    syncCatalog,
    scheduleCatalogSync,
    rememberSelection,
    consumePreviousSelection,
    getCatalogEntries: () => catalogEntries,
    getActiveCatalogEntry: (activePresetId: string) =>
      catalogEntries.find((entry) => entry.id === activePresetId) ?? null,
    dispose() {
      if (catalogSyncFrameId !== null) {
        window.cancelAnimationFrame(catalogSyncFrameId);
        catalogSyncFrameId = null;
      }
      catalogSyncPromise = null;
    },
  };
}

export type MilkdropCatalogCoordinator = ReturnType<
  typeof createMilkdropCatalogCoordinator
>;
