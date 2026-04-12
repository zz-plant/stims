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
import { getRenderingSupport } from '../core/renderer-capabilities.ts';
import { probeMicrophoneCapability } from '../core/services/microphone-permission-service.ts';
import {
  getActiveQualityPreset,
  QUALITY_STORAGE_KEY,
  subscribeToQualityPreset,
} from '../core/settings-panel.ts';
import {
  getActiveRenderPreferences,
  subscribeToRenderPreferences,
} from '../core/state/render-preference-store.ts';
import { resolvePresetId } from '../milkdrop/preset-id-resolution.ts';
import { YouTubeController } from '../ui/youtube-controller.ts';
import type {
  PresetCatalogEntry,
  PresetCatalogManifest,
  SessionRouteState,
} from './contracts.ts';
import type {
  EngineSnapshot,
  MilkdropEngineAdapter,
} from './engine/milkdrop-engine-adapter.ts';
import { readSessionRouteState, replaceCanonicalUrl } from './url-state.ts';
import { buildLaunchIntent, type ReadinessItem } from './workspace-helpers.ts';

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

function buildReadinessSummary(
  micState: Awaited<ReturnType<typeof probeMicrophoneCapability>>,
) {
  const rendering = getRenderingSupport();

  const renderItem: ReadinessItem = rendering.hasWebGPU
    ? {
        id: 'rendering',
        label: 'Graphics',
        state: 'ready',
        summary: 'High-detail visuals are ready.',
      }
    : rendering.hasWebGL
      ? {
          id: 'rendering',
          label: 'Graphics',
          state: 'warn',
          summary: 'Visuals will run in a lighter mode on this device.',
        }
      : {
          id: 'rendering',
          label: 'Graphics',
          state: 'blocked',
          summary: 'This browser cannot start the visuals.',
        };

  const micItem: ReadinessItem =
    micState.state === 'denied'
      ? {
          id: 'microphone',
          label: 'Microphone',
          state: 'warn',
          summary: micState.reason ?? 'Microphone access is blocked.',
        }
      : micState.supported
        ? {
            id: 'microphone',
            label: 'Microphone',
            state: 'ready',
            summary:
              micState.state === 'granted'
                ? 'Microphone access is ready.'
                : 'The browser can prompt for microphone access when needed.',
          }
        : {
            id: 'microphone',
            label: 'Microphone',
            state: 'blocked',
            summary: micState.reason ?? 'Microphone capture is unavailable.',
          };

  const motionSupported =
    typeof window !== 'undefined' &&
    ('DeviceMotionEvent' in window || 'LinearAccelerationSensor' in window);
  const motionItem: ReadinessItem = motionSupported
    ? {
        id: 'motion',
        label: 'Motion',
        state: 'ready',
        summary:
          'Tilt and motion-reactive presets can run on supported devices.',
      }
    : {
        id: 'motion',
        label: 'Motion',
        state: 'warn',
        summary: 'Motion controls are unavailable on this device.',
      };

  return [renderItem, micItem, motionItem];
}

export function useWorkspaceRouteState() {
  const [routeState, setRouteState] = useState<SessionRouteState>(() =>
    readSessionRouteState(),
  );

  useEffect(() => {
    replaceCanonicalUrl(routeState);
  }, [routeState]);

  useEffect(() => {
    const handlePopstate = () => {
      startTransition(() => {
        setRouteState(readSessionRouteState());
      });
    };

    window.addEventListener('popstate', handlePopstate);
    return () => {
      window.removeEventListener('popstate', handlePopstate);
    };
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
  const [engineAdapterReady, setEngineAdapterReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [readinessItems, setReadinessItems] = useState<ReadinessItem[]>([]);
  const [qualityPreset, setQualityPresetState] = useState(() =>
    getActiveQualityPreset({ storageKey: QUALITY_STORAGE_KEY }),
  );
  const [renderPreferences, setRenderPreferencesState] = useState(() =>
    getActiveRenderPreferences(),
  );
  const [motionPreference, setMotionPreferenceState] = useState(() =>
    getActiveMotionPreference(),
  );
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeReady, setYoutubeReady] = useState(false);
  const [showExtendedSources, setShowExtendedSources] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: 'info' | 'warn' | 'error';
  } | null>(null);
  const deferredSearch = useDeferredValue(searchQuery);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const youtubeControllerRef = useRef<YouTubeController | null>(null);
  const youtubePreviewRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MilkdropEngineAdapter | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const webglWarningShownRef = useRef(false);
  const shownToastKeysRef = useRef(new Set<string>());
  const pendingPresetIdRef = useRef<string | null>(null);
  const initialLaunchIntentRef = useRef(buildLaunchIntent(routeState));

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
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void import('./engine/milkdrop-engine-adapter.ts')
      .then(({ createMilkdropEngineAdapter }) => {
        if (cancelled) {
          return;
        }
        const adapter = createMilkdropEngineAdapter();
        engineRef.current = adapter;
        unsubscribe = adapter.subscribe((snapshot) => {
          setEngineSnapshot(snapshot);
        });
        setEngineAdapterReady(true);
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
      unsubscribe?.();
      engineRef.current?.dispose();
      engineRef.current = null;
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
    if (!routeState.invalidExperienceSlug) {
      return;
    }

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
  }, [routeState.invalidExperienceSlug]);

  useEffect(() => {
    let cancelled = false;

    void probeMicrophoneCapability().then((microphoneCapability) => {
      if (cancelled) {
        return;
      }
      setReadinessItems(buildReadinessSummary(microphoneCapability));
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
    const stage = stageRef.current;
    if (
      !engineAdapterReady ||
      !engineRef.current ||
      !stage ||
      routeState.invalidExperienceSlug ||
      engineRef.current.isMounted() ||
      typeof MutationObserver !== 'function'
    ) {
      return;
    }

    void engineRef.current.mount(stage, initialLaunchIntentRef.current);
  }, [engineAdapterReady, routeState.invalidExperienceSlug]);

  useEffect(() => {
    if (!engineSnapshot?.activePresetId) {
      return;
    }

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
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const clearToastTimer = () => {
    if (toastTimerRef.current === null) {
      return;
    }

    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
  };

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

  useEffect(() => {
    if (
      !engineSnapshot?.runtimeReady ||
      engineSnapshot.backend !== 'webgl' ||
      routeState.invalidExperienceSlug ||
      webglWarningShownRef.current
    ) {
      return;
    }

    webglWarningShownRef.current = true;
    setToast({ message: 'Using lighter visual mode.', tone: 'warn' });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4200);
  }, [
    engineSnapshot?.backend,
    engineSnapshot?.runtimeReady,
    routeState.invalidExperienceSlug,
  ]);

  const showToast = useEffectEvent(
    (message: string, tone: 'info' | 'warn' | 'error' = 'info') => {
      setToast({ message, tone });
      clearToastTimer();
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, 4200);
    },
  );

  useEffect(() => {
    const runtimeMessage = statusMessage ?? engineSnapshot?.status;
    if (!runtimeMessage) {
      return;
    }

    const unresolvedRequestedPreset = routeState.presetId
      ? !resolvePresetId(
          engineSnapshot?.catalogEntries ?? [],
          routeState.presetId,
        )
      : false;
    if (
      unresolvedRequestedPreset &&
      routeState.presetId &&
      runtimeMessage.includes(routeState.presetId)
    ) {
      return;
    }

    const key = `${statusMessage ? 'error' : 'info'}:${runtimeMessage}`;
    if (shownToastKeysRef.current.has(key)) {
      return;
    }

    shownToastKeysRef.current.add(key);
    showToast(runtimeMessage, statusMessage ? 'error' : 'info');
  }, [
    engineSnapshot?.catalogEntries,
    engineSnapshot?.status,
    routeState.presetId,
    statusMessage,
  ]);

  const loadYouTubePreview = async () => {
    const previewHost = youtubePreviewRef.current;
    const value = youtubeUrl.trim();
    if (!previewHost || !value) {
      return;
    }

    try {
      if (!youtubeControllerRef.current) {
        youtubeControllerRef.current = new YouTubeController();
      }

      const reference = youtubeControllerRef.current.parseVideoReference(value);
      if (!reference) {
        setStatusMessage('Enter a valid YouTube URL or 11-character video ID.');
        setYoutubeReady(false);
        return;
      }

      previewHost.hidden = false;
      await youtubeControllerRef.current.loadVideo(
        'workspace-youtube-player',
        reference,
      );
      setYoutubeReady(true);
      setStatusMessage(
        'YouTube preview is ready. Capture this tab audio next.',
      );
    } catch (error) {
      setYoutubeReady(false);
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load YouTube preview.',
      );
    }
  };

  return {
    deferredSearch,
    dismissToast: () => {
      clearToastTimer();
      setToast(null);
    },
    engineAdapterReady,
    engineSnapshot,
    exportPreset: () => {
      engineRef.current?.exportPreset();
    },
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    importPresetFiles: async (files: FileList | null) => {
      if (!files?.length) {
        return;
      }
      await engineRef.current?.importPreset(files);
    },
    loadYouTubePreview,
    motionPreference,
    pendingPresetIdRef,
    qualityPreset,
    readinessItems,
    renderPreferences,
    searchQuery,
    setQualityPreset: (presetId: string) => {
      engineRef.current?.setQualityPreset(presetId);
    },
    setSearchQuery,
    setShowExtendedSources,
    setStatusMessage,
    setYoutubeUrl,
    showExtendedSources,
    stageRef,
    startAudioSource: async (request: {
      cropTarget?: HTMLElement | null;
      source: 'demo' | 'microphone' | 'tab' | 'youtube';
      stream?: MediaStream;
    }) => {
      if (request.source === 'demo' || request.source === 'microphone') {
        await engineRef.current?.setAudioSource({
          source: request.source,
        });
        return;
      }

      if (!request.stream) {
        throw new Error('A captured media stream is required for tab audio.');
      }

      await engineRef.current?.setAudioSource({
        source: request.source,
        stream: request.stream,
        cropTarget: request.cropTarget,
      });
    },
    statusMessage,
    toast,
    toggleExtendedSources: () => setShowExtendedSources((current) => !current),
    youtubePreviewRef,
    youtubeReady,
    youtubeUrl,
  };
}
