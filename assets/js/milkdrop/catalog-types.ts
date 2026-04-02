import type {
  MilkdropBackendSupport,
  MilkdropCompatibilityEvidence,
  MilkdropFeatureKey,
  MilkdropFidelityClass,
  MilkdropParityReport,
  MilkdropPresetOrigin,
  MilkdropPresetSource,
  MilkdropSemanticSupport,
  MilkdropVisualCertification,
  MilkdropVisualEvidenceTier,
} from './common-types.ts';

export type MilkdropBundledCatalogEntry = {
  id: string;
  title: string;
  author?: string;
  file: string;
  tags?: string[];
  curatedRank?: number;
  corpusTier?: 'bundled' | 'certified' | 'exploratory';
  certification?: 'bundled' | 'certified' | 'exploratory';
  expectedFidelityClass?: MilkdropFidelityClass;
  visualEvidenceTier?: MilkdropVisualEvidenceTier;
  semanticSupport?: MilkdropSemanticSupport;
  visualCertification?: MilkdropVisualCertification;
  supports?: {
    webgl?: boolean;
    webgpu?: boolean;
  };
};

export type MilkdropCatalogEntry = {
  id: string;
  title: string;
  author?: string;
  origin: MilkdropPresetOrigin;
  tags: string[];
  curatedRank?: number;
  isFavorite: boolean;
  rating: number;
  lastOpenedAt?: number;
  updatedAt?: number;
  historyIndex?: number;
  featuresUsed: MilkdropFeatureKey[];
  warnings: string[];
  supports: {
    webgl: MilkdropBackendSupport;
    webgpu: MilkdropBackendSupport;
  };
  fidelityClass: MilkdropFidelityClass;
  visualEvidenceTier: MilkdropVisualEvidenceTier;
  semanticSupport: MilkdropSemanticSupport;
  visualCertification: MilkdropVisualCertification;
  evidence: MilkdropCompatibilityEvidence;
  certification: 'bundled' | 'certified' | 'exploratory';
  corpusTier: 'bundled' | 'certified' | 'exploratory';
  parity: MilkdropParityReport;
  bundledFile?: string;
};

export interface MilkdropCatalogStore {
  listPresets(): Promise<MilkdropCatalogEntry[]>;
  getPresetSource(id: string): Promise<MilkdropPresetSource | null>;
  savePreset(source: MilkdropPresetSource): Promise<MilkdropPresetSource>;
  deletePreset(id: string): Promise<void>;
  saveDraft(id: string, raw: string): Promise<void>;
  getDraft(id: string): Promise<string | null>;
  setFavorite(id: string, favorite: boolean): Promise<void>;
  setRating(id: string, rating: number): Promise<void>;
  recordRecent(id: string): Promise<void>;
  pushHistory(id: string): Promise<void>;
  getHistory(): Promise<string[]>;
}
