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
import { createLogger } from '../core/logger.ts';
import {
  DEFAULT_QUALITY_PRESETS,
  QUALITY_STORAGE_KEY,
  setQualityPresetById,
} from '../core/settings-panel.ts';
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
import { useAudioSourceSync } from './hooks/use-audio-source-sync.ts';
import { useDocumentDatasetSync } from './hooks/use-document-dataset-sync.ts';
import { usePresetRouteSync } from './hooks/use-preset-route-sync.ts';
import { useStageCanvasSync } from './hooks/use-stage-canvas-sync.ts';
import { useStoreSubscriptions } from './hooks/use-store-subscriptions.ts';
import {
  readPersistedSession,
  writePersistedSession,
} from './session-persistence.ts';
import {
  buildSessionRouteSearch,
  parsePlainSearch,
  readSessionRouteState,
  stringifyPlainSearch,
} from './url-state.ts';
import {
  buildLaunchIntent,
  mapRuntimeCatalogEntry,
} from './workspace-helpers.ts';

import { useWorkspaceReadiness } from './workspace-readiness.ts';
import { useWorkspaceToast } from './workspace-toast.ts';
import { useWorkspaceYouTubePreview } from './workspace-youtube-preview.ts';
import { createLazyFactory } from './use-lazy-factory.ts';

const log = createLogger('WorkspaceHooks');
const PREVIEW_SETTLE_MS = 750;

export function useWorkspaceRouteState() {
  const [routeState, setRouteState] = useState<SessionRouteState>(() =>
    readSessionRouteState(),
  );

  useEffect(() => {
    const currentSearch = parsePlainSearch(window.location.search);
    const nextSearch = buildSessionRouteSearch(routeState, currentSearch);
    const serialized = stringifyPlainSearch(nextSearch);
    const current = window.location.search;
    if (serialized === current) {
      return;
    }

    const hash = window.location.hash;
    const newUrl = hash ? `${serialized}${hash}` : serialized;
    window.history.replaceState(null, '', newUrl);
  }, [routeState]);

  useEffect(() => {
    const onPopState = () => {
      startTransition(() => {
        setRouteState(readSessionRouteState());
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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
  const { motionPreference, qualityPreset, renderPreferences } =
    useStoreSubscriptions();
  const [showExtendedSources, setShowExtendedSources] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [presetPreviews, setPresetPreviews] = useState<
    Record<string, MilkdropPresetRenderPreview>
  >({});
  const deferredSearch = useDeferredValue(searchQuery);
  const sessionRestoredRef = useRef(false);
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
  const previewServicePromiseRef = useRef<Promise<{
    dispose: () => void;
    refreshPreviews: (presetIds: string[]) => void;
    requestPreviews: (presetIds: string[]) => void;
  }> | null>(null);
  const pendingPresetIdRef = useRef<string | null>(null);
  const initialLaunchIntentRef = useRef(buildLaunchIntent(routeState));
  const readinessItems = useWorkspaceReadiness();
  const {
    handleYoutubeUrlKeyDown,
    loadRecentYouTubeVideo,
    loadYouTubePreview,
    recentYouTubeVideos,
    youtubeCanLoad,
    youtubeFeedback,
    youtubeInputInvalid,
    youtubeLoading,
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

  const ensureEngineAdapter = useEffectEvent(
    createLazyFactory({
      name: 'EngineAdapter',
      factory: () =>
        import('./engine/milkdrop-engine-adapter.ts').then(
          ({ createMilkdropEngineAdapter }) => {
            const adapter = createMilkdropEngineAdapter();
            engineUnsubscribeRef.current = adapter.subscribe((snapshot) => {
              setEngineSnapshot(snapshot);
            });
            setEngineAdapterReady(true);
            return adapter;
          },
        ),
      getRef: () => engineRef.current,
      setRef: (adapter) => {
        engineRef.current = adapter;
      },
      getPromiseRef: () => engineAdapterPromiseRef.current,
      setPromiseRef: (p) => {
        engineAdapterPromiseRef.current = p;
      },
      cleanup: (adapter) => adapter.dispose(),
      isDisposed: () => sessionDisposedRef.current,
    }),
  );

  const ensurePresetPreviewService = useEffectEvent(async () => {
    if (previewServiceRef.current) {
      return previewServiceRef.current;
    }

    if (!previewServicePromiseRef.current) {
      previewServicePromiseRef.current = Promise.all([
        import('../milkdrop/runtime/preset-preview-service.ts'),
        import('./engine/milkdrop-engine-adapter.ts'),
      ])
        .then(
          async ([
            { createMilkdropPresetPreviewService },
            { createMilkdropEngineAdapter },
          ]) => {
            const previewHost = document.createElement('div');
            previewHost.className = 'stims-shell__preset-preview-host';
            previewHost.setAttribute('aria-hidden', 'true');
            document.body.appendChild(previewHost);

            const previewAdapter = createMilkdropEngineAdapter();
            let previewBackend: EngineSnapshot['backend'] = null;
            const unsubPreview = previewAdapter.subscribe((snap) => {
              previewBackend = snap.backend;
            });
            await previewAdapter.mount(previewHost, {
              presetId: null,
              collectionTag: null,
              panel: 'browse',
              audioSource: null,
              agentMode: true,
              previewMode: true,
            });

            const service = createMilkdropPresetPreviewService({
              capturePreview: async (presetId) => {
                previewBackend = null;
                await previewAdapter.loadPreset(presetId);
                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, PREVIEW_SETTLE_MS);
                });

                const canvas = previewHost.querySelector('canvas');
                if (!(canvas instanceof HTMLCanvasElement)) {
                  throw new Error('Preview canvas was not available.');
                }

                return {
                  imageUrl: canvas.toDataURL('image/webp', 0.82),
                  actualBackend: previewBackend,
                  updatedAt: Date.now(),
                  error: null,
                  source: 'runtime-snapshot' as const,
                };
              },
              onPreviewChanged: (preview) => {
                setPresetPreviews((current) => ({
                  ...current,
                  [preview.presetId]: preview,
                }));
              },
            });

            const initialDispose = service.dispose.bind(service);
            service.dispose = () => {
              initialDispose();
              unsubPreview();
              previewAdapter.dispose();
              previewHost.remove();
            };

            if (sessionDisposedRef.current) {
              service.dispose();
              throw new Error('Visualizer session has already been disposed.');
            }

            previewServiceRef.current = service;
            return service;
          },
        )
        .catch((error) => {
          previewServicePromiseRef.current = null;
          throw error;
        });
    }

    return previewServicePromiseRef.current;
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

  useStageCanvasSync(stageRef);

  useEffect(() => {
    sessionDisposedRef.current = false;

    return () => {
      sessionDisposedRef.current = true;
      previewServiceRef.current?.dispose();
      previewServiceRef.current = null;
      previewServicePromiseRef.current = null;
      engineUnsubscribeRef.current?.();
      engineUnsubscribeRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
      engineAdapterPromiseRef.current = null;
      setEngineAdapterReady(false);
    };
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
    engineSnapshot?.runtimeReady,
    routeState,
    routeState.audioSource,
    routeState.invalidExperienceSlug,
    routeState.panel,
  ]);

  useEffect(() => {
    if (!routeState.panel || !engineSnapshot?.runtimeReady) {
      return;
    }
    void refreshCatalogActivity();
  }, [routeState.panel, engineSnapshot?.runtimeReady]);

  usePresetRouteSync({
    engineSnapshot,
    pendingPresetIdRef,
    routeState,
    setRouteState,
  });

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
    const routePresetId = routeState.presetId;
    const requestedPresetId = routePresetId
      ? (resolvePresetId(engineSnapshot?.catalogEntries ?? [], routePresetId) ??
        routePresetId)
      : null;

    if (!engineRef.current?.isMounted()) {
      if (requestedPresetId) {
        log.log(`engine not mounted, deferring preset ${requestedPresetId}`);
      }
      return;
    }

    if (!requestedPresetId) {
      return;
    }

    if (requestedPresetId === engineSnapshot?.activePresetId) {
      pendingPresetIdRef.current = null;
      return;
    }

    pendingPresetIdRef.current = requestedPresetId;
    log.log(
      `requesting ${requestedPresetId} (active: ${engineSnapshot?.activePresetId ?? 'none'})`,
    );
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      if (pendingPresetIdRef.current === requestedPresetId) {
        pendingPresetIdRef.current = null;
        setStatusMessage(
          `Preset "${requestedPresetId}" took too long to load. Try again.`,
        );
      }
    }, 10_000);

    void engineRef.current.loadPreset(requestedPresetId).then(
      () => {
        clearTimeout(timeoutId);
        if (timedOut) return;
        log.log(`loaded ${requestedPresetId}`);
        if (pendingPresetIdRef.current === requestedPresetId) {
          pendingPresetIdRef.current = null;
        }
      },
      () => {
        clearTimeout(timeoutId);
        if (timedOut) return;
        log.warn(`failed to load ${requestedPresetId}`);
        if (pendingPresetIdRef.current === requestedPresetId) {
          pendingPresetIdRef.current = null;
          setStatusMessage(
            `Failed to load preset. "${requestedPresetId}" may be unavailable.`,
          );
        }
      },
    );
  }, [
    engineSnapshot?.activePresetId,
    engineSnapshot?.catalogEntries,
    routeState.presetId,
  ]);

  useAudioSourceSync({
    engineRef,
    engineSnapshot,
    routeState,
    setStatusMessage,
  });

  useDocumentDatasetSync({
    audioActive: engineSnapshot?.audioActive,
    agentMode: routeState.agentMode,
  });

  useEffect(() => {
    if (sessionRestoredRef.current) {
      return;
    }

    const audioActive =
      engineSnapshot?.audioActive ||
      document.body.dataset.audioActive === 'true';
    if (routeState.audioSource || audioActive) {
      return;
    }

    const persisted = readPersistedSession();
    if (!persisted) {
      sessionRestoredRef.current = true;
      return;
    }

    sessionRestoredRef.current = true;
    startTransition(() => {
      setRouteState((current) => ({
        ...current,
        audioSource: persisted.audioSource
          ? (persisted.audioSource as SessionRouteState['audioSource'])
          : current.audioSource,
        presetId: current.presetId ?? persisted.presetId ?? current.presetId,
        collectionTag:
          current.collectionTag ??
          persisted.collectionTag ??
          current.collectionTag,
        panel:
          current.panel ??
          (persisted.panel as SessionRouteState['panel']) ??
          current.panel,
      }));
    });
  }, [engineSnapshot?.audioActive, routeState.audioSource, setRouteState]);

  useEffect(() => {
    writePersistedSession({
      audioSource: routeState.audioSource,
      presetId: routeState.presetId,
      collectionTag: routeState.collectionTag,
      panel: routeState.panel,
    });
  }, [
    routeState.audioSource,
    routeState.presetId,
    routeState.collectionTag,
    routeState.panel,
  ]);

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
    handleYoutubeUrlKeyDown,
    activityCatalog,
    importPresetFiles: async (files: FileList | null) => {
      if (!files?.length) {
        return;
      }
      const adapter = await ensureEngineMounted();
      await adapter.importPreset(files);
    },
    loadYouTubePreview,
    loadRecentYouTubeVideo,
    motionPreference,
    pendingPresetIdRef,
    qualityPreset,
    readinessItems,
    recentYouTubeVideos,
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
      source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file';
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
    youtubeCanLoad,
    youtubeFeedback,
    youtubeInputInvalid,
    youtubeLoading,
    youtubePreviewRef,
    youtubeReady,
    youtubeUrl,
    stopAudio: async () => {
      await engineRef.current?.stopAudio().catch((error) => {
        console.debug('Audio stop failed.', error);
      });
    },
  };
}
