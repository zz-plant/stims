import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { createContext, useContext } from 'react';
import type { MotionPreference } from '../core/motion-preferences.ts';
import type { QualityPreset } from '../core/settings-panel.ts';
import type { RenderPreferences } from '../core/state/render-preference-store.ts';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type {
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import type { EngineSnapshot } from './engine/milkdrop-engine-adapter.ts';
import type { ReadinessItem, StarterPreset } from './workspace-helpers.ts';
import {
  useWorkspaceRouteState,
  useWorkspaceSessionState,
} from './workspace-hooks.ts';
import { useWorkspaceShellOrchestration } from './workspace-shell-hooks.ts';

export interface WorkspaceContextValue {
  // Route
  routeState: SessionRouteState;
  commitRoute: (nextState: SessionRouteState) => void;
  setRouteState: React.Dispatch<React.SetStateAction<SessionRouteState>>;

  // Session data
  deferredSearch: string;
  engineSnapshot: EngineSnapshot | null;
  fallbackCatalog: PresetCatalogEntry[];
  fallbackCatalogError: string | null;
  fallbackCatalogReady: boolean;
  activityCatalog: PresetCatalogEntry[];
  motionPreference: MotionPreference;
  pendingPresetIdRef: { current: string | null };
  qualityPreset: QualityPreset;
  readinessItems: ReadinessItem[];
  recentYouTubeVideos: Array<{ id: string; title: string }>;
  renderPreferences: RenderPreferences;
  searchQuery: string;
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  setStatusMessage: (message: string | null) => void;
  showExtendedSources: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  toast: {
    message: string;
    tone: 'info' | 'warn' | 'error';
  } | null;
  dismissToast: () => void;
  youtubeCanLoad: boolean;
  youtubeFeedback: string;
  youtubeInputInvalid: boolean;
  youtubeLoading: boolean;
  youtubePreviewRef: RefObject<HTMLDivElement | null>;
  youtubeReady: boolean;
  youtubeUrl: string;

  // Session actions
  exportPreset: () => void;
  importPresetFiles: (files: FileList | null) => Promise<void>;
  loadRecentYouTubeVideo: (videoId: string) => void;
  loadYouTubePreview: () => void;
  handleYoutubeUrlKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  setQualityPreset: (presetId: string) => void;
  setSearchQuery: (query: string) => void;
  setYoutubeUrl: (url: string) => void;
  requestPresetPreviews: (presetIds: string[]) => Promise<void>;
  refreshPresetPreviews: (presetIds: string[]) => Promise<void>;
  startAudioSource: (request: {
    cropTarget?: HTMLElement | null;
    launchState?: SessionRouteState;
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file';
    stream?: MediaStream;
  }) => Promise<void>;
  toggleExtendedSources: () => void;

  // Shell computed
  catalog: PresetCatalogEntry[];
  catalogError: string | null;
  catalogReady: boolean;
  collectionTags: string[];
  engineReady: boolean;
  favoritePresets: PresetCatalogEntry[];
  featuredPreset: PresetCatalogEntry | null;
  filteredCatalog: PresetCatalogEntry[];
  launchControlsHidden: boolean;
  loadingRequestedPreset: boolean;
  missingRequestedPreset: boolean;
  recentPresets: PresetCatalogEntry[];
  readinessAlerts: ReadinessItem[];
  selectedPreset: PresetCatalogEntry | null;
  starterPresets: StarterPreset[];

  // Shell actions
  handleAudioStart: (
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file',
  ) => Promise<void>;
  handleAudioStop: () => void;
  handleBrowseRecovery: () => void;
  handleFeaturedPresetSelection: () => void;
  handleImport: (files: FileList | null) => Promise<void>;
  handlePresetSelection: (presetId: string) => void;
  handleShowCurrentLink: () => Promise<void>;
  handleShufflePreset: () => void;
  updatePanel: (panel: PanelState) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return ctx;
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

  const value: WorkspaceContextValue = {
    routeState,
    commitRoute,
    setRouteState,

    deferredSearch: sessionState.deferredSearch,
    engineSnapshot: sessionState.engineSnapshot,
    fallbackCatalog: sessionState.fallbackCatalog,
    fallbackCatalogError: sessionState.fallbackCatalogError,
    fallbackCatalogReady: sessionState.fallbackCatalogReady,
    activityCatalog: sessionState.activityCatalog,
    motionPreference: sessionState.motionPreference,
    pendingPresetIdRef: sessionState.pendingPresetIdRef,
    qualityPreset: sessionState.qualityPreset,
    readinessItems: sessionState.readinessItems,
    recentYouTubeVideos: sessionState.recentYouTubeVideos,
    renderPreferences: sessionState.renderPreferences,
    searchQuery: sessionState.searchQuery,
    presetPreviews: sessionState.presetPreviews,
    setStatusMessage: sessionState.setStatusMessage,
    showExtendedSources: sessionState.showExtendedSources,
    stageRef: sessionState.stageRef,
    toast: sessionState.toast,
    dismissToast: sessionState.dismissToast,
    youtubeCanLoad: sessionState.youtubeCanLoad,
    youtubeFeedback: sessionState.youtubeFeedback,
    youtubeInputInvalid: sessionState.youtubeInputInvalid,
    youtubeLoading: sessionState.youtubeLoading,
    youtubePreviewRef: sessionState.youtubePreviewRef,
    youtubeReady: sessionState.youtubeReady,
    youtubeUrl: sessionState.youtubeUrl,

    exportPreset: sessionState.exportPreset,
    importPresetFiles: sessionState.importPresetFiles,
    loadRecentYouTubeVideo: sessionState.loadRecentYouTubeVideo,
    loadYouTubePreview: sessionState.loadYouTubePreview,
    handleYoutubeUrlKeyDown: sessionState.handleYoutubeUrlKeyDown,
    setQualityPreset: sessionState.setQualityPreset,
    setSearchQuery: sessionState.setSearchQuery,
    setYoutubeUrl: sessionState.setYoutubeUrl,
    requestPresetPreviews: sessionState.requestPresetPreviews,
    refreshPresetPreviews: sessionState.refreshPresetPreviews,
    startAudioSource: sessionState.startAudioSource,
    toggleExtendedSources: sessionState.toggleExtendedSources,

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
    readinessAlerts: shellOrchestration.readinessAlerts,
    selectedPreset: shellOrchestration.selectedPreset,
    starterPresets: shellOrchestration.starterPresets,

    handleAudioStart: shellOrchestration.handleAudioStart,
    handleAudioStop: shellOrchestration.handleAudioStop,
    handleBrowseRecovery: shellOrchestration.handleBrowseRecovery,
    handleFeaturedPresetSelection:
      shellOrchestration.handleFeaturedPresetSelection,
    handleImport: shellOrchestration.handleImport,
    handlePresetSelection: shellOrchestration.handlePresetSelection,
    handleShowCurrentLink: shellOrchestration.handleShowCurrentLink,
    handleShufflePreset: shellOrchestration.handleShufflePreset,
    updatePanel: shellOrchestration.updatePanel,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
