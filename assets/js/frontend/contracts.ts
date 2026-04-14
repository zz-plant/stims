export type AudioSource = 'demo' | 'microphone' | 'tab' | 'youtube';

export type PanelState = 'browse' | 'editor' | 'inspector' | 'settings' | null;

export type LaunchIntent = {
  presetId: string | null;
  collectionTag: string | null;
  panel: Exclude<PanelState, 'settings'> | null;
  audioSource: AudioSource | null;
  agentMode: boolean;
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
  supports?: {
    webgl?: boolean;
    webgpu?: boolean;
  };
};

export type PresetCatalogManifest = {
  presets: PresetCatalogEntry[];
};
