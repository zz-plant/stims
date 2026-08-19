import type { VisualFidelityTier } from '../milkdrop/catalog-store-analysis.ts';
import type {
  MilkdropPresetLineageRef,
  MilkdropVisualCertification,
} from '../milkdrop/types.ts';

export type AudioSource = 'demo' | 'microphone' | 'tab' | 'youtube' | 'file';

export type PanelState =
  | 'browse'
  | 'editor'
  | 'refine'
  /* One finder panel. It was two ('audiomatch'/'visualsearch') back when the
     two seeds were separate panels; they merged, but both route ids stayed,
     so every consumer had to test for both. Neither was ever URL-addressable
     (url-params' VALID_PANELS excludes them), so collapsing them is internal
     only — no link or saved shortcut changes meaning. The seed (sound vs
     look) is panel state now, which is where it belongs. */
  | 'finder'
  | 'capture'
  | 'settings'
  | 'synthesize'
  | null;

export type LaunchIntent = {
  presetId: string | null;
  collectionTag: string | null;
  panel: Exclude<PanelState, 'capture' | 'settings' | 'synthesize'> | null;
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
  previewMode?: boolean;
  invalidExperienceSlug?: string | null;
  /** Video carried by a shared link, so the recipient lands on the same track. */
  youtubeVideoId?: string | null;
  youtubeStartSeconds?: number | null;
};

export type EngineAudioRequest =
  | { source: 'demo' }
  | { source: 'microphone'; stream?: MediaStream }
  | { source: 'file'; stream: MediaStream }
  | {
      source: 'tab' | 'youtube';
      stream: MediaStream;
      cropTarget?: Element | null;
    };

/**
 * Computed (not authored) flash/luminance-volatility summary for one preset,
 * produced by `bun run lab:flash-risk -- --preset <id>` — see
 * scripts/preset-lab-flash-risk.ts. Same category of field as fidelityTier /
 * visualCertification below: a classifier run offline and cached here, not
 * something hand-tagged per preset.
 *
 * SCAFFOLD: nothing in the catalog build currently populates this field, and
 * the underlying detector's threshold is explicitly a placeholder (see the
 * flash-risk script's file header) — do not surface `flashRiskLevel` in UI
 * or treat it as a safety guarantee until it's backed by real corpus-wide
 * data and a threshold sourced from actual photosensitivity guidance.
 */
export type PresetSensoryProfile = {
  flashRiskLevel: 'unknown' | 'none' | 'low' | 'medium' | 'high';
  maxTransitionsPerSecondEstimate: number;
  meanLuminance: number;
  maxLuminanceDelta: number;
  /** ISO timestamp of the lab run that produced this entry. */
  measuredAt: string;
};

export type PresetCatalogEntry = {
  id: string;
  title: string;
  author?: string;
  authorUrl?: string;
  derivedFrom?: MilkdropPresetLineageRef[];
  file?: string;
  tags?: string[];
  searchTerms?: string[];
  preview?: boolean;
  isFavorite?: boolean;
  rating?: number;
  historyIndex?: number;
  lastOpenedAt?: number;
  expectedFidelityClass?: string;
  /** Near-duplicate cluster annotation (dedup-catalog.ts); duplicateOf names
   * the cluster representative when this entry is a non-representative. */
  similarity?: { clusterId: string; duplicateOf?: string };
  fidelityTier?: VisualFidelityTier;
  visualCertification?: MilkdropVisualCertification;
  sensoryProfile?: PresetSensoryProfile;
  supports?: {
    webgl?: boolean;
    webgpu?: boolean;
  };
};

export type PresetCatalogManifest = {
  presets: PresetCatalogEntry[];
};

// Edge API request/response contracts live in `src/js/core/edge-contracts.ts`
// so that `core/` consumers can import them too — see the note in that file.
