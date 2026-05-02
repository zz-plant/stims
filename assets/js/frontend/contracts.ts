import type { MilkdropVisualCertification } from '../milkdrop/types.ts';

export type AudioSource = 'demo' | 'microphone' | 'tab' | 'youtube' | 'file';

export type PanelState = 'browse' | 'editor' | 'inspector' | 'settings' | null;

export type LaunchIntent = {
  presetId: string | null;
  collectionTag: string | null;
  panel: Exclude<PanelState, 'settings'> | null;
  audioSource: AudioSource | null;
  agentMode: boolean;
  previewMode?: boolean;
};

export type SessionRouteState = {
  presetId: string | null;
  collectionTag: string | null;
  panel: PanelState;
  audioSource: AudioSource | null;
  agentMode: boolean;
  invalidExperienceSlug: string | null;
};

export type EngineAudioRequest =
  | { source: 'demo' }
  | { source: 'microphone' }
  | { source: 'file'; stream: MediaStream }
  | {
      source: 'tab' | 'youtube';
      stream: MediaStream;
      cropTarget?: Element | null;
    };

export type PresetCatalogEntry = {
  id: string;
  title: string;
  author?: string;
  file?: string;
  tags?: string[];
  preview?: boolean;
  isFavorite?: boolean;
  historyIndex?: number;
  lastOpenedAt?: number;
  expectedFidelityClass?: string;
  visualCertification?: MilkdropVisualCertification;
  supports?: {
    webgl?: boolean;
    webgpu?: boolean;
  };
};

export type PresetCatalogManifest = {
  presets: PresetCatalogEntry[];
};
