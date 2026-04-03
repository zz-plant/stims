import { sortMilkdropCatalogEntries } from '../catalog-sort';
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
  let resolveCatalogSyncPromise: (() => void) | null = null;
  let catalogSyncFrameId: number | null = null;
  let catalogSyncQueuedArgs: {
    activePresetId: string;
    activeBackend: MilkdropRenderBackend;
  } | null = null;
  let catalogSyncRunning = false;

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

  const patchCatalogEntry = async ({
    id,
    activePresetId,
    activeBackend,
    update,
  }: {
    id: string;
    activePresetId: string;
    activeBackend: MilkdropRenderBackend;
    update:
      | Partial<MilkdropCatalogEntry>
      | ((entry: MilkdropCatalogEntry) => MilkdropCatalogEntry);
  }) => {
    const currentEntry = catalogEntries.find((entry) => entry.id === id);
    if (!currentEntry) {
      await syncCatalog({ activePresetId, activeBackend });
      return;
    }

    const nextEntry =
      typeof update === 'function'
        ? update(currentEntry)
        : { ...currentEntry, ...update };
    if (nextEntry === currentEntry) {
      return;
    }

    catalogEntries = sortMilkdropCatalogEntries(
      catalogEntries.map((entry) => (entry.id === id ? nextEntry : entry)),
    );
    onCatalogChanged(catalogEntries, activePresetId, activeBackend);
  };

  const ensureCatalogSyncPromise = () => {
    if (!catalogSyncPromise) {
      catalogSyncPromise = new Promise<void>((resolve) => {
        resolveCatalogSyncPromise = resolve;
      });
    }
    return catalogSyncPromise;
  };

  const finishScheduledCatalogSync = () => {
    const resolve = resolveCatalogSyncPromise;
    resolveCatalogSyncPromise = null;
    catalogSyncPromise = null;
    resolve?.();
  };

  const flushScheduledCatalogSync = async () => {
    if (catalogSyncRunning) {
      return;
    }

    catalogSyncRunning = true;
    try {
      while (catalogSyncQueuedArgs) {
        const nextArgs = catalogSyncQueuedArgs;
        catalogSyncQueuedArgs = null;
        await syncCatalog(nextArgs);
      }
    } finally {
      catalogSyncRunning = false;
      finishScheduledCatalogSync();
    }
  };

  const scheduleCatalogSync = (args: {
    activePresetId: string;
    activeBackend: MilkdropRenderBackend;
  }) => {
    catalogSyncQueuedArgs = args;
    const scheduledSync = ensureCatalogSyncPromise();

    if (catalogSyncFrameId !== null || catalogSyncRunning) {
      return scheduledSync;
    }

    catalogSyncFrameId = window.requestAnimationFrame(() => {
      catalogSyncFrameId = null;
      void flushScheduledCatalogSync();
    });

    return scheduledSync;
  };

  const disposeScheduledCatalogSync = () => {
    if (catalogSyncFrameId !== null) {
      window.cancelAnimationFrame(catalogSyncFrameId);
      catalogSyncFrameId = null;
    }
    catalogSyncQueuedArgs = null;
    finishScheduledCatalogSync();
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
    patchCatalogEntry,
    rememberSelection,
    consumePreviousSelection,
    getCatalogEntries: () => catalogEntries,
    getCatalogEntry: (id: string) =>
      catalogEntries.find((entry) => entry.id === id) ?? null,
    getActiveCatalogEntry: (activePresetId: string) =>
      catalogEntries.find((entry) => entry.id === activePresetId) ?? null,
    dispose() {
      disposeScheduledCatalogSync();
    },
  };
}

export type MilkdropCatalogCoordinator = ReturnType<
  typeof createMilkdropCatalogCoordinator
>;
