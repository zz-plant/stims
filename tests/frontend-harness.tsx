import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { PresetCatalogEntry } from '../src/js/frontend/contracts.ts';
import type { EngineSnapshot } from '../src/js/frontend/engine/engine-snapshot.ts';
import type {
  EngineContextValue,
  EngineSnapshotValue,
} from '../src/js/frontend/engine-context.tsx';
import {
  type WorkspaceContextValue,
  WorkspaceValueProvider,
} from '../src/js/frontend/workspace-context.tsx';

/**
 * Renders workspace panels against fake context values so tests can assert on
 * the DOM the user actually gets. Prefer this over reading component source
 * text: source assertions freeze a refactor in place and go red when dead code
 * is deleted, while these assertions only fail when behavior changes.
 */

const noop = () => {};
const asyncNoop = async () => {};

export function makePresetEntry(
  overrides: Partial<PresetCatalogEntry> = {},
): PresetCatalogEntry {
  return {
    id: 'preset-alpha',
    title: 'Alpha',
    author: 'Test Author',
    tags: ['test'],
    ...overrides,
  };
}

export function makeUiValue(
  overrides: Partial<WorkspaceContextValue> = {},
): WorkspaceContextValue {
  return {
    routeState: {
      presetId: null,
      collectionTag: null,
      panel: null,
      audioSource: null,
      agentMode: false,
    },
    commitRoute: noop,
    setRouteState: noop,

    deferredSearch: '',
    motionPreference: { enabled: true },
    pendingPresetIdRef: { current: null },
    qualityPreset: {
      id: 'balanced',
      label: 'Balanced',
      description: 'Balanced quality.',
      maxPixelRatio: 1.5,
    },
    searchQuery: '',
    setSearchQuery: noop,
    setStatusMessage: noop,
    showExtendedSources: false,
    stageRef: { current: null },
    toast: null,
    dismissToast: noop,
    toggleExtendedSources: noop,
    setYoutubeUrl: noop,
    youtubeCanLoad: false,
    youtubeFeedback: '',
    youtubeInputInvalid: false,
    youtubeLoading: false,
    youtubePreviewRef: { current: null },
    youtubeReady: false,
    youtubeTransport: null,
    youtubeTransportControls: {
      play: noop,
      pause: noop,
      seekTo: noop,
      nudge: noop,
    },
    youtubeUrl: '',
    recentYouTubeVideos: [],
    renderPreferences: { compatibilityMode: false },
    fallbackCatalog: [],
    fallbackCatalogError: null,
    fallbackCatalogReady: true,
    activityCatalog: [],
    presetQueue: {
      presetIds: [],
      entries: [],
      add: noop,
      remove: noop,
      clear: noop,
      move: noop,
      popNext: () => null,
    },

    handleBrowseRecovery: noop,
    handleFeaturedPresetSelection: noop,
    handleImport: asyncNoop,
    handleShowCurrentLink: asyncNoop,
    updatePanel: noop,
    ...overrides,
  };
}

export function makeEngineValue(
  overrides: Partial<EngineContextValue> = {},
): EngineContextValue {
  return {
    presetPreviews: {},
    catalog: [],
    catalogError: null,
    catalogReady: true,
    collectionTags: [],
    engineReady: true,
    favoritePresets: [],
    featuredPreset: null,
    filteredCatalog: [],
    audioActive: false,
    loadingRequestedPreset: false,
    missingRequestedPreset: false,
    recentPresets: [],
    selectedPreset: null,
    starterPresets: [],

    exportPreset: noop,
    revertEditorSource: noop,
    duplicatePreset: asyncNoop,
    deleteActivePreset: asyncNoop,
    getVideoExportRuntime: () => null,
    importPresetFiles: asyncNoop,
    requestPresetPreviews: asyncNoop,
    pausePreview: noop,
    resumePreview: noop,
    refreshPresetPreviews: asyncNoop,
    startAudioSource: asyncNoop,
    toggleFavoritePreset: asyncNoop,
    handlePresetSelection: noop,
    handlePreviousPreset: noop,
    handlePlayPreset: asyncNoop,
    handleShufflePreset: noop,
    handleAudioStart: asyncNoop,
    handleAudioStop: noop,
    loadRecentYouTubeVideo: noop,
    loadYouTubePreview: noop,
    clearRecentYouTubeVideos: noop,
    handleYoutubeUrlKeyDown: noop,
    setQualityPreset: noop,
    setAutoplay: noop,
    setTransitionMode: noop,
    startManualCrossfade: noop,
    setCrossfade: noop,
    getCrossfade: () => null,
    setBlendDuration: noop,
    updateEditorSource: noop,
    updateFieldLive: noop,
    applyEditorSourceAwaited: async () => null,
    applyEditorFieldsAwaited: async () => null,
    getEditorSessionState: () => null,
    handleVisualSearch: asyncNoop,
    updateInspectorField: noop,
    getActiveCompiledPreset: () => null,
    ...overrides,
  };
}

export type RenderedWorkspace = {
  container: HTMLElement;
  rerender: (next: ReactNode) => void;
  dispose: () => void;
  /** Finds an element by its `aria-label`. */
  byLabel: (label: string) => HTMLElement | null;
  /** Clicks an element and flushes the resulting React render. */
  click: (target: Element | null | undefined) => void;
  text: () => string;
};

export function renderWorkspace(
  node: ReactNode,
  options: {
    ui?: Partial<WorkspaceContextValue>;
    engine?: Partial<EngineContextValue>;
    snapshot?: EngineSnapshot | null;
  } = {},
): RenderedWorkspace {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement('div');
  container.className = 'stims-shell';
  document.body.appendChild(container);

  const ui = makeUiValue(options.ui);
  const engine = makeEngineValue(options.engine);
  const snapshot: EngineSnapshotValue = {
    engineSnapshot: options.snapshot ?? null,
  };

  const root = createRoot(container);

  const paint = (child: ReactNode) => {
    act(() => {
      root.render(
        <WorkspaceValueProvider ui={ui} engine={engine} snapshot={snapshot}>
          {child}
        </WorkspaceValueProvider>,
      );
    });
  };

  paint(node);

  return {
    container,
    rerender: paint,
    dispose: () => {
      act(() => root.unmount());
      container.remove();
    },
    byLabel: (label: string) =>
      container.querySelector<HTMLElement>(`[aria-label="${label}"]`),
    click: (target: Element | null | undefined) => {
      if (!target) throw new Error('renderWorkspace.click: no such element');
      act(() => {
        (target as HTMLElement).click();
      });
    },
    text: () => container.textContent ?? '',
  };
}
