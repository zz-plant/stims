import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { MotionPreference } from '../core/motion-preferences.ts';
import type { QualityPreset } from '../core/settings-panel.ts';
import type { RenderPreferences } from '../core/state/render-preference-store.ts';
import type {
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import type { EngineSnapshot } from './engine/engine-snapshot.ts';
import {
  setAudioBandScalars,
  setAudioEnergy,
} from './engine-audio-energy-store.ts';
import {
  type EngineContextValue,
  EngineCtx,
  EngineProvider,
  type EngineSnapshotValue,
} from './engine-context.tsx';
import { setEngineQualityState } from './engine-quality-store.ts';
import { usePersistentPresetQueue } from './preset-queue.ts';
import {
  useWorkspaceRouteState,
  useWorkspaceSessionState,
} from './workspace-hooks.ts';
import { useWorkspaceShellOrchestration } from './workspace-shell-hooks.ts';

export interface WorkspaceContextValue {
  routeState: SessionRouteState;
  commitRoute: (nextState: SessionRouteState) => void;
  setRouteState: React.Dispatch<React.SetStateAction<SessionRouteState>>;

  deferredSearch: string;
  motionPreference: MotionPreference;
  pendingPresetIdRef: { current: string | null };
  qualityPreset: QualityPreset;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  setStatusMessage: (message: string | null) => void;
  showExtendedSources: boolean;
  stageRef: React.RefObject<HTMLDivElement | null>;
  toast: {
    message: string;
    tone: 'info' | 'warn' | 'error';
  } | null;
  dismissToast: () => void;
  toggleExtendedSources: () => void;
  setYoutubeUrl: (url: string) => void;
  youtubeCanLoad: boolean;
  youtubeFeedback: string;
  youtubeInputInvalid: boolean;
  youtubeLoading: boolean;
  youtubePreviewRef: React.RefObject<HTMLDivElement | null>;
  youtubeReady: boolean;
  youtubeTransport: {
    currentSeconds: number;
    durationSeconds: number;
    paused: boolean;
  } | null;
  youtubeTransportControls: {
    play: () => void;
    pause: () => void;
    seekTo: (seconds: number) => void;
    nudge: (deltaSeconds: number) => void;
  };
  youtubeUrl: string;
  recentYouTubeVideos: Array<{
    id: string;
    title: string;
    thumbnail?: string;
    author?: string;
  }>;
  renderPreferences: RenderPreferences;
  fallbackCatalog: PresetCatalogEntry[];
  fallbackCatalogError: string | null;
  fallbackCatalogReady: boolean;
  activityCatalog: PresetCatalogEntry[];
  presetQueue: {
    presetIds: string[];
    entries: PresetCatalogEntry[];
    add: (presetId: string) => void;
    remove: (presetId: string) => void;
    clear: () => void;
    move: (presetId: string, direction: -1 | 1) => void;
    popNext: () => string | null;
  };

  handleBrowseRecovery: () => void;
  handleFeaturedPresetSelection: () => void;
  handleImport: (files: FileList | File[] | null) => Promise<void>;
  handleShowCurrentLink: () => Promise<void>;
  updatePanel: (panel: PanelState) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useUI(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useUI must be used within a WorkspaceProvider');
  }
  return ctx;
}

export { useEngine, useEngineSnapshot } from './engine-context.tsx';

export function useWorkspace(): {
  ui: WorkspaceContextValue;
  engine: EngineContextValue;
} {
  const ui = useUI();
  const engine = useContext(EngineCtx);
  if (!engine) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return { ui, engine };
}

/**
 * Supplies workspace/engine context values directly, without booting the
 * session hooks that `WorkspaceProvider` owns. This is the seam tests render
 * panels through, so behavioral assertions can query real DOM output instead
 * of grepping component source text.
 */
export function WorkspaceValueProvider({
  ui,
  engine,
  snapshot,
  children,
}: {
  ui: WorkspaceContextValue;
  engine: EngineContextValue;
  snapshot: EngineSnapshotValue;
  children: ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={ui}>
      <EngineProvider snapshot={snapshot} data={engine}>
        {children}
      </EngineProvider>
    </WorkspaceContext.Provider>
  );
}

/**
 * Coarse-field equality for the engine snapshot context value. The snapshot
 * rebuilds per frame while audio plays (audioEnergy/bass/mid/treble churn), so
 * the context deliberately skips those four fields — they flow through the
 * dedicated audio-energy store instead. Every other snapshot field MUST be
 * compared here: any field left out silently stops propagating to
 * useEngineSnapshot consumers until an included field happens to change
 * (this is how setBlendDuration appeared to "not take effect" until a page
 * reload — the setter and the runtime were correct, the context memo swallowed
 * the update).
 *
 * `currentSource` derives from `sessionState.source`, so the `sessionState`
 * identity check covers it.
 *
 * Exported for unit tests.
 */
export function coarseEngineSnapshotEqual(
  prev: EngineSnapshot,
  snap: EngineSnapshot,
): boolean {
  return (
    prev.activePresetId === snap.activePresetId &&
    prev.backend === snap.backend &&
    prev.status === snap.status &&
    prev.runtimeReady === snap.runtimeReady &&
    prev.audioActive === snap.audioActive &&
    prev.audioSource === snap.audioSource &&
    prev.audioEndedAt === snap.audioEndedAt &&
    prev.adaptiveQuality === snap.adaptiveQuality &&
    prev.catalogEntries === snap.catalogEntries &&
    prev.sessionState === snap.sessionState &&
    prev.tempoBpm === snap.tempoBpm &&
    prev.shaderExecution === snap.shaderExecution &&
    prev.autoplay === snap.autoplay &&
    prev.transitionMode === snap.transitionMode &&
    prev.blendDuration === snap.blendDuration
  );
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { commitRoute, routeState, setRouteState } = useWorkspaceRouteState();

  const sessionState = useWorkspaceSessionState({ routeState, setRouteState });

  const shellOrchestration = useWorkspaceShellOrchestration({
    commitRoute,
    deferredSearch: sessionState.deferredSearch,
    engineSnapshot: sessionState.engineSnapshot,
    fallbackCatalog: sessionState.fallbackCatalog,
    fallbackCatalogError: sessionState.fallbackCatalogError,
    fallbackCatalogReady: sessionState.fallbackCatalogReady,
    fullCatalogReady: sessionState.fullCatalogReady,
    activityCatalog: sessionState.activityCatalog,
    goBackPreset: sessionState.goBackPreset,
    importPresetFiles: sessionState.importPresetFiles,
    routeState,
    setStatusMessage: sessionState.setStatusMessage,
    startAudioSource: sessionState.startAudioSource,
    youtubePreviewRef: sessionState.youtubePreviewRef,
    updateEditorSource: sessionState.updateEditorSource,
    stageRef: sessionState.stageRef,
  });

  const coarseRef = useRef<EngineSnapshotValue['engineSnapshot']>(null);
  // The context VALUE wrapper must also keep its identity when the coarse
  // fields are unchanged — returning a fresh `{ engineSnapshot: prev }` per
  // snapshot tick re-rendered every useEngineSnapshot consumer at frame rate
  // while audio played (the snapshot itself rebuilds per frame on
  // audioEnergy), which showed up as continuous 60-80ms long tasks whenever
  // a panel with catalog rows was open.
  const coarseValueRef = useRef<EngineSnapshotValue | null>(null);
  const presetQueue = usePersistentPresetQueue(shellOrchestration.catalog);

  useEffect(() => {
    const snap = sessionState.engineSnapshot;
    if (snap) {
      setAudioEnergy(snap.audioEnergy);
      setAudioBandScalars(snap.audioBass, snap.audioMid, snap.audioTreble);
      setEngineQualityState(
        snap.adaptiveQuality
          ? {
              step: snap.adaptiveQuality.qualityStep,
              stepCount: snap.adaptiveQuality.qualityStepCount,
            }
          : null,
      );
    }
  }, [sessionState.engineSnapshot]);

  const engineSnapshotValue: EngineSnapshotValue = useMemo(() => {
    const snap = sessionState.engineSnapshot;
    const prev = coarseRef.current;
    if (
      prev &&
      snap &&
      coarseValueRef.current &&
      coarseEngineSnapshotEqual(prev, snap)
    ) {
      return coarseValueRef.current;
    }
    coarseRef.current = snap;
    coarseValueRef.current = { engineSnapshot: snap };
    return coarseValueRef.current;
  }, [sessionState.engineSnapshot]);

  const engineDataValue: EngineContextValue = useMemo(
    () => ({
      presetPreviews: sessionState.presetPreviews,
      catalog: shellOrchestration.catalog,
      catalogError: shellOrchestration.catalogError,
      catalogReady: shellOrchestration.catalogReady,
      collectionTags: shellOrchestration.collectionTags,
      engineReady: shellOrchestration.engineReady,
      favoritePresets: shellOrchestration.favoritePresets,
      featuredPreset: shellOrchestration.featuredPreset,
      filteredCatalog: shellOrchestration.filteredCatalog,
      audioActive: shellOrchestration.audioActive,
      loadingRequestedPreset: shellOrchestration.loadingRequestedPreset,
      missingRequestedPreset: shellOrchestration.missingRequestedPreset,
      recentPresets: shellOrchestration.recentPresets,
      selectedPreset: shellOrchestration.selectedPreset,
      starterPresets: shellOrchestration.starterPresets,
      handleAudioStart: shellOrchestration.handleAudioStart,
      handleAudioStop: shellOrchestration.handleAudioStop,
      handlePresetSelection: shellOrchestration.handlePresetSelection,
      handlePreviousPreset: shellOrchestration.handlePreviousPreset,
      handlePlayPreset: shellOrchestration.handlePlayPreset,
      handleShufflePreset: shellOrchestration.handleShufflePreset,
      exportPreset: sessionState.exportPreset,
      revertEditorSource: sessionState.revertEditorSource,
      duplicatePreset: sessionState.duplicatePreset,
      deleteActivePreset: sessionState.deleteActivePreset,
      getVideoExportRuntime: sessionState.getVideoExportRuntime,
      importPresetFiles: sessionState.importPresetFiles,
      requestPresetPreviews: sessionState.requestPresetPreviews,
      refreshPresetPreviews: sessionState.refreshPresetPreviews,
      pausePreview: sessionState.pausePreview,
      resumePreview: sessionState.resumePreview,
      startAudioSource: sessionState.startAudioSource,
      toggleFavoritePreset: sessionState.toggleFavoritePreset,
      loadRecentYouTubeVideo: sessionState.loadRecentYouTubeVideo,
      loadYouTubePreview: sessionState.loadYouTubePreview,
      clearRecentYouTubeVideos: sessionState.clearRecentYouTubeVideos,
      handleYoutubeUrlKeyDown: sessionState.handleYoutubeUrlKeyDown,
      setQualityPreset: sessionState.setQualityPreset,
      setAutoplay: sessionState.setAutoplay,
      setTransitionMode: sessionState.setTransitionMode,
      startManualCrossfade: sessionState.startManualCrossfade,
      setCrossfade: sessionState.setCrossfade,
      getCrossfade: sessionState.getCrossfade,
      setBlendDuration: sessionState.setBlendDuration,
      updateEditorSource: sessionState.updateEditorSource,
      updateFieldLive: sessionState.updateFieldLive,
      applyEditorSourceAwaited: sessionState.applyEditorSourceAwaited,
      applyEditorFieldsAwaited: sessionState.applyEditorFieldsAwaited,
      getEditorSessionState: sessionState.getEditorSessionState,
      updateInspectorField: sessionState.updateInspectorField,
      getActiveCompiledPreset: sessionState.getActiveCompiledPreset,
      handleVisualSearch: shellOrchestration.handleVisualSearch,
    }),
    [
      sessionState.presetPreviews,
      shellOrchestration.catalog,
      shellOrchestration.catalogError,
      shellOrchestration.catalogReady,
      shellOrchestration.collectionTags,
      shellOrchestration.engineReady,
      shellOrchestration.favoritePresets,
      shellOrchestration.featuredPreset,
      shellOrchestration.filteredCatalog,
      shellOrchestration.loadingRequestedPreset,
      shellOrchestration.missingRequestedPreset,
      shellOrchestration.recentPresets,
      shellOrchestration.selectedPreset,
      shellOrchestration.starterPresets,
      shellOrchestration.audioActive,
      shellOrchestration.handleAudioStart,
      shellOrchestration.handleAudioStop,
      shellOrchestration.handlePresetSelection,
      shellOrchestration.handlePreviousPreset,
      shellOrchestration.handlePlayPreset,
      shellOrchestration.handleShufflePreset,
      sessionState.exportPreset,
      sessionState.revertEditorSource,
      sessionState.duplicatePreset,
      sessionState.deleteActivePreset,
      sessionState.getVideoExportRuntime,
      sessionState.importPresetFiles,
      sessionState.requestPresetPreviews,
      sessionState.refreshPresetPreviews,
      sessionState.pausePreview,
      sessionState.resumePreview,
      sessionState.startAudioSource,
      sessionState.toggleFavoritePreset,
      sessionState.loadRecentYouTubeVideo,
      sessionState.loadYouTubePreview,
      sessionState.clearRecentYouTubeVideos,
      sessionState.handleYoutubeUrlKeyDown,
      sessionState.setQualityPreset,
      sessionState.setAutoplay,
      sessionState.setTransitionMode,
      sessionState.startManualCrossfade,
      sessionState.setCrossfade,
      sessionState.getCrossfade,
      sessionState.setBlendDuration,
      sessionState.updateEditorSource,
      sessionState.updateFieldLive,
      sessionState.applyEditorSourceAwaited,
      sessionState.applyEditorFieldsAwaited,
      sessionState.getEditorSessionState,
      sessionState.updateInspectorField,
      sessionState.getActiveCompiledPreset,
      shellOrchestration.handleVisualSearch,
    ],
  );

  const uiValue: WorkspaceContextValue = useMemo(
    () => ({
      routeState,
      commitRoute,
      setRouteState,
      deferredSearch: sessionState.deferredSearch,
      motionPreference: sessionState.motionPreference,
      pendingPresetIdRef: sessionState.pendingPresetIdRef,
      qualityPreset: sessionState.qualityPreset,
      searchQuery: sessionState.searchQuery,
      setSearchQuery: sessionState.setSearchQuery,
      setStatusMessage: sessionState.setStatusMessage,
      showExtendedSources: sessionState.showExtendedSources,
      stageRef: sessionState.stageRef,
      toast: sessionState.toast,
      dismissToast: sessionState.dismissToast,
      toggleExtendedSources: sessionState.toggleExtendedSources,
      setYoutubeUrl: sessionState.setYoutubeUrl,
      youtubeCanLoad: sessionState.youtubeCanLoad,
      youtubeFeedback: sessionState.youtubeFeedback,
      youtubeInputInvalid: sessionState.youtubeInputInvalid,
      youtubeLoading: sessionState.youtubeLoading,
      youtubePreviewRef: sessionState.youtubePreviewRef,
      youtubeReady: sessionState.youtubeReady,
      youtubeTransport: sessionState.youtubeTransport,
      youtubeTransportControls: sessionState.youtubeTransportControls,
      youtubeUrl: sessionState.youtubeUrl,
      recentYouTubeVideos: sessionState.recentYouTubeVideos,
      renderPreferences: sessionState.renderPreferences,
      fallbackCatalog: sessionState.fallbackCatalog,
      fallbackCatalogError: sessionState.fallbackCatalogError,
      fallbackCatalogReady: sessionState.fallbackCatalogReady,
      activityCatalog: sessionState.activityCatalog,
      presetQueue,
      handleBrowseRecovery: shellOrchestration.handleBrowseRecovery,
      handleFeaturedPresetSelection:
        shellOrchestration.handleFeaturedPresetSelection,
      handleImport: shellOrchestration.handleImport,
      handleShowCurrentLink: shellOrchestration.handleShowCurrentLink,
      updatePanel: shellOrchestration.updatePanel,
    }),
    [
      routeState,
      commitRoute,
      setRouteState,
      sessionState.deferredSearch,
      sessionState.motionPreference,
      sessionState.pendingPresetIdRef,
      sessionState.qualityPreset,
      sessionState.searchQuery,
      sessionState.setSearchQuery,
      sessionState.setStatusMessage,
      sessionState.showExtendedSources,
      sessionState.stageRef,
      sessionState.toast,
      sessionState.dismissToast,
      sessionState.toggleExtendedSources,
      sessionState.setYoutubeUrl,
      sessionState.youtubeCanLoad,
      sessionState.youtubeFeedback,
      sessionState.youtubeInputInvalid,
      sessionState.youtubeLoading,
      sessionState.youtubePreviewRef,
      sessionState.youtubeReady,
      sessionState.youtubeTransport,
      sessionState.youtubeTransportControls,
      sessionState.youtubeUrl,
      sessionState.recentYouTubeVideos,
      sessionState.renderPreferences,
      sessionState.fallbackCatalog,
      sessionState.fallbackCatalogError,
      sessionState.fallbackCatalogReady,
      sessionState.activityCatalog,
      presetQueue,
      shellOrchestration.handleBrowseRecovery,
      shellOrchestration.handleFeaturedPresetSelection,
      shellOrchestration.handleImport,
      shellOrchestration.handleShowCurrentLink,
      shellOrchestration.updatePanel,
    ],
  );

  return (
    <WorkspaceContext value={uiValue}>
      <EngineProvider snapshot={engineSnapshotValue} data={engineDataValue}>
        {children}
      </EngineProvider>
    </WorkspaceContext>
  );
}
