import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { MotionPreference } from '../core/motion-preferences.ts';
import type { QualityPreset } from '../core/settings-panel.ts';
import type { RenderPreferences } from '../core/state/render-preference-store.ts';
import type {
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import {
  type EngineContextValue,
  EngineCtx,
  EngineProvider,
} from './engine-context.tsx';
import type { ReadinessItem } from './workspace-helpers.ts';
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
  readinessItems: ReadinessItem[];
  readinessAlerts: ReadinessItem[];
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
  youtubeUrl: string;
  recentYouTubeVideos: Array<{ id: string; title: string }>;
  renderPreferences: RenderPreferences;
  fallbackCatalog: PresetCatalogEntry[];
  fallbackCatalogError: string | null;
  fallbackCatalogReady: boolean;
  activityCatalog: PresetCatalogEntry[];

  handleBrowseRecovery: () => void;
  handleFeaturedPresetSelection: () => void;
  handleImport: (files: FileList | null) => Promise<void>;
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

export { useEngine } from './engine-context.tsx';

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
    activityCatalog: sessionState.activityCatalog,
    importPresetFiles: sessionState.importPresetFiles,
    pendingPresetIdRef: sessionState.pendingPresetIdRef,
    readinessItems: sessionState.readinessItems,
    routeState,
    setStatusMessage: sessionState.setStatusMessage,
    startAudioSource: sessionState.startAudioSource,
    youtubePreviewRef: sessionState.youtubePreviewRef,
  });

  const engineValue: EngineContextValue = useMemo(
    () => ({
      engineSnapshot: sessionState.engineSnapshot,
      presetPreviews: sessionState.presetPreviews,
      catalog: shellOrchestration.catalog,
      catalogError: shellOrchestration.catalogError,
      catalogReady: shellOrchestration.catalogReady,
      collectionTags: shellOrchestration.collectionTags,
      engineReady: shellOrchestration.engineReady,
      favoritePresets: shellOrchestration.favoritePresets,
      featuredPreset: shellOrchestration.featuredPreset,
      filteredCatalog: shellOrchestration.filteredCatalog,
      launchControlsHidden: shellOrchestration.launchControlsHidden,
      loadingRequestedPreset: shellOrchestration.loadingRequestedPreset,
      missingRequestedPreset: shellOrchestration.missingRequestedPreset,
      recentPresets: shellOrchestration.recentPresets,
      selectedPreset: shellOrchestration.selectedPreset,
      starterPresets: shellOrchestration.starterPresets,
      handleAudioStart: shellOrchestration.handleAudioStart,
      handleAudioStop: shellOrchestration.handleAudioStop,
      handlePresetSelection: shellOrchestration.handlePresetSelection,
      handlePlayPreset: shellOrchestration.handlePlayPreset,
      handleShufflePreset: shellOrchestration.handleShufflePreset,
      exportPreset: sessionState.exportPreset,
      importPresetFiles: sessionState.importPresetFiles,
      requestPresetPreviews: sessionState.requestPresetPreviews,
      refreshPresetPreviews: sessionState.refreshPresetPreviews,
      startAudioSource: sessionState.startAudioSource,
      toggleFavoritePreset: sessionState.toggleFavoritePreset,
      loadRecentYouTubeVideo: sessionState.loadRecentYouTubeVideo,
      loadYouTubePreview: sessionState.loadYouTubePreview,
      handleYoutubeUrlKeyDown: sessionState.handleYoutubeUrlKeyDown,
      setQualityPreset: sessionState.setQualityPreset,
    }),
    [
      sessionState.engineSnapshot,
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
      shellOrchestration.launchControlsHidden,
      shellOrchestration.handleAudioStart,
      shellOrchestration.handleAudioStop,
      shellOrchestration.handlePresetSelection,
      shellOrchestration.handlePlayPreset,
      shellOrchestration.handleShufflePreset,
      sessionState.exportPreset,
      sessionState.importPresetFiles,
      sessionState.requestPresetPreviews,
      sessionState.refreshPresetPreviews,
      sessionState.startAudioSource,
      sessionState.toggleFavoritePreset,
      sessionState.loadRecentYouTubeVideo,
      sessionState.loadYouTubePreview,
      sessionState.handleYoutubeUrlKeyDown,
      sessionState.setQualityPreset,
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
      readinessItems: sessionState.readinessItems,
      readinessAlerts: shellOrchestration.readinessAlerts,
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
      youtubeUrl: sessionState.youtubeUrl,
      recentYouTubeVideos: sessionState.recentYouTubeVideos,
      renderPreferences: sessionState.renderPreferences,
      fallbackCatalog: sessionState.fallbackCatalog,
      fallbackCatalogError: sessionState.fallbackCatalogError,
      fallbackCatalogReady: sessionState.fallbackCatalogReady,
      activityCatalog: sessionState.activityCatalog,
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
      sessionState.readinessItems,
      shellOrchestration.readinessAlerts,
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
      sessionState.youtubeUrl,
      sessionState.recentYouTubeVideos,
      sessionState.renderPreferences,
      sessionState.fallbackCatalog,
      sessionState.fallbackCatalogError,
      sessionState.fallbackCatalogReady,
      sessionState.activityCatalog,
      shellOrchestration.handleBrowseRecovery,
      shellOrchestration.handleFeaturedPresetSelection,
      shellOrchestration.handleImport,
      shellOrchestration.handleShowCurrentLink,
      shellOrchestration.updatePanel,
    ],
  );

  return (
    <WorkspaceContext.Provider value={uiValue}>
      <EngineProvider value={engineValue}>{children}</EngineProvider>
    </WorkspaceContext.Provider>
  );
}
