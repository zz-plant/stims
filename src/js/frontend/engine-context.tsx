import { createContext, type ReactNode, useContext } from 'react';
import type { MilkdropCompiledPreset } from '../milkdrop/compiler-types.ts';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { MilkdropEditorSessionState } from '../milkdrop/runtime-types.ts';
import type { CanvasVideoExportRuntime } from '../utils/media/canvas-video-exporter.ts';
import type { PresetCatalogEntry, SessionRouteState } from './contracts.ts';
import type { EngineSnapshot } from './engine/engine-snapshot.ts';
import type { StarterPreset } from './workspace-helpers.ts';

/* ── Engine Snapshot (changes every frame) ──────────────────────── */

export interface EngineSnapshotValue {
  engineSnapshot: EngineSnapshot | null;
}

const EngineSnapshotCtx = createContext<EngineSnapshotValue | null>(null);

export function useEngineSnapshot(): EngineSnapshotValue {
  const ctx = useContext(EngineSnapshotCtx);
  if (!ctx) {
    throw new Error('useEngineSnapshot must be used within an EngineProvider');
  }
  return ctx;
}

/* ── Engine Data + Actions (stable between user actions / preset switches) ─── */

export interface EngineContextValue {
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  catalog: PresetCatalogEntry[];
  catalogError: string | null;
  catalogReady: boolean;
  collectionTags: string[];
  engineReady: boolean;
  favoritePresets: PresetCatalogEntry[];
  featuredPreset: PresetCatalogEntry | null;
  filteredCatalog: PresetCatalogEntry[];
  audioActive: boolean;
  loadingRequestedPreset: boolean;
  missingRequestedPreset: boolean;
  recentPresets: PresetCatalogEntry[];
  selectedPreset: PresetCatalogEntry | null;
  starterPresets: StarterPreset[];

  exportPreset: () => void;
  revertEditorSource: () => void;
  duplicatePreset: () => Promise<void>;
  deleteActivePreset: () => Promise<void>;
  getVideoExportRuntime: () => CanvasVideoExportRuntime | null;
  importPresetFiles: (files: FileList | File[] | null) => Promise<void>;
  requestPresetPreviews: (presetIds: string[]) => Promise<void>;
  pausePreview: () => void;
  resumePreview: () => void;
  refreshPresetPreviews: (presetIds: string[]) => Promise<void>;
  startAudioSource: (request: {
    cropTarget?: HTMLElement | null;
    launchState?: SessionRouteState;
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file';
    stream?: MediaStream;
  }) => Promise<void>;
  toggleFavoritePreset: (presetId: string, favorite: boolean) => Promise<void>;
  handlePresetSelection: (presetId: string) => void;
  handlePreviousPreset: () => void;
  handlePlayPreset: (presetId: string) => Promise<void>;
  handleShufflePreset: () => void;
  handleAudioStart: (
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file',
    deviceId?: string,
  ) => Promise<void>;
  handleAudioStop: () => void;
  loadRecentYouTubeVideo: (videoId: string, onLoaded?: () => void) => void;
  loadYouTubePreview: (requestedUrl?: string, onLoaded?: () => void) => void;
  clearRecentYouTubeVideos: () => void;
  handleYoutubeUrlKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
    onLoaded?: () => void,
  ) => void;
  setQualityPreset: (presetId: string) => void;
  setAutoplay: (enabled: boolean) => void;
  setTransitionMode: (mode: 'blend' | 'cut') => void;
  /** Arms the next preset switch to be crossfaded by hand, then driven with
   * `setCrossfade`. One switch only — it is a gesture, not a mode. */
  startManualCrossfade: () => void;
  setCrossfade: (position: number) => void;
  getCrossfade: () => number | null;
  setBlendDuration: (value: number) => void;
  updateEditorSource: (source: string) => void;
  /** Applies a field to the live VM without recompiling (instant drag
   * feedback); the editor commits to source on release. */
  updateFieldLive: (key: string, value: number) => void;
  /** Awaitable live-edit surface used by the agent bridge: resolves with the
   * resulting compile so a caller can see diagnostics instead of guessing. */
  applyEditorSourceAwaited: (
    source: string,
  ) => Promise<MilkdropEditorSessionState | null>;
  applyEditorFieldsAwaited: (
    updates: Record<string, string | number>,
  ) => Promise<MilkdropEditorSessionState | null>;
  getEditorSessionState: () => MilkdropEditorSessionState | null;
  handleVisualSearch: () => Promise<void>;
  updateInspectorField: (key: string, value: number) => void;
  /**
   * The active preset's compiled IR, or null before the engine mounts.
   * Read-only debug surface (see HudOverlay) — not a render path.
   */
  getActiveCompiledPreset: () => MilkdropCompiledPreset | null;
}

export const EngineCtx = createContext<EngineContextValue | null>(null);

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineCtx);
  if (!ctx) {
    throw new Error('useEngine must be used within an EngineProvider');
  }
  return ctx;
}

export function EngineProvider({
  snapshot,
  data,
  children,
}: {
  snapshot: EngineSnapshotValue;
  data: EngineContextValue;
  children: ReactNode;
}) {
  return (
    <EngineSnapshotCtx value={snapshot}>
      <EngineCtx value={data}>{children}</EngineCtx>
    </EngineSnapshotCtx>
  );
}
