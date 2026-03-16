export type MilkdropPresetOrigin = 'bundled' | 'imported' | 'user' | 'draft';

export type MilkdropDiagnosticSeverity = 'error' | 'warning' | 'info';

export type MilkdropDiagnostic = {
  severity: MilkdropDiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
  field?: string;
};

export type MilkdropPresetSource = {
  id: string;
  title: string;
  raw: string;
  origin: MilkdropPresetOrigin;
  author?: string;
  fileName?: string;
  path?: string;
  updatedAt?: number;
};

export type MilkdropPresetField = {
  key: string;
  rawValue: string;
  line: number;
  section: string | null;
};

export type MilkdropPresetAST = {
  source: string;
  fields: MilkdropPresetField[];
  sections: string[];
};

export type MilkdropExpressionNode =
  | { type: 'literal'; value: number }
  | { type: 'identifier'; name: string }
  | {
      type: 'unary';
      operator: '+' | '-' | '!';
      operand: MilkdropExpressionNode;
    }
  | {
      type: 'binary';
      operator:
        | '+'
        | '-'
        | '*'
        | '/'
        | '%'
        | '^'
        | '<'
        | '<='
        | '>'
        | '>='
        | '=='
        | '!='
        | '&&'
        | '||';
      left: MilkdropExpressionNode;
      right: MilkdropExpressionNode;
    }
  | {
      type: 'call';
      name: string;
      args: MilkdropExpressionNode[];
    };

export type MilkdropCompiledStatement = {
  target: string;
  expression: MilkdropExpressionNode;
  line: number;
  source: string;
};

export type MilkdropProgramBlock = {
  statements: MilkdropCompiledStatement[];
  sourceLines: string[];
};

export type MilkdropFeatureKey =
  | 'base-globals'
  | 'per-frame-equations'
  | 'per-pixel-equations'
  | 'custom-waves'
  | 'custom-shapes'
  | 'borders'
  | 'video-echo'
  | 'post-effects'
  | 'unsupported-shader-text';

export type MilkdropSupportStatus = 'supported' | 'partial' | 'unsupported';

export type MilkdropBackendSupport = {
  status: MilkdropSupportStatus;
  reasons: string[];
  requiredFeatures: MilkdropFeatureKey[];
  unsupportedFeatures: MilkdropFeatureKey[];
  recommendedFallback?: 'webgl' | 'webgpu';
};

export type MilkdropFeatureAnalysis = {
  featuresUsed: MilkdropFeatureKey[];
  unsupportedShaderText: boolean;
  registerUsage: {
    q: number;
    t: number;
  };
};

export type MilkdropCompatibilityReport = {
  backends: {
    webgl: MilkdropBackendSupport;
    webgpu: MilkdropBackendSupport;
  };
  featureAnalysis: MilkdropFeatureAnalysis;
  warnings: string[];
  blockingReasons: string[];
  supportedFeatures: string[];
  unsupportedKeys: string[];
  webgl: boolean;
  webgpu: boolean;
};

export type MilkdropWavePrograms = {
  init: MilkdropProgramBlock;
  perFrame: MilkdropProgramBlock;
  perPoint: MilkdropProgramBlock;
};

export type MilkdropShapePrograms = {
  init: MilkdropProgramBlock;
  perFrame: MilkdropProgramBlock;
};

export type MilkdropWaveDefinition = {
  index: number;
  fields: Record<string, number>;
  programs: MilkdropWavePrograms;
};

export type MilkdropShapeDefinition = {
  index: number;
  fields: Record<string, number>;
  programs: MilkdropShapePrograms;
};

export type MilkdropBorderDefinition = {
  outer: Record<string, number>;
  inner: Record<string, number>;
};

export type MilkdropPostEffects = {
  brighten: boolean;
  darken: boolean;
  solarize: boolean;
  invert: boolean;
  videoEchoEnabled: boolean;
  videoEchoAlpha: number;
  videoEchoZoom: number;
};

export type MilkdropPresetIR = {
  title: string;
  author?: string;
  description?: string;
  numericFields: Record<string, number>;
  stringFields: Record<string, string>;
  programs: {
    init: MilkdropProgramBlock;
    perFrame: MilkdropProgramBlock;
    perPixel: MilkdropProgramBlock;
  };
  globals: Record<string, number>;
  mainWave: Record<string, number>;
  customWaves: MilkdropWaveDefinition[];
  customShapes: MilkdropShapeDefinition[];
  borders: MilkdropBorderDefinition;
  post: MilkdropPostEffects;
  compatibility: MilkdropCompatibilityReport;
};

export type MilkdropCompiledPreset = {
  source: MilkdropPresetSource;
  ast: MilkdropPresetAST;
  ir: MilkdropPresetIR;
  diagnostics: MilkdropDiagnostic[];
  formattedSource: string;
  title: string;
  author?: string;
};

export type MilkdropColor = {
  r: number;
  g: number;
  b: number;
  a?: number;
};

export type MilkdropPolyline = {
  positions: number[];
  color: MilkdropColor;
  alpha: number;
  thickness: number;
  closed?: boolean;
};

export type MilkdropWaveVisual = MilkdropPolyline & {
  drawMode: 'line' | 'dots';
  additive: boolean;
  pointSize: number;
  spectrum?: boolean;
};

export type MilkdropMeshVisual = {
  positions: number[];
  color: MilkdropColor;
  alpha: number;
};

export type MilkdropShapeVisual = {
  key: string;
  x: number;
  y: number;
  radius: number;
  sides: number;
  rotation: number;
  color: MilkdropColor;
  secondaryColor?: MilkdropColor | null;
  borderColor: MilkdropColor;
  additive: boolean;
  thickOutline: boolean;
};

export type MilkdropBorderVisual = {
  key: 'outer' | 'inner';
  size: number;
  color: MilkdropColor;
  alpha: number;
};

export type MilkdropPostVisual = {
  brighten: boolean;
  darken: boolean;
  solarize: boolean;
  invert: boolean;
  videoEchoEnabled: boolean;
  videoEchoAlpha: number;
  videoEchoZoom: number;
  warp: number;
};

export type MilkdropRuntimeSignals = {
  time: number;
  deltaMs: number;
  frame: number;
  fps: number;
  bass: number;
  mid: number;
  mids: number;
  treb: number;
  treble: number;
  bassAtt: number;
  midsAtt: number;
  trebleAtt: number;
  bass_att: number;
  mid_att: number;
  mids_att: number;
  treb_att: number;
  treble_att: number;
  rms: number;
  vol: number;
  music: number;
  beat: number;
  beatPulse: number;
  beat_pulse: number;
  weightedEnergy: number;
  frequencyData: Uint8Array;
};

export type MilkdropFrameState = {
  presetId: string;
  title: string;
  background: MilkdropColor;
  waveform: MilkdropWaveVisual;
  mainWave: MilkdropWaveVisual;
  customWaves: MilkdropWaveVisual[];
  trails: MilkdropPolyline[];
  mesh: MilkdropMeshVisual;
  shapes: MilkdropShapeVisual[];
  borders: MilkdropBorderVisual[];
  post: MilkdropPostVisual;
  signals: MilkdropRuntimeSignals;
  variables: Record<string, number>;
  compatibility: MilkdropCompatibilityReport;
};

export type MilkdropBlendState = {
  background: MilkdropColor;
  waveform: MilkdropWaveVisual;
  mainWave: MilkdropWaveVisual;
  customWaves: MilkdropWaveVisual[];
  trails: MilkdropPolyline[];
  shapes: MilkdropShapeVisual[];
  borders: MilkdropBorderVisual[];
  post: MilkdropPostVisual;
  alpha: number;
};

export type MilkdropRenderPayload = {
  frameState: MilkdropFrameState;
  blendState?: MilkdropBlendState | null;
};

export interface MilkdropVM {
  setPreset(preset: MilkdropCompiledPreset): void;
  setDetailScale(scale: number): void;
  reset(): void;
  step(signals: MilkdropRuntimeSignals): MilkdropFrameState;
  getStateSnapshot(): Record<string, number>;
}

export interface MilkdropRendererAdapter {
  readonly backend: 'webgl' | 'webgpu';
  attach(): void;
  setPreset(preset: MilkdropCompiledPreset): void;
  render(payload: MilkdropRenderPayload): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export type MilkdropBundledCatalogEntry = {
  id: string;
  title: string;
  author?: string;
  file: string;
  tags?: string[];
  curatedRank?: number;
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

export type MilkdropEditorSessionState = {
  source: string;
  latestCompiled: MilkdropCompiledPreset | null;
  activeCompiled: MilkdropCompiledPreset | null;
  diagnostics: MilkdropDiagnostic[];
  dirty: boolean;
};

export interface MilkdropEditorSession {
  getState(): MilkdropEditorSessionState;
  loadPreset(source: MilkdropPresetSource): Promise<MilkdropEditorSessionState>;
  applySource(source: string): Promise<MilkdropEditorSessionState>;
  updateField(
    key: string,
    value: string | number,
  ): Promise<MilkdropEditorSessionState>;
  resetToActive(): Promise<MilkdropEditorSessionState>;
  subscribe(listener: (state: MilkdropEditorSessionState) => void): () => void;
  dispose(): void;
}
