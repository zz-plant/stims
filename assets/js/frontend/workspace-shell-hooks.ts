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
  const enrichedCatalog = useMemo(() => {
    const runtimeCatalog = (engineSnapshot?.catalogEntries ?? []).map(
      mapRuntimeCatalogEntry,
    );
    const runtimeCatalogReady =
      (engineSnapshot?.runtimeReady ?? false) || runtimeCatalog.length > 0;
    const rawCatalog = runtimeCatalogReady ? runtimeCatalog : fallbackCatalog;
    return mergeCatalogActivity(rawCatalog, activityCatalog);
  }, [engineSnapshot, fallbackCatalog, activityCatalog]);

  const catalogReady = useMemo(
    () =>
      (engineSnapshot?.runtimeReady ?? false) ||
      (engineSnapshot?.catalogEntries ?? []).length > 0 ||
      fallbackCatalogReady,
    [engineSnapshot, fallbackCatalogReady],
  );

  const catalogError = useMemo(() => null, []);

  const filteredCatalog = useMemo(
    () =>
      enrichedCatalog.filter((entry) => {
        if (
          routeState.collectionTag &&
          !entry.tags?.includes(routeState.collectionTag)
        ) {
          return false;
        }
        return matchesPreset(entry, deferredSearch);
      }),
    [enrichedCatalog, routeState.collectionTag, deferredSearch],
  );

  const currentPreset = useMemo(
    () =>
      filteredCatalog.find(
        (entry) => entry.id === engineSnapshot?.activePresetId,
      ) ??
      enrichedCatalog.find(
        (entry) => entry.id === engineSnapshot?.activePresetId,
      ) ??
      null,
    [filteredCatalog, enrichedCatalog, engineSnapshot?.activePresetId],
  );

  const starterPresets = useMemo(
    () => buildStarterPresets(enrichedCatalog),
    [enrichedCatalog],
  );

  const featuredPreset = useMemo(
    () => starterPresets[0]?.preset ?? enrichedCatalog[0] ?? null,
    [starterPresets, enrichedCatalog],
  );

  const resolvedRequestedPreset = useMemo(
    () =>
      routeState.presetId
        ? resolvePresetCatalogEntry(enrichedCatalog, routeState.presetId)
        : null,
    [enrichedCatalog, routeState.presetId],
  );

  const selectedPreset = useMemo(
    () => resolvedRequestedPreset ?? currentPreset ?? null,
    [resolvedRequestedPreset, currentPreset],
  );

  const launchControlsHidden = useMemo(
    () =>
      engineSnapshot?.audioActive ||
      document.body.dataset.audioActive === 'true',
    [engineSnapshot?.audioActive],
  );

  const runtimeReady = useMemo(
    () => Boolean(engineSnapshot?.runtimeReady),
    [engineSnapshot?.runtimeReady],
  );

  const engineReady = useMemo(
    () => fallbackCatalogError === null,
    [fallbackCatalogError],
  );

  const missingRequestedPreset = Boolean(
    routeState.presetId &&
      catalogReady &&
      !resolvedRequestedPreset &&
      pendingPresetIdRef.current !== routeState.presetId,
  );

  const loadingRequestedPreset = Boolean(
    routeState.presetId && !selectedPreset && !missingRequestedPreset,
  );

  const shellState = useMemo(
    () => ({
      catalog: enrichedCatalog,
      catalogError,
      catalogReady: catalogReady,
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
      runtimeReady,
      selectedPreset,
      starterPresets,
      stageAnchoredToolOpen:
        routeState.panel === 'editor' || routeState.panel === 'inspector',
    }),
    [
      enrichedCatalog,
      catalogError,
      catalogReady,
      currentPreset,
      engineReady,
      featuredPreset,
      filteredCatalog,
      launchControlsHidden,
      loadingRequestedPreset,
      missingRequestedPreset,
      routeState.panel,
      runtimeReady,
      selectedPreset,
      starterPresets,
    ],
  );

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
    const scatterWeight = (entry: PresetCatalogEntry) => {
      const fidelityClass = entry.visualCertification?.fidelityClass;
      const fidelityWeight =
        fidelityClass === 'exact'
          ? 8
          : fidelityClass === 'near-exact'
            ? 6
            : fidelityClass === 'partial'
              ? 4
              : 2;
      const favoriteWeight = entry.isFavorite ? 6 : 0;
      const historyBonus =
        entry.historyIndex !== undefined && entry.historyIndex >= 0 ? 3 : 0;
      const recentPenalty =
        entry.lastOpenedAt && entry.lastOpenedAt > Date.now() - 300_000
          ? -4
          : 0;
      return Math.max(
        1,
        fidelityWeight + favoriteWeight + historyBonus + recentPenalty,
      );
    };
    const scoredPool = nextPool.map((entry) => ({
      entry,
      weight: scatterWeight(entry),
    }));
    const totalWeight = scoredPool.reduce((sum, s) => sum + s.weight, 0);
    let roll = Math.random() * totalWeight;
    const picked = scoredPool.find((s) => {
      roll -= s.weight;
      return roll <= 0;
    });

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

  const handlePlayPreset = async (presetId: string) => {
    try {
      setStatusMessage(null);
      const nextRouteState = {
        ...routeState,
        audioSource: 'demo' as const,
        panel: null,
        presetId,
      };
      commitRoute(nextRouteState);
      await startAudioSource({ source: 'demo', launchState: nextRouteState });
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Audio start failed.',
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

      if (source === 'microphone') {
        commitRoute(nextRouteState);
        if (!navigator.mediaDevices?.getUserMedia) {
          setStatusMessage(
            'Microphone capture is not available in this browser.',
          );
          return;
        }
        try {
          const permissionStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          permissionStream.getTracks().forEach((t) => t.stop());
        } catch (error) {
          throw new Error(
            error instanceof DOMException && error.name === 'NotAllowedError'
              ? 'Microphone access was denied. Check browser settings and try again.'
              : 'Unable to access microphone.',
          );
        }
        await startAudioSource({ source, launchState: nextRouteState });
        return;
      }

      if (source === 'demo') {
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

  const handleAudioStop = () => {
    commitRoute({ ...routeState, audioSource: null });
    setStatusMessage('Audio stopped.');
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
    handleAudioStop,
    handleBrowseRecovery,
    handleFeaturedPresetSelection,
    handleImport,
    handlePlayPreset,
    handlePresetSelection,
    handleShowCurrentLink,
    handleAudioFile,
    handleShufflePreset,
    readinessAlerts,
    updatePanel,
  };
}
