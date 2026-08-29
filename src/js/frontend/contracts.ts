/**
 * Panel and audio-source unions are owned by core/url-params.ts — the router
 * has to agree with the router. Re-exported here so frontend code keeps its
 * single import site.
 */

import type { SemanticDiscoveryRoute } from '../../../functions/discover-slugs.ts';
import type { AudioSource, PanelState } from '../core/url-params.ts';
import type { VisualFidelityTier } from '../milkdrop/catalog-store-analysis.ts';
import type {
  MilkdropPresetLineageRef,
  MilkdropVisualCertification,
} from '../milkdrop/types.ts';

export type { AudioSource, PanelState };

export type LaunchIntent = {
  presetId: string | null;
  collectionTag: string | null;
  panel: PanelState;
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
  invalidPanel?: string | null;
  /** Video carried by a shared link, so the recipient lands on the same track. */
  youtubeVideoId?: string | null;
  youtubeStartSeconds?: number | null;
  /** Semantic landing context retained while Browse shows its real filter. */
  discovery?: SemanticDiscoveryRoute;
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
/**
 * Owned by core/sensory-profile.ts, which also holds the classifier that
 * decides the risk bands — the merge script and the UI have to agree on what
 * "high" means. Re-exported here so frontend code keeps one import site.
 */
import type {
  FlashRiskLevel,
  PresetSensoryProfile,
} from '../core/sensory-profile.ts';

export type { FlashRiskLevel, PresetSensoryProfile };

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
  /** Offline quality scoring; the browse row reads measuredReactivity. */
  quality?: {
    score?: number;
    components?: { measuredReactivity?: number | null };
  };
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
