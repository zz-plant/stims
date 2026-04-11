import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import '../../css/app-shell.css';
import {
  getActiveMotionPreference,
  setMotionPreference,
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
  setCompatibilityMode,
  setRenderPreferences,
  subscribeToRenderPreferences,
} from '../core/state/render-preference-store.ts';
import { captureDisplayAudioStream } from '../ui/audio-advanced-sources.ts';
import { YouTubeController } from '../ui/youtube-controller.ts';
import type {
  LaunchIntent,
  PanelState,
  PresetCatalogEntry,
  PresetCatalogManifest,
  SessionRouteState,
} from './contracts.ts';
import type {
  EngineSnapshot,
  MilkdropEngineAdapter,
} from './engine/milkdrop-engine-adapter.ts';
import {
  buildCanonicalUrl,
  readSessionRouteState,
  replaceCanonicalUrl,
} from './url-state.ts';
import {
  buildLaunchIntent,
  buildStarterLooks,
  describePresetMood,
  formatPresetSupportLabel,
  getCollectionTags,
  mapRuntimeCatalogEntry,
  matchesPreset,
  type ReadinessItem,
} from './workspace-helpers.ts';
import {
  WorkspaceLaunchPanel,
  WorkspaceStagePanel,
  WorkspaceToast,
  WorkspaceToolSheet,
} from './workspace-ui.tsx';

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

export function StimsWorkspaceApp() {
  const [routeState, setRouteState] = useState<SessionRouteState>(() =>
    readSessionRouteState(),
  );
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
  const shownToastKeysRef = useRef(new Set<string>());
  const pendingPresetIdRef = useRef<string | null>(null);
  const initialLaunchIntentRef = useRef<LaunchIntent>(
    buildLaunchIntent(routeState),
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

    if (pendingPresetIdRef.current) {
      if (engineSnapshot.activePresetId === pendingPresetIdRef.current) {
        pendingPresetIdRef.current = null;
      }
      return;
    }

    if (routeState.presetId === engineSnapshot.activePresetId) {
      return;
    }

    startTransition(() => {
      setRouteState((current) => ({
        ...current,
        presetId: engineSnapshot.activePresetId,
      }));
    });
  }, [engineSnapshot?.activePresetId, routeState.presetId]);

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

  useEffect(() => {
    if (!engineRef.current?.isMounted() || !routeState.collectionTag) {
      return;
    }

    engineRef.current.setCollectionTag(routeState.collectionTag);
  }, [routeState.collectionTag]);

  useEffect(() => {
    if (
      !engineRef.current?.isMounted() ||
      !routeState.presetId ||
      routeState.presetId === engineSnapshot?.activePresetId
    ) {
      if (routeState.presetId === engineSnapshot?.activePresetId) {
        pendingPresetIdRef.current = null;
      }
      return;
    }

    pendingPresetIdRef.current = routeState.presetId;
    void engineRef.current.loadPreset(routeState.presetId).catch(() => {
      if (pendingPresetIdRef.current === routeState.presetId) {
        pendingPresetIdRef.current = null;
      }
    });
  }, [engineSnapshot?.activePresetId, routeState.presetId]);

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

  const runtimeCatalog = (engineSnapshot?.catalogEntries ?? []).map(
    mapRuntimeCatalogEntry,
  );
  const runtimeCatalogReady =
    (engineSnapshot?.runtimeReady ?? false) || runtimeCatalog.length > 0;
  const catalog = routeState.invalidExperienceSlug
    ? fallbackCatalog
    : runtimeCatalog;
  const catalogReady = routeState.invalidExperienceSlug
    ? fallbackCatalogReady
    : runtimeCatalogReady;
  const catalogError = routeState.invalidExperienceSlug
    ? fallbackCatalogError
    : null;

  const filteredCatalog = catalog.filter((entry) => {
    if (
      routeState.collectionTag &&
      !entry.tags?.includes(routeState.collectionTag)
    ) {
      return false;
    }
    return matchesPreset(entry, deferredSearch);
  });

  const currentPreset =
    filteredCatalog.find(
      (entry) => entry.id === engineSnapshot?.activePresetId,
    ) ??
    catalog.find((entry) => entry.id === engineSnapshot?.activePresetId) ??
    null;

  const collectionTags = getCollectionTags(catalog);
  const starterLooks = buildStarterLooks(catalog);
  const featuredPreset = starterLooks[0]?.preset ?? catalog[0] ?? null;
  const launchControlsHidden =
    engineSnapshot?.audioActive || document.body.dataset.audioActive === 'true';
  const runtimeReady =
    Boolean(engineSnapshot?.runtimeReady) && !routeState.invalidExperienceSlug;
  const engineReady = runtimeReady;
  const resolvedBackend =
    engineSnapshot?.backend ??
    (document.body.dataset.activeBackend === 'webgl'
      ? 'webgl'
      : document.body.dataset.activeBackend === 'webgpu'
        ? 'webgpu'
        : null);

  const commitRoute = (nextState: SessionRouteState) => {
    startTransition(() => {
      setRouteState(nextState);
    });
  };

  const updatePanel = (panel: PanelState) => {
    commitRoute({ ...routeState, panel });
  };

  const handlePresetSelection = (presetId: string) => {
    commitRoute({ ...routeState, presetId, panel: null });
  };

  const handleBrowseRecovery = () => {
    commitRoute({ ...routeState, presetId: null, panel: 'browse' });
  };

  const handleFeaturedPresetSelection = () => {
    if (!featuredPreset) {
      return;
    }

    handlePresetSelection(featuredPreset.id);
  };

  const handleShufflePreset = () => {
    const activePresetId =
      routeState.presetId ?? engineSnapshot?.activePresetId;
    const preferredPool =
      filteredCatalog.length > 1
        ? filteredCatalog
        : catalog.length > 1
          ? catalog
          : [];
    const shuffledPool = preferredPool.filter(
      (entry) => entry.id !== activePresetId,
    );
    const fallbackPool = filteredCatalog.length > 0 ? filteredCatalog : catalog;
    const nextPool = shuffledPool.length > 0 ? shuffledPool : fallbackPool;
    if (!nextPool.length) {
      return;
    }

    const nextPreset =
      nextPool[Math.floor(Math.random() * nextPool.length)] ?? nextPool[0];
    if (!nextPreset) {
      return;
    }

    handlePresetSelection(nextPreset.id);
  };

  const handleAudioStart = async (
    source: 'demo' | 'microphone' | 'tab' | 'youtube',
  ) => {
    try {
      setStatusMessage(null);

      if (source === 'demo') {
        commitRoute({ ...routeState, audioSource: 'demo', panel: null });
        await engineRef.current?.setAudioSource({ source: 'demo' });
        return;
      }

      if (source === 'microphone') {
        commitRoute({ ...routeState, audioSource: 'microphone', panel: null });
        await engineRef.current?.setAudioSource({ source: 'microphone' });
        return;
      }

      const stream = await captureDisplayAudioStream({
        unavailableMessage: 'Display capture is unavailable in this browser.',
        missingAudioMessage:
          source === 'youtube'
            ? 'No YouTube audio track was captured. Choose This tab and enable Share audio.'
            : 'No tab audio track was captured. Choose This tab and enable Share audio.',
      });
      commitRoute({ ...routeState, audioSource: source, panel: null });
      await engineRef.current?.setAudioSource({
        source,
        stream,
        cropTarget: youtubePreviewRef.current,
      });
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Audio start failed.',
      );
    }
  };

  const handleYouTubeLoad = async () => {
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

  const handleImport = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    await engineRef.current?.importPreset(files);
    updatePanel('editor');
  };

  const showToast = useEffectEvent(
    (message: string, tone: 'info' | 'warn' | 'error' = 'info') => {
      setToast({ message, tone });
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
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

    const key = `${statusMessage ? 'error' : 'info'}:${runtimeMessage}`;
    if (shownToastKeysRef.current.has(key)) {
      return;
    }

    shownToastKeysRef.current.add(key);
    showToast(runtimeMessage, statusMessage ? 'error' : 'info');
  }, [engineSnapshot?.status, statusMessage]);

  useEffect(() => {
    if (!runtimeReady || resolvedBackend !== 'webgl') {
      return;
    }

    const key = 'warn:backend:webgl';
    if (shownToastKeysRef.current.has(key)) {
      return;
    }

    shownToastKeysRef.current.add(key);
    showToast('Using a lighter visual mode on this device.', 'warn');
  }, [resolvedBackend, runtimeReady]);

  const selectedPreset =
    catalog.find((entry) => entry.id === routeState.presetId) ??
    currentPreset ??
    null;
  const missingRequestedPreset = Boolean(
    routeState.presetId &&
      catalogReady &&
      !selectedPreset &&
      !routeState.invalidExperienceSlug &&
      pendingPresetIdRef.current !== routeState.presetId,
  );
  const loadingRequestedPreset = Boolean(
    routeState.presetId &&
      !selectedPreset &&
      !routeState.invalidExperienceSlug &&
      !missingRequestedPreset,
  );
  const readinessAlerts = readinessItems.filter(
    (item) => item.state !== 'ready',
  );
  const stageAnchoredToolOpen =
    routeState.panel === 'editor' || routeState.panel === 'inspector';
  const launchEyebrow = missingRequestedPreset
    ? 'Recover your session'
    : runtimeReady || routeState.invalidExperienceSlug
      ? 'Start here'
      : 'Getting things ready';
  const launchTitle = missingRequestedPreset
    ? 'That saved link needs a new look.'
    : runtimeReady || routeState.invalidExperienceSlug
      ? 'Pick an audio path.'
      : 'Loading the visualizer.';
  const launchSummary = missingRequestedPreset
    ? 'This preset is no longer bundled. Start demo to recover quickly, or open Looks before you play.'
    : runtimeReady || routeState.invalidExperienceSlug
      ? 'Start demo fastest. Use mic for room-reactive visuals or capture tab audio when music is already playing.'
      : 'One moment while visuals warm up.';
  const stageEyebrow = missingRequestedPreset
    ? 'Link needs a rescue'
    : loadingRequestedPreset
      ? 'Loading requested look'
      : launchControlsHidden
        ? 'Now playing'
        : selectedPreset
          ? 'Selected look'
          : 'Start with a look';
  const stageTitle = missingRequestedPreset
    ? 'Requested look unavailable'
    : loadingRequestedPreset
      ? 'Loading your look'
      : (selectedPreset?.title ?? 'Pick a look');
  const stageSummary = missingRequestedPreset
    ? `"${routeState.presetId}" is not in this build. Load a featured look or open Looks to recover.`
    : loadingRequestedPreset
      ? `One moment while we load ${routeState.presetId}.`
      : selectedPreset
        ? `${selectedPreset.author || 'Unknown author'} · ${formatPresetSupportLabel(selectedPreset)}`
        : featuredPreset
          ? `Featured first pick: ${featuredPreset.title} · ${describePresetMood(featuredPreset)}. Open Looks or shuffle for another vibe.`
          : 'Open Looks to pick a preset without losing the stage.';

  return (
    <div className="stims-shell">
      <header className="top-nav stims-shell__nav">
        <div className="stims-shell__brand">
          <a href="/" className="stims-shell__logo">
            <span>Stims</span>
            <small>Audio-reactive visuals</small>
          </a>
        </div>
        <nav className="stims-shell__nav-actions" aria-label="Main">
          <button
            type="button"
            className="stims-shell__nav-pill"
            data-active={String(routeState.panel === 'browse')}
            onClick={() =>
              updatePanel(routeState.panel === 'browse' ? null : 'browse')
            }
          >
            Looks
          </button>
          <button
            type="button"
            className="stims-shell__nav-pill"
            data-active={String(routeState.panel === 'settings')}
            onClick={() =>
              updatePanel(routeState.panel === 'settings' ? null : 'settings')
            }
          >
            Settings
          </button>
          <a
            className="stims-shell__nav-link"
            href="https://github.com/zz-plant/stims"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </header>

      <main className="stims-shell__content">
        <WorkspaceLaunchPanel
          engineReady={engineReady}
          featuredPreset={featuredPreset}
          hidden={launchControlsHidden}
          launchEyebrow={launchEyebrow}
          launchSummary={launchSummary}
          launchTitle={launchTitle}
          onAudioStart={(source) => {
            void handleAudioStart(source);
          }}
          onLoadYouTube={() => {
            void handleYouTubeLoad();
          }}
          onToggleExtendedSources={() =>
            setShowExtendedSources((current) => !current)
          }
          onYoutubeUrlChange={setYoutubeUrl}
          readinessAlerts={readinessAlerts}
          showExtendedSources={showExtendedSources}
          youtubePreviewRef={youtubePreviewRef}
          youtubeReady={youtubeReady}
          youtubeUrl={youtubeUrl}
        />

        <WorkspaceStagePanel
          audioSource={engineSnapshot?.audioSource}
          backend={engineSnapshot?.backend}
          featuredPreset={featuredPreset}
          invalidExperienceSlug={routeState.invalidExperienceSlug}
          missingRequestedPreset={missingRequestedPreset}
          onBrowseRecovery={handleBrowseRecovery}
          onFeaturedPresetSelection={handleFeaturedPresetSelection}
          stageEyebrow={stageEyebrow}
          stageRef={stageRef}
          stageSummary={stageSummary}
          stageTitle={stageTitle}
        />
      </main>

      <WorkspaceToolSheet
        catalog={catalog}
        catalogError={catalogError}
        catalogReady={catalogReady}
        collectionTags={collectionTags}
        currentPresetId={engineSnapshot?.activePresetId ?? null}
        filteredCatalog={filteredCatalog}
        motionPreference={motionPreference}
        onClose={() => updatePanel(null)}
        onCollectionTagChange={(collectionTag) =>
          commitRoute({ ...routeState, collectionTag })
        }
        onCompatibilityModeChange={setCompatibilityMode}
        onExportPreset={() => {
          engineRef.current?.exportPreset();
        }}
        onImport={(files) => {
          void handleImport(files);
        }}
        onMotionPreferenceChange={(enabled) => setMotionPreference({ enabled })}
        onPresetSelection={handlePresetSelection}
        onQualityPresetChange={(presetId) => {
          engineRef.current?.setQualityPreset(presetId);
        }}
        onRenderPreferenceChange={setRenderPreferences}
        onSearchQueryChange={setSearchQuery}
        onShowCurrentLink={() => {
          const currentUrl = buildCanonicalUrl(routeState);
          setStatusMessage(
            `Current link: ${currentUrl.pathname}${currentUrl.search}`,
          );
        }}
        onShufflePreset={handleShufflePreset}
        onTabChange={updatePanel}
        panel={routeState.panel}
        qualityPreset={qualityPreset}
        renderPreferences={renderPreferences}
        routeState={routeState}
        searchQuery={searchQuery}
        showAgentControls={routeState.agentMode}
        stageAnchoredToolOpen={stageAnchoredToolOpen}
      />

      <WorkspaceToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
