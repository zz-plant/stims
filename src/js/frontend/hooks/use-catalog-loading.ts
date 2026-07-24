import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
} from '../../milkdrop/catalog-types.ts';
import type {
  PresetCatalogEntry,
  PresetCatalogManifest,
} from '../contracts.ts';
import { reportLoadStatus } from '../load-status.ts';
import { mapRuntimeCatalogEntry } from '../workspace-helpers.ts';

const STARTER_CATALOG_URL = '/milkdrop-presets/starter-catalog.json';

async function loadStarterCatalog() {
  const response = await fetch(STARTER_CATALOG_URL);
  if (!response.ok) {
    throw new Error(`Unable to load starter catalog (${response.status}).`);
  }
  const document = (await response.json()) as PresetCatalogManifest;
  return document.presets ?? [];
}

const scheduleBackgroundTask = (callback: () => void) => {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(callback, { timeout: 2500 });
    return () => cancelIdleCallback(handle);
  }

  const handle = setTimeout(callback, 1200);
  return () => clearTimeout(handle);
};

export function useCatalogLoading() {
  const [fallbackCatalog, setFallbackCatalog] = useState<PresetCatalogEntry[]>(
    [],
  );
  const [fallbackCatalogError, setFallbackCatalogError] = useState<
    string | null
  >(null);
  const [fallbackCatalogReady, setFallbackCatalogReady] = useState(false);
  const [activityCatalog, setActivityCatalog] = useState<PresetCatalogEntry[]>(
    [],
  );
  const catalogStoreRef = useRef<MilkdropCatalogStore | null>(null);

  const ensureCatalogStore = useEffectEvent(async () => {
    if (catalogStoreRef.current) {
      return catalogStoreRef.current;
    }

    const { createMilkdropCatalogStore } = await import(
      '../../milkdrop/catalog-store.ts'
    );
    const store = createMilkdropCatalogStore();
    catalogStoreRef.current = store;
    return store;
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

    void loadStarterCatalog()
      .then((presets) => {
        if (cancelled) return;
        setFallbackCatalog(presets);
        setFallbackCatalogReady(true);
        reportLoadStatus('starter-catalog');
      })
      .catch(() => {
        if (cancelled) return;
        setFallbackCatalogReady(false);
      });

    const cancelBackgroundLoad = scheduleBackgroundTask(() => {
      void loadFullCatalog()
        .then((mapped) => {
          if (cancelled) return;
          setFallbackCatalog(mapped);
          setFallbackCatalogReady(true);
          setActivityCatalog(mapped);
          reportLoadStatus('full-catalog');
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
    try {
      const mapped = await loadFullCatalog();
      setFallbackCatalog(mapped);
      setFallbackCatalogReady(true);
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
    hydrateFullCatalogNow,
    refreshCatalogActivity,
    setActivityCatalog,
  };
}
