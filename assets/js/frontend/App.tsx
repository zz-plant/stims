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
import type { MilkdropCatalogEntry } from '../milkdrop/types.ts';
import { captureDisplayAudioStream } from '../ui/audio-advanced-sources.ts';
import { getIconNodes, type UiIconName } from '../ui/icon-library.ts';
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

type ReadinessItem = {
  id: string;
  label: string;
  state: 'ready' | 'warn' | 'blocked';
  summary: string;
};

type StarterLook = {
  key: string;
  label: string;
  summary: string;
  preset: PresetCatalogEntry;
};

const TOOL_TABS: Array<Exclude<PanelState, null>> = [
  'browse',
  'editor',
  'inspector',
  'settings',
];

function UiIcon({ name, className }: { name: UiIconName; className: string }) {
  const nodes = getIconNodes(name);
  const title = name.replace(/-/g, ' ');

  return (
    <span className={className} aria-hidden="true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        data-icon={name}
      >
        <title>{title}</title>
        {nodes.map(({ tag, attrs }) => {
          const key = `${name}-${tag}-${Object.entries(attrs)
            .map(([attrName, value]) => `${attrName}:${value}`)
            .join('|')}`;
          if (tag === 'path') {
            return <path key={key} {...attrs} />;
          }
          if (tag === 'circle') {
            return <circle key={key} {...attrs} />;
          }
          return <rect key={key} {...attrs} />;
        })}
      </svg>
    </span>
  );
}

function getToolLabel(tool: Exclude<PanelState, null>) {
  switch (tool) {
    case 'browse':
      return 'Looks';
    case 'editor':
      return 'Edit';
    case 'inspector':
      return 'Inspect';
    case 'settings':
      return 'Settings';
  }
}

function getToolDescription(tool: Exclude<PanelState, null>) {
  switch (tool) {
    case 'browse':
      return 'Start with a featured vibe or dive into the full preset library.';
    case 'editor':
      return 'Open the preset editor without moving the visualizer off-center.';
    case 'inspector':
      return 'Inspect the active preset and session details in place.';
    case 'settings':
      return 'Keep the defaults when they feel good, then tune only what you need.';
  }
}

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

function buildPresetSearchIndex(entry: PresetCatalogEntry) {
  return [entry.id, entry.title, entry.author, ...(entry.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function describePresetMood(entry: PresetCatalogEntry) {
  const index = buildPresetSearchIndex(entry);

  if (/(glow|sun|flare|star|light|bloom)/u.test(index)) {
    return 'Bright pulse';
  }
  if (/(cube|matrix|square|line|grid|trace)/u.test(index)) {
    return 'Sharp geometry';
  }
  if (/(quasar|ether|parallel|space|mars|radiation|vacuum)/u.test(index)) {
    return 'Space drift';
  }
  if (/(dark|ritual|apocalypse|demon|moon)/u.test(index)) {
    return 'Moody sweep';
  }
  if (/(trippy|psychaos|rotation|spectro|glassworms)/u.test(index)) {
    return 'Psychedelic spin';
  }
  if (entry.tags?.includes('collection:classic-milkdrop')) {
    return 'Classic rush';
  }
  return 'Instant pick';
}

function buildStarterLooks(entries: PresetCatalogEntry[]) {
  const usedPresetIds = new Set<string>();
  const starterLooks: StarterLook[] = [];
  const definitions = [
    {
      key: 'bright-pulse',
      label: 'Bright pulse',
      summary: 'Fast payoff with glowing motion and clean contrast.',
      matchers: [/glowsticks/u, /(sun|flare|star)/u],
    },
    {
      key: 'space-drift',
      label: 'Space drift',
      summary: 'Slower cosmic motion with more room to breathe.',
      matchers: [/(parallel universe|quasar|ether|mars|radiation)/u],
    },
    {
      key: 'sharp-geometry',
      label: 'Sharp geometry',
      summary: 'Hard edges, grids, and satisfying symmetry.',
      matchers: [/(cube|matrix|square|trace|line)/u],
    },
    {
      key: 'classic-rush',
      label: 'Classic rush',
      summary: 'A grounded first pick from the classic MilkDrop lineage.',
      matchers: [/(happy drops|casino|classic milkdrop)/u],
    },
  ];

  definitions.forEach((definition) => {
    const preset = entries.find((entry) => {
      if (usedPresetIds.has(entry.id)) {
        return false;
      }
      const index = buildPresetSearchIndex(entry);
      return definition.matchers.some((matcher) => matcher.test(index));
    });

    if (!preset) {
      return;
    }

    usedPresetIds.add(preset.id);
    starterLooks.push({ ...definition, preset });
  });

  if (starterLooks.length > 0) {
    return starterLooks;
  }

  return entries.slice(0, 3).map((preset, index) => ({
    key: `starter-${preset.id}`,
    label: ['First pick', 'Try next', 'Then go wide'][index] ?? 'Starter',
    summary: 'A quick way into the library without overthinking it.',
    preset,
  }));
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

function mapRuntimeCatalogEntry(
  entry: MilkdropCatalogEntry,
): PresetCatalogEntry {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    file: entry.bundledFile,
    tags: entry.tags,
    expectedFidelityClass: entry.fidelityClass,
    supports: {
      webgl: entry.supports.webgl.status === 'supported',
      webgpu: entry.supports.webgpu.status === 'supported',
    },
  };
}

function buildLaunchIntent(routeState: SessionRouteState): LaunchIntent {
  return {
    presetId: routeState.presetId,
    collectionTag: routeState.collectionTag,
    panel:
      routeState.panel === 'editor' || routeState.panel === 'inspector'
        ? routeState.panel
        : null,
    audioSource: routeState.audioSource,
    agentMode: routeState.agentMode,
  };
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
  const sheetTitle = routeState.panel ? getToolLabel(routeState.panel) : null;
  const sheetDescription = routeState.panel
    ? getToolDescription(routeState.panel)
    : null;
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
    ? 'The requested preset is not bundled in this build. Start with demo audio for the quickest recovery, or browse the library before you play.'
    : runtimeReady || routeState.invalidExperienceSlug
      ? 'Start demo for the quickest payoff. Mic reacts to your room. Tab capture is best when music is already playing in the browser.'
      : 'One moment while the visuals warm up.';
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
          ? `Featured first pick: ${featuredPreset.title} · ${describePresetMood(featuredPreset)}. Open Looks for curated starters or shuffle into something new.`
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
        <section
          className="stims-shell__launch"
          data-audio-controls
          hidden={launchControlsHidden}
        >
          <div className="stims-shell__launch-header">
            <div className="stims-shell__launch-copy">
              <p className="stims-shell__eyebrow">{launchEyebrow}</p>
              <h1>{launchTitle}</h1>
              <p>{launchSummary}</p>
            </div>
          </div>

          <div className="stims-shell__launch-actions">
            <button
              id="use-demo-audio"
              data-demo-audio-btn="true"
              className="cta-button primary stims-shell__action-button"
              type="button"
              disabled={!engineReady}
              onClick={() => void handleAudioStart('demo')}
            >
              <span className="stims-shell__action-label">Start demo</span>
              <span className="stims-shell__action-hint">Fastest way in</span>
            </button>
            <button
              id="start-audio-btn"
              data-mic-audio-btn="true"
              className="cta-button stims-shell__action-button"
              type="button"
              disabled={!engineReady}
              onClick={() => void handleAudioStart('microphone')}
            >
              <span className="stims-shell__action-label">Use mic</span>
              <span className="stims-shell__action-hint">
                React to the room
              </span>
            </button>
            <button
              id="use-tab-audio"
              className="cta-button stims-shell__action-button"
              type="button"
              disabled={!engineReady}
              onClick={() => void handleAudioStart('tab')}
            >
              <span className="stims-shell__action-label">Capture tab</span>
              <span className="stims-shell__action-hint">
                Best for music or video
              </span>
            </button>
          </div>

          {featuredPreset ? (
            <p className="stims-shell__launch-note">
              Recommended first run: start demo, then open Looks and try{' '}
              <strong>{featuredPreset.title}</strong>.
            </p>
          ) : null}

          <div className="stims-shell__launch-more">
            <button
              type="button"
              className="stims-shell__text-button"
              onClick={() => setShowExtendedSources((current) => !current)}
            >
              {showExtendedSources
                ? 'Hide YouTube capture'
                : 'Add YouTube capture'}
            </button>

            {showExtendedSources ? (
              <div className="stims-shell__youtube">
                <label
                  className="stims-shell__field-label"
                  htmlFor="youtube-url"
                >
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
            ) : null}
          </div>

          {readinessAlerts.length > 0 ? (
            <section className="stims-shell__readiness-chips">
              {readinessAlerts.map((item) => (
                <article
                  key={item.id}
                  className="stims-shell__readiness-chip"
                  data-state={item.state}
                >
                  <strong>{item.label}</strong>
                  <span>{item.summary}</span>
                </article>
              ))}
            </section>
          ) : null}
        </section>

        <section className="stims-shell__workspace">
          <section className="stims-shell__stage-section">
            <div className="stims-shell__stage-header">
              <div className="stims-shell__stage-copy">
                <p className="stims-shell__eyebrow">{stageEyebrow}</p>
                <h2>{stageTitle}</h2>
                <p className="stims-shell__meta-copy stims-shell__stage-summary">
                  {stageSummary}
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
              {missingRequestedPreset ? (
                <div className="stims-shell__stage-recovery">
                  <p className="stims-shell__eyebrow">Missing preset</p>
                  <h3>Load a nearby favorite instead</h3>
                  <p className="stims-shell__meta-copy">
                    This link points to a preset that is not bundled here
                    anymore. Recover with a featured look or jump into the full
                    library.
                  </p>
                  <div className="stims-shell__session-actions">
                    {featuredPreset ? (
                      <button
                        type="button"
                        className="cta-button primary"
                        onClick={handleFeaturedPresetSelection}
                      >
                        Load featured look
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="cta-button"
                      onClick={handleBrowseRecovery}
                    >
                      Browse looks
                    </button>
                  </div>
                </div>
              ) : null}
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
          </section>
        </section>
      </main>

      {routeState.panel ? (
        <>
          {!stageAnchoredToolOpen ? (
            <button
              type="button"
              className="stims-shell__sheet-backdrop"
              aria-label="Close tools"
              onClick={() => updatePanel(null)}
            />
          ) : null}
          <aside className="stims-shell__sheet" aria-label="Tools">
            <div className="stims-shell__sheet-header">
              <div className="stims-shell__sheet-heading">
                <h2>{sheetTitle}</h2>
                <p className="stims-shell__meta-copy">{sheetDescription}</p>
              </div>
              <button
                type="button"
                className="stims-shell__icon-button"
                onClick={() => updatePanel(null)}
              >
                <UiIcon
                  name="close"
                  className="stims-shell__button-icon stims-icon-slot stims-icon-slot--sm"
                />
                <span className="stims-shell__button-label">Close</span>
              </button>
            </div>

            <nav className="stims-shell__tool-tabs" aria-label="Tool sections">
              {TOOL_TABS.map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className="stims-shell__sheet-tab"
                  data-active={String(routeState.panel === tool)}
                  onClick={() => updatePanel(tool)}
                >
                  {getToolLabel(tool)}
                </button>
              ))}
            </nav>

            <div className="stims-shell__sheet-body">
              {routeState.panel === 'browse' ? (
                <div className="stims-shell__sheet-panel">
                  {starterLooks.length > 0 ? (
                    <section className="stims-shell__starter-grid">
                      {starterLooks.map((starterLook) => (
                        <button
                          key={starterLook.key}
                          type="button"
                          className="stims-shell__starter-card"
                          onClick={() =>
                            handlePresetSelection(starterLook.preset.id)
                          }
                        >
                          <span className="stims-shell__starter-label">
                            {starterLook.label}
                          </span>
                          <span className="stims-shell__starter-summary">
                            {starterLook.summary}
                          </span>
                          <span className="stims-shell__starter-preset">
                            {starterLook.preset.title}
                          </span>
                        </button>
                      ))}
                    </section>
                  ) : null}

                  <div className="stims-shell__browse-toolbar">
                    <p className="stims-shell__meta-copy">
                      Start with a featured vibe or search the full library.
                    </p>
                    <button
                      type="button"
                      className="stims-shell__text-button"
                      onClick={handleShufflePreset}
                      disabled={catalog.length === 0}
                    >
                      Shuffle a look
                    </button>
                  </div>

                  <label
                    className="stims-shell__field-label"
                    htmlFor="preset-search"
                  >
                    Search
                  </label>
                  <input
                    id="preset-search"
                    className="stims-shell__input"
                    type="search"
                    placeholder="Search vibe, title, author, or tag"
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
                    <p className="stims-shell__meta-copy">Loading catalog…</p>
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
                          <span className="stims-shell__preset-vibe">
                            {describePresetMood(entry)}
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
                </div>
              ) : null}

              {routeState.panel === 'settings' ? (
                <div className="stims-shell__sheet-panel">
                  <div className="stims-shell__settings-callout">
                    <p className="stims-shell__eyebrow">Recommended</p>
                    <strong>
                      Stay on Balanced unless the picture feels rough.
                    </strong>
                    <p className="stims-shell__meta-copy">
                      Safer graphics mode helps older devices. The sliders below
                      are only for fine tuning when you need a softer or
                      steadier picture.
                    </p>
                  </div>

                  <p className="stims-shell__section-label">Quick tune</p>
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
                      engineRef.current?.setQualityPreset(event.target.value);
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

                  <p className="stims-shell__section-label">Advanced tuning</p>
                  <p className="stims-shell__meta-copy">
                    Use these only when you want a sharper image or need to calm
                    the frame rate on a busy preset.
                  </p>

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
                </div>
              ) : null}

              {routeState.panel === 'editor' ||
              routeState.panel === 'inspector' ? (
                <div className="stims-shell__sheet-callout">
                  <p className="stims-shell__eyebrow">Advanced tool</p>
                  <h3>
                    {routeState.panel === 'editor'
                      ? 'Editor is open on the stage.'
                      : 'Inspector is open on the stage.'}
                  </h3>
                  <p className="stims-shell__meta-copy">
                    Keep the visualizer in view while the tool stays anchored to
                    the canvas. Use the tabs above to jump back to Looks or
                    Settings.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="stims-shell__sheet-footer">
              <div className="stims-shell__session-actions">
                <button
                  type="button"
                  className="cta-button"
                  onClick={() => engineRef.current?.exportPreset()}
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
                {routeState.agentMode ? (
                  <button
                    type="button"
                    className="cta-button"
                    onClick={() => {
                      const currentUrl = buildCanonicalUrl(routeState);
                      setStatusMessage(
                        `Current link: ${currentUrl.pathname}${currentUrl.search}`,
                      );
                    }}
                  >
                    Show current link
                  </button>
                ) : null}
              </div>
            </div>
          </aside>
        </>
      ) : null}

      {toast ? (
        <output
          className="stims-shell__toast"
          data-tone={toast.tone}
          aria-live="polite"
        >
          <span>{toast.message}</span>
          <button
            type="button"
            className="stims-shell__toast-dismiss"
            onClick={() => setToast(null)}
          >
            Dismiss
          </button>
        </output>
      ) : null}
    </div>
  );
}
