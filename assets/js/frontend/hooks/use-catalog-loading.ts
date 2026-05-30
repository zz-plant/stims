import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
} from '../../milkdrop/catalog-types.ts';
import type { PresetCatalogEntry } from '../contracts.ts';
import { mapRuntimeCatalogEntry } from '../workspace-helpers.ts';

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

  useEffect(() => {
    let cancelled = false;
    setFallbackCatalogError(null);
    setFallbackCatalogReady(false);

    void ensureCatalogStore()
      .then((store) => store.listPresets())
      .then((entries) => {
        if (cancelled) return;
        const mapped = entries.map((entry: MilkdropCatalogEntry) =>
          mapRuntimeCatalogEntry(entry),
        );
        setFallbackCatalog(mapped);
        setFallbackCatalogReady(true);
        setActivityCatalog(mapped);
      })
      .catch((error) => {
        if (cancelled) return;
        setFallbackCatalogError(
          error instanceof Error ? error.message : 'Unable to load catalog.',
        );
        setActivityCatalog([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    activityCatalog,
    catalogStoreRef,
    ensureCatalogStore,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    refreshCatalogActivity,
    setActivityCatalog,
  };
}
