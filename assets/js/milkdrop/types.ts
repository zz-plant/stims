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

export type MilkdropCompatibilityReport = {
  webgl: boolean;
  webgpu: boolean;
  warnings: string[];
  blockingReasons: string[];
  supportedFeatures: string[];
  unsupportedKeys: string[];
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
  borderColor: MilkdropColor;
  additive: boolean;
  thickOutline: boolean;
};

export type MilkdropRuntimeSignals = {
  time: number;
  deltaMs: number;
  frame: number;
  bass: number;
  mids: number;
  treble: number;
  bassAtt: number;
  midsAtt: number;
  trebleAtt: number;
  rms: number;
  beat: number;
  beatPulse: number;
  weightedEnergy: number;
  frequencyData: Uint8Array;
};

export type MilkdropFrameState = {
  presetId: string;
  title: string;
  background: MilkdropColor;
  waveform: MilkdropPolyline;
  trails: MilkdropPolyline[];
  mesh: MilkdropMeshVisual;
  shapes: MilkdropShapeVisual[];
  signals: MilkdropRuntimeSignals;
  variables: Record<string, number>;
  compatibility: MilkdropCompatibilityReport;
};

export type MilkdropRenderPayload = {
  frameState: MilkdropFrameState;
  blendState?: {
    waveform: MilkdropPolyline | null;
    trails: MilkdropPolyline[];
    shapes: MilkdropShapeVisual[];
    alpha: number;
  } | null;
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
  lastOpenedAt?: number;
  updatedAt?: number;
  supports: {
    webgl: boolean;
    webgpu: boolean;
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
  recordRecent(id: string): Promise<void>;
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
