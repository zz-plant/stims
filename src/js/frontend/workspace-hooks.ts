import {
  type Dispatch,
  type SetStateAction,
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
import { resolvePresetId } from '../milkdrop/preset-id-resolution.ts';
import type { LaunchIntent, SessionRouteState } from './contracts.ts';
import type {
  EngineSnapshot,
  MilkdropEngineAdapter,
} from './engine/milkdrop-engine-adapter.ts';
import { useAudioSourceSync } from './hooks/use-audio-source-sync.ts';
import { useCatalogLoading } from './hooks/use-catalog-loading.ts';
import { useDocumentDatasetSync } from './hooks/use-document-dataset-sync.ts';
import { usePresetPreviews } from './hooks/use-preset-previews.ts';
import { usePresetRouteSync } from './hooks/use-preset-route-sync.ts';
import { useStageCanvasSync } from './hooks/use-stage-canvas-sync.ts';
import { useStoreSubscriptions } from './hooks/use-store-subscriptions.ts';
import { reportLoadStatus } from './load-status.ts';
import {
  buildSessionRouteSearch,
  parsePlainSearch,
  readSessionRouteState,
  stringifyPlainSearch,
} from './url-state.ts';
import { createLazyFactory } from './use-lazy-factory.ts';
import { buildLaunchIntent } from './workspace-helpers.ts';
import { useWorkspaceToast } from './workspace-toast.ts';
import { useWorkspaceYouTubePreview } from './workspace-youtube-preview.ts';

const log = createLogger('WorkspaceHooks');

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
      const nextState = readSessionRouteState();
      setRouteState(nextState);
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
  const [searchQuery, setSearchQuery] = useState('');
  const { motionPreference, qualityPreset, renderPreferences } =
    useStoreSubscriptions();
  const [showExtendedSources, setShowExtendedSources] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(searchQuery);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MilkdropEngineAdapter | null>(null);
  const sessionDisposedRef = useRef(false);
  const engineAdapterPromiseRef = useRef<Promise<MilkdropEngineAdapter> | null>(
    null,
  );
  const engineUnsubscribeRef = useRef<(() => void) | null>(null);
  const ensureEngineMountPromiseRef =
    useRef<Promise<MilkdropEngineAdapter> | null>(null);
  const pendingPresetIdRef = useRef<string | null>(routeState.presetId);
  const initialLaunchIntentRef = useRef(buildLaunchIntent(routeState));

  const {
    activityCatalog,
    ensureCatalogStore,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    fullCatalogReady,
    hydrateFullCatalogNow,
    refreshCatalogActivity,
  } = useCatalogLoading();

  const previewEngineRef = useRef({
    pausePreview: () => engineRef.current?.pausePreview(),
    resumePreview: () => engineRef.current?.resumePreview(),
  });
  const { presetPreviews, requestPresetPreviews, refreshPresetPreviews } =
    usePresetPreviews({
      stageRef,
      engine: previewEngineRef.current,
      engineSnapshot,
      fallbackCatalogReady,
      isDisposed: () => sessionDisposedRef.current,
    });
  const {
    handleYoutubeUrlKeyDown,
    loadRecentYouTubeVideo,
    loadYouTubePreview,
    clearRecentYouTubeVideos,
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

  const ensureEngineMounted = useEffectEvent(
    async (launchIntent?: LaunchIntent) => {
      const stage = stageRef.current;
      if (!stage) {
        throw new Error('Visualizer stage is not ready yet.');
      }

      if (ensureEngineMountPromiseRef.current) {
        return ensureEngineMountPromiseRef.current;
      }

      const intent = launchIntent ?? buildLaunchIntent(routeState);

      const mountPromise = (async () => {
        reportLoadStatus('runtime');
        const adapter = await ensureEngineAdapter();
        if (adapter.isMounted()) {
          return adapter;
        }

        await adapter.mount(stage, intent);
        return adapter;
      })();

      ensureEngineMountPromiseRef.current = mountPromise;

      try {
        return await mountPromise;
      } finally {
        ensureEngineMountPromiseRef.current = null;
      }
    },
  );

  useStageCanvasSync(stageRef);

  useEffect(() => {
    if (routeState.panel === 'browse' || routeState.presetId) {
      void hydrateFullCatalogNow();
    }
  }, [routeState.panel, routeState.presetId, hydrateFullCatalogNow]);

  useEffect(() => {
    sessionDisposedRef.current = false;

    return () => {
      sessionDisposedRef.current = true;
      // React StrictMode's dev-only double-invoke runs this cleanup and the
      // next mount back to back, synchronously, in the same commit. The
      // engine adapter is created by an async factory (see
      // ensureEngineAdapter below) that can't be cancelled mid-flight, so
      // disposing eagerly here raced it: the remount saw empty refs, kicked
      // off a *second* adapter + mount() + preset-selection fan-out, and
      // the first adapter's factory eventually resolved into an orphan
      // nothing ever disposed — still mounted, still running its own
      // preset load, doubling every preset's compile/render work.
      //
      // Deferring the actual teardown by a tick lets a same-tick remount's
      // effect body flip `sessionDisposedRef` back to `false` before this
      // timer fires, so it no-ops and the refs stay untouched — the second
      // mount effect invocation's ensureEngineMounted() then finds the
      // existing adapter already in place and reuses it instead of
      // creating a new one. A genuine unmount (no remount follows) still
      // tears down correctly, just one tick later.
      setTimeout(() => {
        if (!sessionDisposedRef.current) {
          return;
        }
        engineUnsubscribeRef.current?.();
        engineUnsubscribeRef.current = null;
        engineRef.current?.dispose();
        engineRef.current = null;
        engineAdapterPromiseRef.current = null;
        ensureEngineMountPromiseRef.current = null;
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!engineRef.current?.isMounted()) {
      initialLaunchIntentRef.current = buildLaunchIntent(routeState);
    }
  }, [routeState]);

  useEffect(() => {
    if (engineSnapshot?.runtimeReady) {
      return;
    }
    if (!routeState.presetId && !routeState.audioSource) {
      return;
    }

    void ensureEngineMounted().catch((error) => {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Unable to start the visualizer runtime.',
      );
    });
  }, [
    engineSnapshot?.runtimeReady,
    routeState.presetId,
    routeState.audioSource,
  ]);

  usePresetRouteSync({
    engineSnapshot,
    pendingPresetIdRef,
    routeState,
    setRouteState,
  });

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.isMounted()) {
      return;
    }

    if (routeState.panel === 'editor') {
      engine.openTool('editor');
      return;
    }

    engine.setOverlayOpen(false);
  }, [routeState.panel]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.isMounted()) {
      return;
    }

    engine.setCollectionTag(routeState.collectionTag ?? null);
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

    // This effect re-runs whenever the engine snapshot changes — notably when
    // `catalogEntries` lands, which on slower devices happens well before
    // `activePresetId` catches up. Without an in-flight check the same preset
    // gets requested again while the first request is still compiling, and the
    // navigation controller discards the earlier one as `superseded` after it
    // has already paid for the fetch and compile. The ref is always cleared on
    // success, failure, or the 10s timeout below, so this cannot wedge.
    if (pendingPresetIdRef.current === requestedPresetId) {
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
        if (pendingPresetIdRef.current === requestedPresetId) {
          pendingPresetIdRef.current = null;
          setStatusMessage(
            `Failed to load preset. "${requestedPresetId}" may be unavailable.`,
          );
        }
      },
    );

    return () => clearTimeout(timeoutId);
  }, [
    engineSnapshot?.activePresetId,
    engineSnapshot?.catalogEntries,
    routeState.presetId,
  ]);

  useAudioSourceSync({
    engineRef,
    engineSnapshot,
    routeState,
    setRouteState,
    setStatusMessage,
  });

  useDocumentDatasetSync({
    audioActive: engineSnapshot?.audioActive,
    agentMode: routeState.agentMode,
  });

  return {
    deferredSearch,
    dismissToast,
    engineSnapshot,
    exportPreset: () => {
      engineRef.current?.exportPreset();
    },
    goBackPreset: async () => {
      await engineRef.current?.goBackPreset();
    },
    revertEditorSource: () => {
      engineRef.current?.revertEditorSource();
    },
    duplicatePreset: async () => {
      await engineRef.current?.duplicatePreset();
    },
    deleteActivePreset: async () => {
      await engineRef.current?.deleteActivePreset();
    },
    getVideoExportRuntime: () =>
      engineRef.current?.getVideoExportRuntime() ?? null,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    fullCatalogReady,
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
    setAutoplay: (enabled: boolean) => {
      engineRef.current?.setAutoplay(enabled);
    },
    setTransitionMode: (mode: 'blend' | 'cut') => {
      engineRef.current?.setTransitionMode(mode);
    },
    setBlendDuration: (value: number) => {
      engineRef.current?.setBlendDuration(value);
    },
    updateEditorSource: (source: string) => {
      engineRef.current?.updateEditorSource(source);
    },
    updateInspectorField: (key: string, value: number) => {
      engineRef.current?.updateInspectorField?.(key, value);
    },
    startXrStage: async (mode: 'immersive-vr' | 'immersive-ar') => {
      const adapter = await ensureEngineMounted();
      return adapter.startXrStage(mode);
    },
    endXrStage: async () => {
      await engineRef.current?.endXrStage();
    },
    setSearchQuery,
    setShowExtendedSources,
    setStatusMessage,
    setYoutubeUrl,
    showExtendedSources,
    stageRef,
    refreshPresetPreviews,
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
          ...(request.stream ? { stream: request.stream } : {}),
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
    requestPresetPreviews,
    youtubeCanLoad,
    youtubeFeedback,
    youtubeInputInvalid,
    youtubeLoading,
    youtubePreviewRef,
    youtubeReady,
    youtubeUrl,
    clearRecentYouTubeVideos,
    pausePreview: () => {
      engineRef.current?.pausePreview();
    },
    resumePreview: () => {
      engineRef.current?.resumePreview();
    },
    stopAudio: async () => {
      await engineRef.current?.stopAudio().catch((error) => {
        console.debug('Audio stop failed.', error);
      });
    },
  };
}
