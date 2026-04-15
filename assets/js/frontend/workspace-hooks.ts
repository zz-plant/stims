import { useRouter } from '@tanstack/react-router';
import {
  type Dispatch,
  type SetStateAction,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import {
  getActiveMotionPreference,
  subscribeToMotionPreference,
} from '../core/motion-preferences.ts';
import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  QUALITY_STORAGE_KEY,
  setQualityPresetById,
  subscribeToQualityPreset,
} from '../core/settings-panel.ts';
import {
  getActiveRenderPreferences,
  subscribeToRenderPreferences,
} from '../core/state/render-preference-store.ts';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
} from '../milkdrop/catalog-types.ts';
import { resolvePresetId } from '../milkdrop/preset-id-resolution.ts';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type {
  LaunchIntent,
  PresetCatalogEntry,
  PresetCatalogManifest,
  SessionRouteState,
} from './contracts.ts';
import type {
  EngineSnapshot,
  MilkdropEngineAdapter,
} from './engine/milkdrop-engine-adapter.ts';
import {
  buildSessionRouteSearch,
  readSessionRouteState,
  readSessionRouteStateFromSearch,
} from './url-state.ts';
import {
  buildLaunchIntent,
  mapRuntimeCatalogEntry,
} from './workspace-helpers.ts';
import { useWorkspaceReadiness } from './workspace-readiness.ts';
import { useWorkspaceToast } from './workspace-toast.ts';
import { useWorkspaceYouTubePreview } from './workspace-youtube-preview.ts';

function syncStageCanvasStyle(stage: HTMLDivElement | null) {
  const canvas = stage?.querySelector('canvas');
  if (
    !canvas ||
    typeof canvas !== 'object' ||
    !('style' in canvas) ||
    !('tagName' in canvas) ||
    canvas.tagName !== 'CANVAS'
  ) {
    return;
  }

  if (canvas.style.display !== 'block') {
    canvas.style.display = 'block';
  }
  if (canvas.style.width !== '100%') {
    canvas.style.width = '100%';
  }
  if (canvas.style.height !== '100%') {
    canvas.style.height = '100%';
  }
  if (canvas.style.maxWidth !== 'none') {
    canvas.style.maxWidth = 'none';
  }
  if (canvas.style.maxHeight !== 'none') {
    canvas.style.maxHeight = 'none';
  }
}

export function useWorkspaceRouteState() {
  const router = useRouter();
  const [routeState, setRouteState] = useState<SessionRouteState>(() =>
    readSessionRouteStateFromSearch(router.state.location.search),
  );

  useEffect(() => {
    const nextSearch = buildSessionRouteSearch(
      routeState,
      router.state.location.search,
    );
    // The router validates these raw query params back into SessionRouteState.
    const nextSearchInput = nextSearch as never;
    const nextLocation = router.buildLocation({
      to: '/',
      hash: router.state.location.hash,
      search: nextSearchInput,
    });
    if (nextLocation.href === router.state.location.href) {
      return;
    }

    void router.navigate({
      to: '/',
      hash: router.state.location.hash,
      replace: true,
      search: nextSearchInput,
    });
  }, [routeState, router]);

  useEffect(() => {
    const unsubscribe = router.history.subscribe(({ location }) => {
      startTransition(() => {
        setRouteState(readSessionRouteState(location.href));
      });
    });

    return () => {
      unsubscribe();
    };
  }, [router]);

  const commitRoute = (nextState: SessionRouteState) => {
    setRouteState(nextState);
  };

  return {
    commitRoute,
    routeState,
    setRouteState,
  };
}

export function useWorkspaceSessionState({
  routeState,
  setRouteState,
}: {
  routeState: SessionRouteState;
  setRouteState: Dispatch<SetStateAction<SessionRouteState>>;
}) {
  const [engineSnapshot, setEngineSnapshot] = useState<EngineSnapshot | null>(
    null,
  );
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
  const [engineAdapterReady, setEngineAdapterReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [qualityPreset, setQualityPresetState] = useState(() =>
    getActiveQualityPreset({ storageKey: QUALITY_STORAGE_KEY }),
  );
  const [renderPreferences, setRenderPreferencesState] = useState(() =>
    getActiveRenderPreferences(),
  );
  const [motionPreference, setMotionPreferenceState] = useState(() =>
    getActiveMotionPreference(),
  );
  const [showExtendedSources, setShowExtendedSources] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [presetPreviews, setPresetPreviews] = useState<
    Record<string, MilkdropPresetRenderPreview>
  >({});
  const deferredSearch = useDeferredValue(searchQuery);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MilkdropEngineAdapter | null>(null);
  const catalogStoreRef = useRef<MilkdropCatalogStore | null>(null);
  const sessionDisposedRef = useRef(false);
  const engineAdapterPromiseRef = useRef<Promise<MilkdropEngineAdapter> | null>(
    null,
  );
  const engineUnsubscribeRef = useRef<(() => void) | null>(null);
  const previewServiceRef = useRef<{
    dispose: () => void;
    refreshPreviews: (presetIds: string[]) => void;
    requestPreviews: (presetIds: string[]) => void;
  } | null>(null);
  const pendingPresetIdRef = useRef<string | null>(null);
  const initialLaunchIntentRef = useRef(buildLaunchIntent(routeState));
  const readinessItems = useWorkspaceReadiness();
  const {
    loadYouTubePreview,
    youtubePreviewRef,
    youtubeReady,
    youtubeUrl,
    setYoutubeUrl,
  } = useWorkspaceYouTubePreview({
    setStatusMessage,
  });
  const { toast, dismissToast } = useWorkspaceToast({
    engineSnapshot,
    routeState,
    statusMessage,
  });

  const ensureCatalogStore = useEffectEvent(async () => {
    if (catalogStoreRef.current) {
      return catalogStoreRef.current;
    }

    const { createMilkdropCatalogStore } = await import(
      '../milkdrop/catalog-store.ts'
    );
    const store = createMilkdropCatalogStore();
    catalogStoreRef.current = store;
    return store;
  });

  const refreshCatalogActivity = useEffectEvent(async () => {
    try {
      const store = await ensureCatalogStore();
      const entries = await store.listPresets();
      setActivityCatalog(
        entries.map((entry: MilkdropCatalogEntry) =>
          mapRuntimeCatalogEntry(entry),
        ),
      );
    } catch (_error) {
      setActivityCatalog([]);
    }
  });

  const ensureEngineAdapter = useEffectEvent(async () => {
    if (engineRef.current) {
      return engineRef.current;
    }

    if (!engineAdapterPromiseRef.current) {
      engineAdapterPromiseRef.current = import(
        './engine/milkdrop-engine-adapter.ts'
      )
        .then(({ createMilkdropEngineAdapter }) => {
          const adapter = createMilkdropEngineAdapter();
          if (sessionDisposedRef.current) {
            adapter.dispose();
            throw new Error('Visualizer session has already been disposed.');
          }
          engineRef.current = adapter;
          engineUnsubscribeRef.current = adapter.subscribe((snapshot) => {
            setEngineSnapshot(snapshot);
          });
          setEngineAdapterReady(true);
          return adapter;
        })
        .catch((error) => {
          engineAdapterPromiseRef.current = null;
          throw error;
        });
    }

    return engineAdapterPromiseRef.current;
  });

  const ensurePresetPreviewService = useEffectEvent(async () => {
    if (previewServiceRef.current) {
      return previewServiceRef.current;
    }

    const [
      { createMilkdropPresetPreviewService },
      { createMilkdropEngineAdapter },
    ] = await Promise.all([
      import('../milkdrop/runtime/preset-preview-service.ts'),
      import('./engine/milkdrop-engine-adapter.ts'),
    ]);

    previewServiceRef.current = createMilkdropPresetPreviewService({
      capturePreview: async (presetId) => {
        if (typeof document === 'undefined') {
          throw new Error('Preset previews require a browser document.');
        }

        const previewHost = document.createElement('div');
        previewHost.className = 'stims-shell__preset-preview-host';
        previewHost.setAttribute('aria-hidden', 'true');
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = 360;
        previewCanvas.height = 203;
        previewCanvas.className = 'stims-shell__preset-preview-host-canvas';
        previewHost.appendChild(previewCanvas);
        document.body.appendChild(previewHost);

        let lastBackend: EngineSnapshot['backend'] = null;
        const adapter = createMilkdropEngineAdapter();
        const unsubscribe = adapter.subscribe((snapshot: EngineSnapshot) => {
          lastBackend = snapshot.backend;
        });

        try {
          await adapter.mount(previewHost, {
            presetId,
            collectionTag: null,
            panel: 'browse',
            audioSource: null,
            agentMode: true,
            previewMode: true,
          });
          await adapter.loadPreset(presetId);
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 750);
          });

          const canvas = previewHost.querySelector('canvas') ?? previewCanvas;
          if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Preview canvas was not available.');
          }

          return {
            imageUrl: canvas.toDataURL('image/webp', 0.82),
            actualBackend: lastBackend,
            updatedAt: Date.now(),
            error: null,
            source: 'runtime-snapshot' as const,
          };
        } finally {
          unsubscribe();
          adapter.dispose();
          previewHost.remove();
        }
      },
      onPreviewChanged: (preview) => {
        setPresetPreviews((current) => ({
          ...current,
          [preview.presetId]: preview,
        }));
      },
    });

    return previewServiceRef.current;
  });

  const ensureEngineMounted = useEffectEvent(
    async (launchIntent: LaunchIntent = initialLaunchIntentRef.current) => {
      const stage = stageRef.current;
      if (!stage) {
        throw new Error('Visualizer stage is not ready yet.');
      }

      const adapter = await ensureEngineAdapter();
      if (adapter.isMounted()) {
        return adapter;
      }

      await adapter.mount(stage, launchIntent);
      return adapter;
    },
  );

  useEffect(() => {
    const stage = stageRef.current;
    syncStageCanvasStyle(stage);
    if (!stage || typeof MutationObserver !== 'function') {
      return;
    }

    const observer = new MutationObserver(() => {
      syncStageCanvasStyle(stage);
    });

    observer.observe(stage, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    sessionDisposedRef.current = false;
    let cancelled = false;

    void ensureEngineAdapter()
      .then(() => {
        if (cancelled) {
          return;
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Unable to load the visualizer runtime.',
        );
      });

    return () => {
      cancelled = true;
      sessionDisposedRef.current = true;
      previewServiceRef.current?.dispose();
      previewServiceRef.current = null;
      engineUnsubscribeRef.current?.();
      engineUnsubscribeRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
      engineAdapterPromiseRef.current = null;
      setEngineAdapterReady(false);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToQualityPreset((preset) => {
      setQualityPresetState(preset);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRenderPreferences((preferences) => {
      setRenderPreferencesState(preferences);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToMotionPreference((preference) => {
      setMotionPreferenceState(preference);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFallbackCatalogError(null);
    setFallbackCatalogReady(false);

    void fetch('/milkdrop-presets/catalog.json')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Catalog request failed with ${response.status}`);
        }
        const manifest = (await response.json()) as PresetCatalogManifest;
        if (cancelled) {
          return;
        }
        setFallbackCatalog(manifest.presets ?? []);
        setFallbackCatalogReady(true);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setFallbackCatalogError(
          error instanceof Error ? error.message : 'Unable to load catalog.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void ensureCatalogStore()
      .then((store) => store.listPresets())
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setActivityCatalog(
          entries.map((entry: MilkdropCatalogEntry) =>
            mapRuntimeCatalogEntry(entry),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setActivityCatalog([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!engineRef.current?.isMounted()) {
      initialLaunchIntentRef.current = buildLaunchIntent(routeState);
    }
  }, [routeState]);

  useEffect(() => {
    if (
      !engineAdapterReady ||
      routeState.invalidExperienceSlug ||
      engineSnapshot?.runtimeReady ||
      (routeState.audioSource !== 'demo' &&
        routeState.panel !== 'editor' &&
        routeState.panel !== 'inspector')
    ) {
      return;
    }

    const launchIntent = buildLaunchIntent(routeState);
    initialLaunchIntentRef.current = launchIntent;
    void ensureEngineMounted(launchIntent).catch((error) => {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Unable to start the visualizer runtime.',
      );
    });
  }, [
    engineAdapterReady,
    engineSnapshot?.runtimeReady,
    routeState,
    routeState.audioSource,
    routeState.invalidExperienceSlug,
    routeState.panel,
  ]);

  useEffect(() => {
    if (!engineSnapshot?.activePresetId) {
      return;
    }

    void refreshCatalogActivity();

    const shareableActivePresetId = resolvePresetId(
      engineSnapshot.catalogEntries,
      engineSnapshot.activePresetId,
    );
    if (!shareableActivePresetId) {
      return;
    }

    if (pendingPresetIdRef.current) {
      if (shareableActivePresetId === pendingPresetIdRef.current) {
        pendingPresetIdRef.current = null;
      }
      return;
    }

    if (routeState.presetId === shareableActivePresetId) {
      return;
    }

    startTransition(() => {
      setRouteState((current) => ({
        ...current,
        presetId: shareableActivePresetId,
      }));
    });
  }, [
    engineSnapshot?.activePresetId,
    engineSnapshot?.catalogEntries,
    routeState.presetId,
    setRouteState,
  ]);

  useEffect(() => {
    if (!routeState.presetId || routeState.invalidExperienceSlug) {
      return;
    }

    const resolvedPresetId = resolvePresetId(
      engineSnapshot?.catalogEntries ?? [],
      routeState.presetId,
    );
    if (!resolvedPresetId || resolvedPresetId === routeState.presetId) {
      return;
    }

    startTransition(() => {
      setRouteState((current) => {
        if (current.presetId !== routeState.presetId) {
          return current;
        }

        return {
          ...current,
          presetId: resolvedPresetId,
        };
      });
    });
  }, [
    engineSnapshot?.catalogEntries,
    routeState.invalidExperienceSlug,
    routeState.presetId,
    setRouteState,
  ]);

  useEffect(() => {
    if (!engineRef.current?.isMounted()) {
      return;
    }

    if (routeState.panel === 'editor' || routeState.panel === 'inspector') {
      engineRef.current.openTool(routeState.panel);
      return;
    }

    engineRef.current.setOverlayOpen(false);
  }, [routeState.panel]);

  useEffect(() => {
    if (!engineRef.current?.isMounted() || !routeState.collectionTag) {
      return;
    }

    engineRef.current.setCollectionTag(routeState.collectionTag);
  }, [routeState.collectionTag]);

  useEffect(() => {
    const requestedPresetId = routeState.presetId
      ? (resolvePresetId(
          engineSnapshot?.catalogEntries ?? [],
          routeState.presetId,
        ) ?? routeState.presetId)
      : null;

    if (
      !engineRef.current?.isMounted() ||
      !requestedPresetId ||
      requestedPresetId === engineSnapshot?.activePresetId
    ) {
      if (requestedPresetId === engineSnapshot?.activePresetId) {
        pendingPresetIdRef.current = null;
      }
      return;
    }

    pendingPresetIdRef.current = requestedPresetId;
    void engineRef.current.loadPreset(requestedPresetId).catch(() => {
      if (pendingPresetIdRef.current === requestedPresetId) {
        pendingPresetIdRef.current = null;
      }
    });
  }, [
    engineSnapshot?.activePresetId,
    engineSnapshot?.catalogEntries,
    routeState.presetId,
  ]);

  useEffect(() => {
    if (
      !engineRef.current?.isMounted() ||
      routeState.audioSource !== 'demo' ||
      engineSnapshot?.audioActive
    ) {
      return;
    }

    void engineRef.current.setAudioSource({ source: 'demo' }).catch((error) => {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to start demo audio.',
      );
    });
  }, [engineSnapshot?.audioActive, routeState.audioSource]);

  useEffect(() => {
    const liveSession =
      engineSnapshot?.audioActive ||
      document.body.dataset.audioActive === 'true';
    document.documentElement.dataset.focusedSession = liveSession
      ? 'live'
      : 'launch';
    if (routeState.agentMode) {
      document.documentElement.dataset.agentMode = 'true';
    } else {
      delete document.documentElement.dataset.agentMode;
    }
  }, [engineSnapshot?.audioActive, routeState.agentMode]);

  return {
    deferredSearch,
    dismissToast,
    engineAdapterReady,
    engineSnapshot,
    exportPreset: () => {
      engineRef.current?.exportPreset();
    },
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    activityCatalog,
    importPresetFiles: async (files: FileList | null) => {
      if (!files?.length) {
        return;
      }
      const adapter = await ensureEngineMounted();
      await adapter.importPreset(files);
    },
    loadYouTubePreview,
    motionPreference,
    pendingPresetIdRef,
    qualityPreset,
    readinessItems,
    refreshCatalogActivity,
    renderPreferences,
    searchQuery,
    presetPreviews,
    setQualityPreset: (presetId: string) => {
      if (engineRef.current?.isMounted()) {
        engineRef.current.setQualityPreset(presetId);
        return;
      }
      setQualityPresetById(presetId, {
        presets: DEFAULT_QUALITY_PRESETS,
        storageKey: QUALITY_STORAGE_KEY,
      });
    },
    setSearchQuery,
    setShowExtendedSources,
    setStatusMessage,
    setYoutubeUrl,
    showExtendedSources,
    stageRef,
    refreshPresetPreviews: async (presetIds: string[]) => {
      const service = await ensurePresetPreviewService();
      service.refreshPreviews(presetIds);
    },
    startAudioSource: async (request: {
      cropTarget?: HTMLElement | null;
      launchState?: SessionRouteState;
      source: 'demo' | 'microphone' | 'tab' | 'youtube';
      stream?: MediaStream;
    }) => {
      const launchIntent = buildLaunchIntent(request.launchState ?? routeState);
      initialLaunchIntentRef.current = launchIntent;
      const adapter = await ensureEngineMounted(launchIntent);

      if (request.source === 'demo' || request.source === 'microphone') {
        await adapter.setAudioSource({
          source: request.source,
        });
        return;
      }

      if (!request.stream) {
        throw new Error('A captured media stream is required for tab audio.');
      }

      await adapter.setAudioSource({
        source: request.source,
        stream: request.stream,
        cropTarget: request.cropTarget,
      });
    },
    statusMessage,
    toast,
    toggleFavoritePreset: async (presetId: string, favorite: boolean) => {
      const store = await ensureCatalogStore();
      await store.setFavorite(presetId, favorite);
      await refreshCatalogActivity();
    },
    toggleExtendedSources: () => setShowExtendedSources((current) => !current),
    requestPresetPreviews: async (presetIds: string[]) => {
      const service = await ensurePresetPreviewService();
      service.requestPreviews(presetIds);
    },
    youtubePreviewRef,
    youtubeReady,
    youtubeUrl,
  };
}
