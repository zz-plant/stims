import { useMemo } from 'react';
import { resolvePresetCatalogEntry } from '../milkdrop/preset-id-resolution.ts';
import { captureDisplayAudioStream } from '../ui/audio-advanced-sources.ts';
import { shareOrCopyLink } from '../utils/share-link.ts';
import type {
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import type { EngineSnapshot } from './engine/milkdrop-engine-adapter.ts';
import { buildCanonicalUrl } from './url-state.ts';
import {
  buildStarterPresets,
  getCollectionTags,
  mapRuntimeCatalogEntry,
  matchesPreset,
  mergeCatalogActivity,
  pickFavoritePresets,
  pickRecentPresets,
  type ReadinessItem,
} from './workspace-helpers.ts';

type WorkspaceShellOrchestrationArgs = {
  commitRoute: (nextState: SessionRouteState) => void;
  deferredSearch: string;
  engineSnapshot: EngineSnapshot | null;
  fallbackCatalog: PresetCatalogEntry[];
  fallbackCatalogError: string | null;
  fallbackCatalogReady: boolean;
  activityCatalog: PresetCatalogEntry[];
  importPresetFiles: (files: FileList | null) => Promise<void>;
  pendingPresetIdRef: { current: string | null };
  readinessItems: ReadinessItem[];
  routeState: SessionRouteState;
  setStatusMessage: (message: string | null) => void;
  startAudioSource: (request: {
    cropTarget?: HTMLElement | null;
    launchState?: SessionRouteState;
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file';
    stream?: MediaStream;
  }) => Promise<void>;
  youtubePreviewRef: { current: HTMLDivElement | null };
};

export function useWorkspaceShellOrchestration({
  commitRoute,
  deferredSearch,
  engineSnapshot,
  fallbackCatalog,
  fallbackCatalogError,
  fallbackCatalogReady,
  activityCatalog,
  importPresetFiles,
  pendingPresetIdRef,
  readinessItems,
  routeState,
  setStatusMessage,
  startAudioSource,
  youtubePreviewRef,
}: WorkspaceShellOrchestrationArgs) {
  const shellState = useMemo(() => {
    const runtimeCatalog = (engineSnapshot?.catalogEntries ?? []).map(
      mapRuntimeCatalogEntry,
    );
    const runtimeCatalogReady =
      (engineSnapshot?.runtimeReady ?? false) || runtimeCatalog.length > 0;
    const catalog = routeState.invalidExperienceSlug
      ? fallbackCatalog
      : runtimeCatalogReady
        ? runtimeCatalog
        : fallbackCatalog;
    const enrichedCatalog = mergeCatalogActivity(catalog, activityCatalog);
    const catalogReady = routeState.invalidExperienceSlug
      ? fallbackCatalogReady
      : runtimeCatalogReady || fallbackCatalogReady;
    const catalogError = routeState.invalidExperienceSlug
      ? fallbackCatalogError
      : null;

    const filteredCatalog = enrichedCatalog.filter((entry) => {
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
      enrichedCatalog.find(
        (entry) => entry.id === engineSnapshot?.activePresetId,
      ) ??
      null;

    const starterPresets = buildStarterPresets(enrichedCatalog);
    const featuredPreset =
      starterPresets[0]?.preset ?? enrichedCatalog[0] ?? null;
    const launchControlsHidden =
      engineSnapshot?.audioActive ||
      document.body.dataset.audioActive === 'true';
    const runtimeReady =
      Boolean(engineSnapshot?.runtimeReady) &&
      !routeState.invalidExperienceSlug;
    const engineReady =
      !routeState.invalidExperienceSlug && fallbackCatalogError === null;
    const resolvedBackend =
      engineSnapshot?.backend ??
      (document.body.dataset.activeBackend === 'webgl'
        ? 'webgl'
        : document.body.dataset.activeBackend === 'webgpu'
          ? 'webgpu'
          : null);
    const resolvedRequestedPreset = routeState.presetId
      ? resolvePresetCatalogEntry(enrichedCatalog, routeState.presetId)
      : null;
    const selectedPreset = resolvedRequestedPreset ?? currentPreset ?? null;
    const missingRequestedPreset = Boolean(
      routeState.presetId &&
        catalogReady &&
        !resolvedRequestedPreset &&
        !routeState.invalidExperienceSlug &&
        pendingPresetIdRef.current !== routeState.presetId,
    );
    const loadingRequestedPreset = Boolean(
      routeState.presetId &&
        !selectedPreset &&
        !routeState.invalidExperienceSlug &&
        !missingRequestedPreset,
    );

    return {
      catalog: enrichedCatalog,
      catalogError,
      catalogReady,
      collectionTags: getCollectionTags(enrichedCatalog),
      currentPreset,
      engineReady,
      favoritePresets: pickFavoritePresets(enrichedCatalog),
      featuredPreset,
      filteredCatalog,
      launchControlsHidden,
      loadingRequestedPreset,
      missingRequestedPreset,
      recentPresets: pickRecentPresets(enrichedCatalog),
      resolvedBackend,
      runtimeReady,
      selectedPreset,
      starterPresets,
      stageAnchoredToolOpen:
        routeState.panel === 'editor' || routeState.panel === 'inspector',
    };
  }, [
    deferredSearch,
    engineSnapshot,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    activityCatalog,
    pendingPresetIdRef,
    routeState,
  ]);

  const readinessAlerts = useMemo(
    () => readinessItems.filter((item) => item.state !== 'ready'),
    [readinessItems],
  );

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
    if (!shellState.featuredPreset) {
      return;
    }

    handlePresetSelection(shellState.featuredPreset.id);
  };

  const handleShufflePreset = () => {
    const activePresetId =
      routeState.presetId ?? engineSnapshot?.activePresetId;
    const preferredPool =
      shellState.filteredCatalog.length > 1
        ? shellState.filteredCatalog
        : shellState.catalog.length > 1
          ? shellState.catalog
          : [];
    const shuffledPool = preferredPool.filter(
      (entry) => entry.id !== activePresetId,
    );
    const fallbackPool =
      shellState.filteredCatalog.length > 0
        ? shellState.filteredCatalog
        : shellState.catalog;
    const nextPool = shuffledPool.length > 0 ? shuffledPool : fallbackPool;
    if (!nextPool.length) {
      return;
    }
    const fidelityScore = (entry: PresetCatalogEntry) => {
      const fidelityClass = entry.visualCertification?.fidelityClass;
      if (fidelityClass === 'exact') return 4;
      if (fidelityClass === 'near-exact') return 3;
      if (fidelityClass === 'partial') return 2;
      return 1;
    };
    const scoredPool = nextPool.map((entry) => ({
      entry,
      weight: fidelityScore(entry),
    }));
    const highestScore = Math.max(...scoredPool.map((s) => s.weight), 1);
    const topPool = scoredPool.filter((s) => s.weight >= highestScore);
    const drawPool = topPool.length > 0 ? topPool : scoredPool;

    const picked = drawPool[Math.floor(Math.random() * drawPool.length)];
    const nextPreset = picked?.entry ?? nextPool[0];
    if (!nextPreset) {
      return;
    }

    handlePresetSelection(nextPreset.id);
  };

  const handleAudioFile = async (file: File) => {
    if (
      !file.type.startsWith('audio/') &&
      !file.name.match(/\.(mp3|wav|flac|ogg|m4a|aac|opus|webm)$/i)
    ) {
      return;
    }
    try {
      setStatusMessage(null);
      const audioContext = new AudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      source.connect(audioContext.destination);
      source.start(0);

      const healedPresetId = shellState.missingRequestedPreset
        ? (shellState.featuredPreset?.id ?? null)
        : routeState.presetId;
      const nextRouteState = {
        ...routeState,
        audioSource: 'file' as const,
        panel: null,
        presetId: healedPresetId,
      };

      if (shellState.missingRequestedPreset && shellState.featuredPreset) {
        setStatusMessage(
          `Requested preset unavailable. Starting with ${shellState.featuredPreset.title}.`,
        );
      }

      commitRoute(nextRouteState);
      await startAudioSource({
        source: 'file',
        stream: destination.stream,
        launchState: nextRouteState,
      });
      setStatusMessage(`Playing: ${file.name}`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to play audio file.',
      );
    }
  };

  const handleAudioStart = async (
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file',
  ) => {
    try {
      setStatusMessage(null);
      const healedPresetId = shellState.missingRequestedPreset
        ? (shellState.featuredPreset?.id ?? null)
        : routeState.presetId;
      const nextRouteState = {
        ...routeState,
        audioSource: source,
        panel: null,
        presetId: healedPresetId,
      };

      if (shellState.missingRequestedPreset && shellState.featuredPreset) {
        setStatusMessage(
          `Requested preset unavailable. Starting with ${shellState.featuredPreset.title}.`,
        );
      }

      if (source === 'demo' || source === 'microphone') {
        commitRoute(nextRouteState);
        await startAudioSource({ source, launchState: nextRouteState });
        return;
      }

      const stream = await captureDisplayAudioStream({
        unavailableMessage: 'Display capture is unavailable in this browser.',
        missingAudioMessage:
          source === 'youtube'
            ? 'No YouTube audio track was captured. Choose This tab and enable Share audio.'
            : 'No tab audio track was captured. Choose This tab and enable Share audio.',
      });
      commitRoute(nextRouteState);
      await startAudioSource({
        source,
        stream,
        cropTarget: youtubePreviewRef.current,
        launchState: nextRouteState,
      });
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Audio start failed.',
      );
    }
  };

  const handleImport = async (files: FileList | null) => {
    await importPresetFiles(files);
    updatePanel('editor');
  };

  const handleShowCurrentLink = async () => {
    const currentUrl = buildCanonicalUrl(
      { ...routeState, agentMode: false },
      window.location,
    );
    const href = currentUrl.toString();
    const result = await shareOrCopyLink(href, {
      title: 'Stims visualizer',
      text: 'Open this Stims visualizer view.',
    });

    if (result === 'shared') {
      setStatusMessage('Link shared.');
      return;
    }

    if (result === 'copied') {
      setStatusMessage('Link copied.');
      return;
    }

    if (result === 'cancelled') {
      return;
    }

    setStatusMessage(
      `Current link: ${currentUrl.pathname}${currentUrl.search}`,
    );
  };

  return {
    ...shellState,
    handleAudioStart,
    handleBrowseRecovery,
    handleFeaturedPresetSelection,
    handleImport,
    handlePresetSelection,
    handleShowCurrentLink,
    handleAudioFile,
    handleShufflePreset,
    readinessAlerts,
    updatePanel,
  };
}
