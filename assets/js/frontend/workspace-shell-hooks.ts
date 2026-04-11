import { useEffect, useMemo } from 'react';
import { captureDisplayAudioStream } from '../ui/audio-advanced-sources.ts';
import type {
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import type { EngineSnapshot } from './engine/milkdrop-engine-adapter.ts';
import { buildCanonicalUrl } from './url-state.ts';
import {
  buildStarterLooks,
  getCollectionTags,
  mapRuntimeCatalogEntry,
  matchesPreset,
  type ReadinessItem,
} from './workspace-helpers.ts';

type WorkspaceShellOrchestrationArgs = {
  commitRoute: (nextState: SessionRouteState) => void;
  deferredSearch: string;
  engineSnapshot: EngineSnapshot | null;
  fallbackCatalog: PresetCatalogEntry[];
  fallbackCatalogError: string | null;
  fallbackCatalogReady: boolean;
  importPresetFiles: (files: FileList | null) => Promise<void>;
  pendingPresetIdRef: { current: string | null };
  readinessItems: ReadinessItem[];
  routeState: SessionRouteState;
  setStatusMessage: (message: string | null) => void;
  showToast: (message: string, tone?: 'info' | 'warn' | 'error') => void;
  startAudioSource: (request: {
    cropTarget?: HTMLElement | null;
    source: 'demo' | 'microphone' | 'tab' | 'youtube';
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
  importPresetFiles,
  pendingPresetIdRef,
  readinessItems,
  routeState,
  setStatusMessage,
  showToast,
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

    const starterLooks = buildStarterLooks(catalog);
    const featuredPreset = starterLooks[0]?.preset ?? catalog[0] ?? null;
    const launchControlsHidden =
      engineSnapshot?.audioActive ||
      document.body.dataset.audioActive === 'true';
    const runtimeReady =
      Boolean(engineSnapshot?.runtimeReady) &&
      !routeState.invalidExperienceSlug;
    const resolvedBackend =
      engineSnapshot?.backend ??
      (document.body.dataset.activeBackend === 'webgl'
        ? 'webgl'
        : document.body.dataset.activeBackend === 'webgpu'
          ? 'webgpu'
          : null);
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

    return {
      catalog,
      catalogError,
      catalogReady,
      collectionTags: getCollectionTags(catalog),
      currentPreset,
      engineReady: runtimeReady,
      featuredPreset,
      filteredCatalog,
      launchControlsHidden,
      loadingRequestedPreset,
      missingRequestedPreset,
      resolvedBackend,
      runtimeReady,
      selectedPreset,
      stageAnchoredToolOpen:
        routeState.panel === 'editor' || routeState.panel === 'inspector',
    };
  }, [
    deferredSearch,
    engineSnapshot,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    pendingPresetIdRef,
    routeState,
  ]);

  const readinessAlerts = useMemo(
    () => readinessItems.filter((item) => item.state !== 'ready'),
    [readinessItems],
  );

  useEffect(() => {
    if (!shellState.runtimeReady || shellState.resolvedBackend !== 'webgl') {
      return;
    }

    showToast('Using a lighter visual mode on this device.', 'warn');
  }, [shellState.resolvedBackend, shellState.runtimeReady, showToast]);

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

      if (source === 'demo' || source === 'microphone') {
        commitRoute({ ...routeState, audioSource: source, panel: null });
        await startAudioSource({ source });
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
      await startAudioSource({
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

  const handleImport = async (files: FileList | null) => {
    await importPresetFiles(files);
    updatePanel('editor');
  };

  const handleShowCurrentLink = () => {
    const currentUrl = buildCanonicalUrl(routeState);
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
    handleShufflePreset,
    readinessAlerts,
    updatePanel,
  };
}
