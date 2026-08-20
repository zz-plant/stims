import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { isAgentMode } from '../../core/url-params.ts';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
} from '../../milkdrop/catalog-types.ts';
import { scheduleIdleTask } from '../../utils/browser/idle-task.ts';
import type { PresetCatalogEntry } from '../contracts.ts';
import { reportLoadStatus } from '../load-status.ts';
import { mapRuntimeCatalogEntry } from '../workspace-helpers.ts';

const STARTER_CATALOG_URL = '/milkdrop-presets/starter-catalog.json';

async function loadStarterCatalog(): Promise<PresetCatalogEntry[]> {
  // Check if a catalog fetch was already initiated from app.ts; if so, use it.
  // This avoids a duplicate network request when the promise is hoisted up
  // from the module entry point.
  const globalPromise =
    typeof globalThis !== 'undefined'
      ? (
          globalThis as unknown as {
            __stimsStarterCatalogPromise?: Promise<unknown>;
          }
        ).__stimsStarterCatalogPromise
      : undefined;

  let document: unknown;
  if (globalPromise) {
    document = await globalPromise;
  } else {
    const response = await fetch(STARTER_CATALOG_URL);
    if (!response.ok) {
      throw new Error(`Unable to load starter catalog (${response.status}).`);
    }
    document = await response.json();
  }

  return (
    (document as { presets: PresetCatalogEntry[] | undefined } | null)
      ?.presets ?? []
  );
}

const scheduleBackgroundTask = (callback: () => void) =>
  scheduleIdleTask(callback, { idleTimeout: 2500, fallbackDelay: 1200 });

export function useCatalogLoading() {
  const [fallbackCatalog, setFallbackCatalog] = useState<PresetCatalogEntry[]>(
    [],
  );
  const [fallbackCatalogError, setFallbackCatalogError] = useState<
    string | null
  >(null);
  const [fallbackCatalogReady, setFallbackCatalogReady] = useState(false);
  const [fullCatalogReady, setFullCatalogReady] = useState(false);
  const [activityCatalog, setActivityCatalog] = useState<PresetCatalogEntry[]>(
    [],
  );
  const catalogStoreRef = useRef<MilkdropCatalogStore | null>(null);
  const catalogStorePromiseRef = useRef<Promise<MilkdropCatalogStore> | null>(
    null,
  );

  // Cache the in-flight promise, not just the resolved store. Three callers
  // race here (the background load, hydrateFullCatalogNow and
  // refreshCatalogActivity); checking only `catalogStoreRef.current` let all
  // of them pass the guard during the `await import(...)` and build a store
  // each. Every store carries its own bundled-catalog cache, so that meant
  // three full fetch+parse passes over the 1.5MB catalog.json — measured at
  // ~4.7MB decoded on a cold mobile load.
  const ensureCatalogStore = useEffectEvent(async () => {
    if (catalogStorePromiseRef.current) {
      return catalogStorePromiseRef.current;
    }

    const promise = import('../../milkdrop/catalog-store.ts').then(
      ({ createMilkdropCatalogStore }) => {
        const store = createMilkdropCatalogStore();
        catalogStoreRef.current = store;
        return store;
      },
    );

    // Do not strand every future caller on a transient import failure.
    catalogStorePromiseRef.current = promise;
    promise.catch(() => {
      if (catalogStorePromiseRef.current === promise) {
        catalogStorePromiseRef.current = null;
      }
    });

    return promise;
  });

  const refreshCatalogActivity = useEffectEvent(async () => {
    try {
      const store = await ensureCatalogStore();
      const entries = await store.listPresets();
      const mapped = entries.map((entry: MilkdropCatalogEntry) =>
        mapRuntimeCatalogEntry(entry),
      );
      setActivityCatalog(mapped);
    } catch (_error) {
      setActivityCatalog([]);
    }
  });

  const loadFullCatalog = useEffectEvent(async () => {
    const store = await ensureCatalogStore();
    const entries = await store.listPresets();
    return entries.map((entry: MilkdropCatalogEntry) =>
      mapRuntimeCatalogEntry(entry),
    );
  });

  useEffect(() => {
    let cancelled = false;
    setFallbackCatalogError(null);
    setFallbackCatalogReady(false);
    setFullCatalogReady(false);

    void loadStarterCatalog()
      .then((presets: PresetCatalogEntry[]) => {
        if (cancelled) return;
        setFallbackCatalog(presets);
        setFallbackCatalogReady(true);
        reportLoadStatus('starter-catalog');
      })
      .catch((error) => {
        if (cancelled) return;
        setFallbackCatalogReady(false);
        // Surface the failure instead of leaving the UI in a permanent
        // "loading" state; the background full-catalog load clears it if it
        // succeeds.
        setFallbackCatalogError(
          error instanceof Error ? error.message : 'Unable to load catalog.',
        );
      });

    const cancelBackgroundLoad = scheduleBackgroundTask(() => {
      void loadFullCatalog()
        .then((mapped) => {
          if (cancelled) return;
          setFallbackCatalog(mapped);
          setFallbackCatalogError(null);
          setFallbackCatalogReady(true);
          setFullCatalogReady(true);
          setActivityCatalog(mapped);
          reportLoadStatus('full-catalog');

          // Agent sessions load one preset and never browse the warm cache,
          // and even the idle-paced prefetch competes with SwiftShader
          // rendering on starved CI runners — skip the warm-up entirely so
          // automation stays deterministic.
          if (!isAgentMode()) {
            void ensureCatalogStore().then((store) => {
              void store
                .prefetchCompiledPresets()
                .then(() => {
                  if (cancelled) return;
                  void refreshCatalogActivity();
                })
                .catch(() => {});
            });
          }
        })
        .catch((error) => {
          if (cancelled) return;
          setFallbackCatalogError(
            error instanceof Error ? error.message : 'Unable to load catalog.',
          );
          setActivityCatalog([]);
        });
    });

    return () => {
      cancelled = true;
      cancelBackgroundLoad();
    };
  }, []);

  const hydrateFullCatalogNow = useEffectEvent(async () => {
    // Idempotent once the full catalog has landed. Callers re-invoke this from
    // effects that depend on the catalog arrays this function replaces (e.g.
    // the deep-link hydration effect in workspace-hooks.ts keys on
    // `fallbackCatalog`); every pass builds fresh array identities, so without
    // this guard an id the full catalog still cannot resolve re-triggers those
    // effects forever — a render loop that pinned a core at ~50 commits/sec.
    if (fullCatalogReady) {
      return;
    }
    try {
      const mapped = await loadFullCatalog();
      setFallbackCatalog(mapped);
      setFallbackCatalogError(null);
      setFallbackCatalogReady(true);
      setFullCatalogReady(true);
      setActivityCatalog(mapped);
      reportLoadStatus('full-catalog');
    } catch (error) {
      setFallbackCatalogError(
        error instanceof Error ? error.message : 'Unable to load catalog.',
      );
      setActivityCatalog([]);
    }
  });

  return {
    activityCatalog,
    catalogStoreRef,
    ensureCatalogStore,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    fullCatalogReady,
    hydrateFullCatalogNow,
    refreshCatalogActivity,
    setActivityCatalog,
  };
}
