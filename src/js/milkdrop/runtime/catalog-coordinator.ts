import { sortMilkdropCatalogEntries } from '../catalog-sort';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropRenderBackend,
} from '../types';

/** How long to wait for the coalescing frame before flushing anyway. Long
 * enough that a visible tab always coalesces via rAF (~16ms), short enough
 * that a hidden tab's startup is not perceptibly delayed. */
const CATALOG_SYNC_FALLBACK_MS = 250;

const CATALOG_SORT_FIELDS = [
  'isFavorite',
  'historyIndex',
  'lastOpenedAt',
  'rating',
  'curatedRank',
  'title',
] as const satisfies Array<keyof MilkdropCatalogEntry>;

function areCatalogEntriesShallowEqual(
  left: MilkdropCatalogEntry,
  right: MilkdropCatalogEntry,
) {
  const keys = new Set<keyof MilkdropCatalogEntry>([
    ...(Object.keys(left) as Array<keyof MilkdropCatalogEntry>),
    ...(Object.keys(right) as Array<keyof MilkdropCatalogEntry>),
  ]);
  for (const key of keys) {
    if (!Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

function didCatalogSortFieldsChange(
  left: MilkdropCatalogEntry,
  right: MilkdropCatalogEntry,
) {
  return CATALOG_SORT_FIELDS.some(
    (field) => !Object.is(left[field], right[field]),
  );
}

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
  let catalogSyncFallbackTimer: number | null = null;

  /** Cancels whichever of the frame/timer pair did not fire. */
  const clearScheduledFlush = () => {
    if (catalogSyncFrameId !== null) {
      window.cancelAnimationFrame(catalogSyncFrameId);
      catalogSyncFrameId = null;
    }
    if (catalogSyncFallbackTimer !== null) {
      window.clearTimeout(catalogSyncFallbackTimer);
      catalogSyncFallbackTimer = null;
    }
  };
  let catalogSyncQueuedArgs: {
    activePresetId: string;
    activeBackend: MilkdropRenderBackend;
  } | null = null;
  let catalogSyncRunning = false;
  let disposed = false;

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
    const currentIndex = catalogEntries.findIndex((entry) => entry.id === id);
    const currentEntry = catalogEntries[currentIndex];
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
    if (areCatalogEntriesShallowEqual(currentEntry, nextEntry)) {
      return;
    }

    const patchedEntries = catalogEntries.slice();
    patchedEntries[currentIndex] = nextEntry;
    catalogEntries = didCatalogSortFieldsChange(currentEntry, nextEntry)
      ? sortMilkdropCatalogEntries(patchedEntries)
      : patchedEntries;
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
        try {
          await syncCatalog(nextArgs);
        } catch (error) {
          console.warn(
            '[MilkdropCatalogCoordinator] Catalog sync failed, skipping this attempt',
            error,
          );
        }
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
    if (disposed) {
      return Promise.resolve();
    }
    catalogSyncQueuedArgs = args;
    const scheduledSync = ensureCatalogSyncPromise();

    if (catalogSyncFrameId !== null || catalogSyncRunning) {
      return scheduledSync;
    }

    // rAF here is only a coalescing optimization — it batches a burst of sync
    // requests into one flush at the next frame. The work itself needs no
    // frame, and a hidden/backgrounded tab never fires rAF at all, which used
    // to strand this permanently: the catalog stayed empty, the promise this
    // returns never resolved, and the runtime's startup selection (which
    // awaits it) hung forever — so a deep-linked preset never loaded and the
    // stage sat on the bundled boot preset. The frame loop already treats a
    // hidden tab as legitimate in agent mode; this must not contradict that.
    // The timer races the frame: whichever fires first flushes, the other
    // is cancelled.
    const runFlush = () => {
      clearScheduledFlush();
      void flushScheduledCatalogSync();
    };
    catalogSyncFrameId = window.requestAnimationFrame(runFlush);
    catalogSyncFallbackTimer = window.setTimeout(
      runFlush,
      CATALOG_SYNC_FALLBACK_MS,
    );

    return scheduledSync;
  };

  const disposeScheduledCatalogSync = () => {
    clearScheduledFlush();
    catalogSyncQueuedArgs = null;
    finishScheduledCatalogSync();
  };

  const rememberSelection = async (id: string) => {
    if (selectionHistory[selectionCursor] !== id) {
      selectionHistory = selectionHistory.slice(0, selectionCursor + 1);
      selectionHistory.push(id);
      selectionCursor = selectionHistory.length - 1;
    }
    // recordRecent and pushHistory touch different stored records (the
    // preset's own meta vs. the shared history stack) with no read/write
    // dependency between them, so awaiting them sequentially only doubles
    // this step's IndexedDB round-trip latency for no benefit.
    await Promise.all([
      catalogStore.recordRecent(id),
      catalogStore.pushHistory(id),
    ]);
  };

  const consumePreviousSelection = async (activePresetId?: string) => {
    if (selectionCursor > 0) {
      selectionCursor -= 1;
      return selectionHistory[selectionCursor] ?? null;
    }

    const persisted = await catalogStore.getHistory();
    if (persisted.length <= 1) {
      return null;
    }
    const currentIndex = activePresetId
      ? persisted.indexOf(activePresetId)
      : -1;
    const anchor = currentIndex >= 0 ? currentIndex : 0;
    const previousId = persisted[anchor + 1] ?? null;
    if (!previousId) {
      return null;
    }
    selectionHistory = [...persisted].reverse();
    selectionCursor = Math.max(0, selectionHistory.length - anchor - 2);
    return previousId;
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
      disposed = true;
      disposeScheduledCatalogSync();
    },
  };
}

export type MilkdropCatalogCoordinator = ReturnType<
  typeof createMilkdropCatalogCoordinator
>;
