import { createContext, type ReactNode, useContext } from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { PresetCatalogEntry, SessionRouteState } from './contracts.ts';
import type { EngineSnapshot } from './engine/engine-snapshot.ts';
import type { StarterPreset } from './workspace-helpers.ts';

/* ── Engine Snapshot (changes every frame) ──────────────────────── */

export interface EngineSnapshotValue {
  engineSnapshot: EngineSnapshot | null;
  engineReady: boolean;
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
  launchControlsHidden: boolean;
  loadingRequestedPreset: boolean;
  missingRequestedPreset: boolean;
  recentPresets: PresetCatalogEntry[];
  selectedPreset: PresetCatalogEntry | null;
  starterPresets: StarterPreset[];

  exportPreset: () => void;
  importPresetFiles: (files: FileList | null) => Promise<void>;
  requestPresetPreviews: (presetIds: string[]) => Promise<void>;
  refreshPresetPreviews: (presetIds: string[]) => Promise<void>;
  startAudioSource: (request: {
    cropTarget?: HTMLElement | null;
    launchState?: SessionRouteState;
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file';
    stream?: MediaStream;
  }) => Promise<void>;
  toggleFavoritePreset: (presetId: string, favorite: boolean) => Promise<void>;
  handlePresetSelection: (presetId: string) => void;
  handlePlayPreset: (presetId: string) => Promise<void>;
  handleShufflePreset: () => void;
  handleAudioStart: (
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file',
  ) => Promise<void>;
  handleAudioStop: () => void;
  loadRecentYouTubeVideo: (videoId: string) => void;
  loadYouTubePreview: () => void;
  handleYoutubeUrlKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void;
  setQualityPreset: (presetId: string) => void;
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
    <EngineSnapshotCtx.Provider value={snapshot}>
      <EngineCtx.Provider value={data}>{children}</EngineCtx.Provider>
    </EngineSnapshotCtx.Provider>
  );
}
