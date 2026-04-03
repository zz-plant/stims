import {
  startTransition,
  useDeferredValue,
  useEffect,
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
  DEFAULT_QUALITY_PRESETS,
  describeQualityPresetImpact,
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
import {
  createMilkdropEngineAdapter,
  type EngineSnapshot,
} from './engine/milkdrop-engine-adapter.ts';
import {
  buildCanonicalUrl,
  readSessionRouteState,
  replaceCanonicalUrl,
} from './url-state.ts';

type ReadinessItem = {
  id: string;
  label: string;
  state: 'ready' | 'warn' | 'blocked';
  summary: string;
};

const TOOL_TABS: Array<Exclude<PanelState, null>> = [
  'browse',
  'editor',
  'inspector',
  'settings',
];

function prettifyCollectionTag(collectionTag: string) {
  return collectionTag
    .replace(/^collection:/u, '')
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
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

function matchesPreset(entry: PresetCatalogEntry, query: string) {
  if (!query) {
    return true;
  }

  const haystack = [entry.title, entry.author, entry.id, ...(entry.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function getCollectionTags(entries: PresetCatalogEntry[]) {
  const collectionTags = new Set<string>();
  entries.forEach((entry) => {
    entry.tags?.forEach((tag) => {
      if (tag.startsWith('collection:')) {
        collectionTags.add(tag);
      }
    });
  });
  return [...collectionTags].sort((left, right) => left.localeCompare(right));
}

function formatAudioSourceLabel(
  source: EngineSnapshot['audioSource'] | undefined,
) {
  switch (source) {
    case 'demo':
      return 'Demo audio';
    case 'microphone':
      return 'Mic';
    case 'tab':
      return 'Tab audio';
    case 'youtube':
      return 'YouTube tab';
    default:
      return 'Waiting for sound';
  }
}

function formatPresetSupportLabel(entry: PresetCatalogEntry) {
  if (
    entry.expectedFidelityClass === 'exact' ||
    entry.expectedFidelityClass === 'near-exact'
  ) {
    return 'Full look';
  }
  if (
    entry.expectedFidelityClass === 'partial' ||
    entry.expectedFidelityClass === 'fallback'
  ) {
    return 'Adjusted look';
  }
  if (entry.supports?.webgpu) {
    return 'High-detail ready';
  }
  return 'Lighter mode';
}

export function StimsWorkspaceApp() {
  const [routeState, setRouteState] = useState<SessionRouteState>(() =>
    readSessionRouteState(),
  );
  const [engineSnapshot, setEngineSnapshot] = useState<EngineSnapshot | null>(
    null,
  );
  const [catalog, setCatalog] = useState<PresetCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogReady, setCatalogReady] = useState(false);
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(searchQuery);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const youtubeControllerRef = useRef<YouTubeController | null>(null);
  const youtubePreviewRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef(createMilkdropEngineAdapter());
  const initialLaunchIntentRef = useRef<LaunchIntent>({
    presetId: routeState.presetId,
    collectionTag: routeState.collectionTag,
    panel:
      routeState.panel && routeState.panel !== 'settings'
        ? routeState.panel
        : null,
    audioSource: routeState.audioSource,
    agentMode: routeState.agentMode,
  });

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
    const unsubscribe = engineRef.current.subscribe((snapshot) => {
      setEngineSnapshot(snapshot);
    });

    return unsubscribe;
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

    void fetch('/milkdrop-presets/catalog.json')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Catalog request failed with ${response.status}`);
        }
        const manifest = (await response.json()) as PresetCatalogManifest;
        if (cancelled) {
          return;
        }
        setCatalog(manifest.presets ?? []);
        setCatalogReady(true);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setCatalogError(
          error instanceof Error ? error.message : 'Unable to load catalog.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    const stage = stageRef.current;
    if (
      !stage ||
      routeState.invalidExperienceSlug ||
      engineRef.current.isMounted() ||
      typeof MutationObserver !== 'function'
    ) {
      return;
    }

    void engineRef.current.mount(stage, initialLaunchIntentRef.current);

    return () => {
      engineRef.current.dispose();
    };
  }, [routeState.invalidExperienceSlug]);

  useEffect(() => {
    if (!engineSnapshot?.activePresetId) {
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
    if (!engineRef.current.isMounted()) {
      return;
    }

    if (routeState.panel && routeState.panel !== 'settings') {
      engineRef.current.openTool(routeState.panel);
      return;
    }

    engineRef.current.setOverlayOpen(false);
  }, [routeState.panel]);

  useEffect(() => {
    if (!engineRef.current.isMounted() || !routeState.collectionTag) {
      return;
    }

    engineRef.current.setCollectionTag(routeState.collectionTag);
  }, [routeState.collectionTag]);

  useEffect(() => {
    if (
      !engineRef.current.isMounted() ||
      !routeState.presetId ||
      routeState.presetId === engineSnapshot?.activePresetId
    ) {
      return;
    }

    void engineRef.current.loadPreset(routeState.presetId);
  }, [engineSnapshot?.activePresetId, routeState.presetId]);

  useEffect(() => {
    if (
      !engineRef.current.isMounted() ||
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
    commitRoute({ ...routeState, presetId });
    void engineRef.current.loadPreset(presetId);
  };

  const handleAudioStart = async (
    source: 'demo' | 'microphone' | 'tab' | 'youtube',
  ) => {
    try {
      setStatusMessage(null);

      if (source === 'demo') {
        commitRoute({ ...routeState, audioSource: 'demo' });
        await engineRef.current.setAudioSource({ source: 'demo' });
        document.documentElement.dataset.focusedSession = 'live';
        document
          .querySelector('[data-audio-controls]')
          ?.setAttribute('hidden', '');
        return;
      }

      if (source === 'microphone') {
        commitRoute({ ...routeState, audioSource: 'microphone' });
        await engineRef.current.setAudioSource({ source: 'microphone' });
        document.documentElement.dataset.focusedSession = 'live';
        document
          .querySelector('[data-audio-controls]')
          ?.setAttribute('hidden', '');
        return;
      }

      const stream = await captureDisplayAudioStream({
        unavailableMessage: 'Display capture is unavailable in this browser.',
        missingAudioMessage:
          source === 'youtube'
            ? 'No YouTube audio track was captured. Choose This tab and enable Share audio.'
            : 'No tab audio track was captured. Choose This tab and enable Share audio.',
      });
      commitRoute({ ...routeState, audioSource: source });
      await engineRef.current.setAudioSource({
        source,
        stream,
        cropTarget: youtubePreviewRef.current,
      });
      document.documentElement.dataset.focusedSession = 'live';
      document
        .querySelector('[data-audio-controls]')
        ?.setAttribute('hidden', '');
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
    await engineRef.current.importPreset(files);
    updatePanel('editor');
  };

  return (
    <div className="stims-shell">
      <header className="top-nav stims-shell__nav">
        <div className="stims-shell__brand">
          <a href="/" className="stims-shell__logo">
            <span>Stims</span>
            <small>Audio-reactive visuals</small>
          </a>
        </div>
        <nav className="stims-shell__nav-links" aria-label="Main">
          {TOOL_TABS.map((tool) => (
            <button
              key={tool}
              type="button"
              className="stims-shell__nav-pill"
              data-active={String(routeState.panel === tool)}
              onClick={() =>
                updatePanel(routeState.panel === tool ? null : tool)
              }
            >
              {tool === 'browse'
                ? 'Looks'
                : tool === 'editor'
                  ? 'Edit'
                  : tool === 'inspector'
                    ? 'Inspect'
                    : 'Settings'}
            </button>
          ))}
          <a
            className="stims-shell__nav-pill stims-shell__nav-pill--link"
            href="https://github.com/zz-plant/stims"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </header>

      <main className="stims-shell__content">
        <section
          className="stims-shell__launch"
          data-audio-controls
          hidden={launchControlsHidden}
        >
          <div className="stims-shell__launch-copy">
            <p className="stims-shell__eyebrow">
              {runtimeReady || routeState.invalidExperienceSlug
                ? 'Ready'
                : 'Getting things ready'}
            </p>
            <h1>
              {runtimeReady || routeState.invalidExperienceSlug
                ? 'Pick a look and start the sound.'
                : 'Loading the visualizer.'}
            </h1>
            <p>
              {runtimeReady || routeState.invalidExperienceSlug
                ? 'Try the demo track, use your mic, or capture a tab.'
                : 'One moment while the visuals warm up.'}
            </p>
          </div>

          <div className="stims-shell__launch-actions">
            <button
              id="use-demo-audio"
              data-demo-audio-btn="true"
              className="cta-button primary"
              type="button"
              disabled={!engineReady}
              onClick={() => void handleAudioStart('demo')}
            >
              Start demo
            </button>
            <button
              id="start-audio-btn"
              data-mic-audio-btn="true"
              className="cta-button"
              type="button"
              disabled={!engineReady}
              onClick={() => void handleAudioStart('microphone')}
            >
              Use mic
            </button>
            <button
              id="use-tab-audio"
              className="cta-button"
              type="button"
              disabled={!engineReady}
              onClick={() => void handleAudioStart('tab')}
            >
              Capture tab
            </button>
          </div>

          <div className="stims-shell__youtube">
            <label className="stims-shell__field-label" htmlFor="youtube-url">
              YouTube capture
            </label>
            <div className="stims-shell__youtube-row">
              <input
                id="youtube-url"
                className="stims-shell__input"
                type="url"
                placeholder="https://youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
              />
              <button
                id="load-youtube"
                className="cta-button"
                type="button"
                disabled={!engineReady}
                onClick={() => void handleYouTubeLoad()}
              >
                Load
              </button>
              <button
                id="use-youtube-audio"
                className="cta-button"
                type="button"
                disabled={!engineReady || !youtubeReady}
                onClick={() => void handleAudioStart('youtube')}
              >
                Capture YouTube
              </button>
            </div>
            <div
              id="youtube-player-container"
              ref={youtubePreviewRef}
              className="stims-shell__youtube-preview"
              hidden
            >
              <div id="workspace-youtube-player"></div>
            </div>
          </div>

          <section className="preflight-panel stims-shell__quick-check">
            <div className="stims-shell__quick-check-header">
              <h2>Quick check</h2>
              <p>Graphics, mic, and motion at a glance.</p>
            </div>
            <div className="stims-shell__status-grid">
              {readinessItems.map((item) => (
                <article
                  key={item.id}
                  className="stims-shell__status-card"
                  data-state={item.state}
                >
                  <strong>{item.label}</strong>
                  <span>{item.summary}</span>
                </article>
              ))}
            </div>
          </section>
        </section>

        <section className="stims-shell__workspace">
          <section className="stims-shell__stage-section">
            <div className="stims-shell__stage-header">
              <div className="stims-shell__stage-copy">
                <p className="stims-shell__eyebrow">Now playing</p>
                <h2>{currentPreset?.title ?? 'Pick a look'}</h2>
                <p className="stims-shell__meta-copy stims-shell__stage-summary">
                  {currentPreset
                    ? `${currentPreset.author || 'Unknown author'} · ${formatPresetSupportLabel(currentPreset)}`
                    : 'Choose a preset from the rail, then start your audio source.'}
                </p>
              </div>
              <div className="stims-shell__session-meta">
                <span className="stims-shell__meta-pill">
                  {engineSnapshot?.backend === 'webgpu'
                    ? 'Full detail'
                    : engineSnapshot?.backend === 'webgl'
                      ? 'Lighter mode'
                      : 'Starting up'}
                </span>
                <span className="stims-shell__meta-pill">
                  {formatAudioSourceLabel(engineSnapshot?.audioSource)}
                </span>
              </div>
            </div>

            <div className="stims-shell__stage-frame">
              <div ref={stageRef} className="stims-shell__stage-root" />
              {routeState.invalidExperienceSlug ? (
                <div className="active-toy-status is-error">
                  <div className="active-toy-status__content">
                    <h2>Older link</h2>
                    <p>
                      This older Stims link points to a view that is no longer
                      available: "{routeState.invalidExperienceSlug}".
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            {engineSnapshot?.status ||
            statusMessage ||
            resolvedBackend === 'webgl' ? (
              <output
                className="stims-shell__status-banner renderer-pill"
                aria-live="polite"
              >
                {resolvedBackend === 'webgl'
                  ? `Using a lighter visual mode for this device. ${
                      statusMessage ?? engineSnapshot?.status ?? ''
                    }`.trim()
                  : (statusMessage ?? engineSnapshot?.status)}
              </output>
            ) : null}

            <div className="stims-shell__stage-dock">
              <div className="stims-shell__stage-dock-copy">
                <p className="stims-shell__eyebrow">Controls</p>
                <h3>Keep the picture in front, open tools when needed.</h3>
              </div>
              <div className="stims-shell__session-actions">
                <button
                  type="button"
                  className="cta-button"
                  onClick={() => updatePanel('browse')}
                >
                  Browse looks
                </button>
                <button
                  type="button"
                  className="cta-button"
                  onClick={() => updatePanel('editor')}
                >
                  Edit code
                </button>
                <button
                  type="button"
                  className="cta-button"
                  onClick={() => updatePanel('inspector')}
                >
                  View details
                </button>
                <button
                  type="button"
                  className="cta-button"
                  onClick={() => updatePanel('settings')}
                >
                  Picture settings
                </button>
                <button
                  type="button"
                  className="cta-button"
                  onClick={() => engineRef.current.exportPreset()}
                >
                  Export preset
                </button>
                <label className="cta-button stims-shell__file-button">
                  Import preset
                  <input
                    type="file"
                    accept=".milk,.txt,text/plain"
                    multiple
                    onChange={(event) => void handleImport(event.target.files)}
                  />
                </label>
                <button
                  type="button"
                  className="cta-button"
                  data-back-to-library="true"
                  onClick={() => commitRoute({ ...routeState, panel: null })}
                >
                  Back to visuals
                </button>
              </div>
            </div>
          </section>

          <div className="stims-shell__rail">
            <aside className="stims-shell__sidebar">
              <div className="stims-shell__sidebar-header">
                <p className="stims-shell__eyebrow">Looks</p>
                <h2>Preset browser</h2>
                <p className="stims-shell__meta-copy">
                  Search, filter, and swap visuals without losing the stage.
                </p>
              </div>

              <label
                className="stims-shell__field-label"
                htmlFor="preset-search"
              >
                Search looks
              </label>
              <input
                id="preset-search"
                className="stims-shell__input"
                type="search"
                placeholder="Search title, author, or tag"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />

              <nav
                className="stims-shell__collections"
                aria-label="Collections"
              >
                <button
                  type="button"
                  className="stims-shell__collection-pill"
                  data-active={String(routeState.collectionTag === null)}
                  onClick={() =>
                    commitRoute({ ...routeState, collectionTag: null })
                  }
                >
                  All
                </button>
                {collectionTags.map((collectionTag) => (
                  <button
                    key={collectionTag}
                    type="button"
                    className="stims-shell__collection-pill"
                    data-active={String(
                      routeState.collectionTag === collectionTag,
                    )}
                    onClick={() =>
                      commitRoute({
                        ...routeState,
                        collectionTag:
                          routeState.collectionTag === collectionTag
                            ? null
                            : collectionTag,
                      })
                    }
                  >
                    {prettifyCollectionTag(collectionTag)}
                  </button>
                ))}
              </nav>

              {!catalogReady && !catalogError ? (
                <p className="stims-shell__meta-copy">Loading looks…</p>
              ) : null}
              {catalogError ? (
                <p className="stims-shell__meta-copy">{catalogError}</p>
              ) : null}
              <ul className="stims-shell__preset-list">
                {filteredCatalog.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="stims-shell__preset-card"
                      data-active={String(
                        entry.id === engineSnapshot?.activePresetId,
                      )}
                      onClick={() => handlePresetSelection(entry.id)}
                    >
                      <span className="stims-shell__preset-title">
                        {entry.title}
                      </span>
                      <span className="stims-shell__preset-meta">
                        {entry.author || 'Unknown author'}
                      </span>
                      <span className="stims-shell__preset-tech">
                        {formatPresetSupportLabel(entry)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <aside
              className="stims-shell__settings"
              hidden={routeState.panel !== 'settings'}
            >
              <div className="stims-shell__sidebar-header">
                <p className="stims-shell__eyebrow">Settings</p>
                <h2>Picture and controls</h2>
              </div>

              <label
                className="stims-shell__field-label"
                htmlFor="quality-select"
              >
                Picture style
              </label>
              <select
                id="quality-select"
                className="stims-shell__select"
                value={qualityPreset.id}
                onChange={(event) => {
                  engineRef.current.setQualityPreset(event.target.value);
                }}
              >
                {DEFAULT_QUALITY_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <p className="stims-shell__meta-copy">
                {describeQualityPresetImpact(qualityPreset)}
              </p>

              <label className="stims-shell__toggle">
                <input
                  type="checkbox"
                  checked={renderPreferences.compatibilityMode}
                  onChange={(event) => {
                    setCompatibilityMode(event.target.checked);
                  }}
                />
                <span>Safer graphics mode</span>
              </label>

              <label className="stims-shell__toggle">
                <input
                  type="checkbox"
                  checked={motionPreference.enabled}
                  onChange={(event) => {
                    setMotionPreference({ enabled: event.target.checked });
                  }}
                />
                <span>Allow motion controls</span>
              </label>

              <label
                className="stims-shell__field-label"
                htmlFor="render-scale"
              >
                Sharpness
              </label>
              <input
                id="render-scale"
                type="range"
                min="0.6"
                max="1.4"
                step="0.05"
                value={renderPreferences.renderScale ?? 1}
                onChange={(event) => {
                  setRenderPreferences({
                    renderScale: Number.parseFloat(event.target.value),
                  });
                }}
              />
              <p className="stims-shell__meta-copy">
                Current sharpness:{' '}
                {(renderPreferences.renderScale ?? 1).toFixed(2)}x
              </p>

              <label
                className="stims-shell__field-label"
                htmlFor="max-pixel-ratio"
              >
                Detail limit
              </label>
              <input
                id="max-pixel-ratio"
                type="range"
                min="0.75"
                max="3"
                step="0.05"
                value={renderPreferences.maxPixelRatio ?? 1.5}
                onChange={(event) => {
                  setRenderPreferences({
                    maxPixelRatio: Number.parseFloat(event.target.value),
                  });
                }}
              />
              <p className="stims-shell__meta-copy">
                Current limit:{' '}
                {(renderPreferences.maxPixelRatio ?? 1.5).toFixed(2)}x
              </p>

              <div className="stims-shell__settings-footer">
                <button
                  type="button"
                  className="cta-button"
                  onClick={() => updatePanel(null)}
                >
                  Close settings
                </button>
                {routeState.agentMode ? (
                  <button
                    type="button"
                    className="cta-button"
                    onClick={() => {
                      setStatusMessage(
                        `Current link: ${buildCanonicalUrl(routeState).pathname}${buildCanonicalUrl(routeState).search}`,
                      );
                    }}
                  >
                    Show current link
                  </button>
                ) : null}
              </div>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
