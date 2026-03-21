import type { Camera, Scene } from 'three';

export type MilkdropPresetOrigin = 'bundled' | 'imported' | 'user' | 'draft';

export type MilkdropDiagnosticSeverity = 'error' | 'warning' | 'info';

export type MilkdropCompatibilityIssueCategory =
  | 'unsupported-syntax'
  | 'unsupported-shader'
  | 'runtime-divergence'
  | 'backend-degradation'
  | 'acceptable-approximation';

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
        | '|'
        | '&'
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
  | 'motion-vectors'
  | 'video-echo'
  | 'post-effects'
  | 'unsupported-shader-text';

export type MilkdropSupportStatus = 'supported' | 'partial' | 'unsupported';

export type MilkdropFidelityClass =
  | 'exact'
  | 'near-exact'
  | 'partial'
  | 'fallback';

export type MilkdropVisualEvidenceTier =
  | 'none'
  | 'compile'
  | 'runtime'
  | 'visual';

export type MilkdropBlockingConstruct = {
  kind: 'field' | 'shader';
  value: string;
  system: 'preset-field' | 'shader-text';
  allowlisted: boolean;
};

export type MilkdropDegradationReason = {
  code:
    | 'unknown-field'
    | 'unsupported-field'
    | 'shader-approximation'
    | 'allowlisted-gap'
    | 'backend-divergence'
    | 'backend-partial'
    | 'backend-unsupported'
    | 'visual-fallback';
  category: MilkdropCompatibilityIssueCategory;
  message: string;
  system: 'compiler' | 'shader' | 'backend' | 'runtime';
  blocking: boolean;
};

export type MilkdropCompatibilityEvidence = {
  compile: 'verified' | 'issues';
  runtime: 'not-run' | 'smoke-tested';
  visual: 'not-captured' | 'reference-suite';
};

export type MilkdropRenderBackend = 'webgl' | 'webgpu';

export type MilkdropBackendSupportEvidenceCode =
  | 'unknown-field'
  | 'unsupported-hard-feature'
  | 'supported-shader-text-gap'
  | 'unsupported-shader-text-gap'
  | 'video-echo-gap'
  | 'post-effects-gap';

export type MilkdropBackendSupportEvidence = {
  backend: MilkdropRenderBackend;
  scope: 'shared' | 'backend';
  status: Exclude<MilkdropSupportStatus, 'supported'>;
  code: MilkdropBackendSupportEvidenceCode;
  message: string;
  feature?: MilkdropFeatureKey;
};

export type MilkdropParityReport = {
  ignoredFields: string[];
  approximatedShaderLines: string[];
  missingAliasesOrFunctions: string[];
  backendDivergence: string[];
  visualFallbacks: string[];
  blockedConstructs: string[];
  blockingConstructDetails: MilkdropBlockingConstruct[];
  degradationReasons: MilkdropDegradationReason[];
  fidelityClass: MilkdropFidelityClass;
  evidence: MilkdropCompatibilityEvidence;
  visualEvidenceTier: MilkdropVisualEvidenceTier;
};

export type MilkdropCompileOptions = Record<string, never>;

export type MilkdropBackendSupport = {
  status: MilkdropSupportStatus;
  reasons: string[];
  evidence: MilkdropBackendSupportEvidence[];
  requiredFeatures: MilkdropFeatureKey[];
  unsupportedFeatures: MilkdropFeatureKey[];
  recommendedFallback?: MilkdropRenderBackend;
};

export type MilkdropFeatureAnalysis = {
  featuresUsed: MilkdropFeatureKey[];
  unsupportedShaderText: boolean;
  supportedShaderText: boolean;
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
  parity: MilkdropParityReport;
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

export type MilkdropShaderColorControls = {
  r: number;
  g: number;
  b: number;
};

export type MilkdropShaderTextureSampler =
  | 'none'
  | 'noise'
  | 'perlin'
  | 'simplex'
  | 'voronoi'
  | 'aura'
  | 'caustics'
  | 'pattern'
  | 'fractal';

export type MilkdropShaderTextureBlendMode =
  | 'none'
  | 'replace'
  | 'mix'
  | 'add'
  | 'multiply';

export type MilkdropShaderTextureLayerControls = {
  source: MilkdropShaderTextureSampler;
  mode: MilkdropShaderTextureBlendMode;
  amount: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
};

export type MilkdropShaderTextureWarpControls = {
  source: MilkdropShaderTextureSampler;
  amount: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
};

export type MilkdropShaderTextureLayerExpressions = {
  amount: MilkdropExpressionNode | null;
  scaleX: MilkdropExpressionNode | null;
  scaleY: MilkdropExpressionNode | null;
  offsetX: MilkdropExpressionNode | null;
  offsetY: MilkdropExpressionNode | null;
};

export type MilkdropShaderTextureWarpExpressions = {
  amount: MilkdropExpressionNode | null;
  scaleX: MilkdropExpressionNode | null;
  scaleY: MilkdropExpressionNode | null;
  offsetX: MilkdropExpressionNode | null;
  offsetY: MilkdropExpressionNode | null;
};

export type MilkdropShaderExpressionNode =
  | { type: 'literal'; value: number }
  | { type: 'identifier'; name: string }
  | {
      type: 'unary';
      operator: '+' | '-';
      operand: MilkdropShaderExpressionNode;
    }
  | {
      type: 'binary';
      operator: '+' | '-' | '*' | '/';
      left: MilkdropShaderExpressionNode;
      right: MilkdropShaderExpressionNode;
    }
  | {
      type: 'call';
      name: string;
      args: MilkdropShaderExpressionNode[];
    }
  | {
      type: 'member';
      object: MilkdropShaderExpressionNode;
      property: string;
    };

export type MilkdropShaderStatement = {
  declaration: 'const' | 'float' | 'vec2' | 'vec3' | null;
  target: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  rawValue: string;
  expression: MilkdropShaderExpressionNode;
  source: string;
};

export type MilkdropShaderControlExpressions = {
  warpScale: MilkdropExpressionNode | null;
  offsetX: MilkdropExpressionNode | null;
  offsetY: MilkdropExpressionNode | null;
  rotation: MilkdropExpressionNode | null;
  zoom: MilkdropExpressionNode | null;
  saturation: MilkdropExpressionNode | null;
  contrast: MilkdropExpressionNode | null;
  colorScale: {
    r: MilkdropExpressionNode | null;
    g: MilkdropExpressionNode | null;
    b: MilkdropExpressionNode | null;
  };
  hueShift: MilkdropExpressionNode | null;
  mixAlpha: MilkdropExpressionNode | null;
  brightenBoost: MilkdropExpressionNode | null;
  invertBoost: MilkdropExpressionNode | null;
  solarizeBoost: MilkdropExpressionNode | null;
  tint: {
    r: MilkdropExpressionNode | null;
    g: MilkdropExpressionNode | null;
    b: MilkdropExpressionNode | null;
  };
  textureLayer: MilkdropShaderTextureLayerExpressions;
  warpTexture: MilkdropShaderTextureWarpExpressions;
};

export type MilkdropShaderControls = {
  warpScale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  zoom: number;
  saturation: number;
  contrast: number;
  colorScale: MilkdropShaderColorControls;
  hueShift: number;
  mixAlpha: number;
  brightenBoost: number;
  invertBoost: number;
  solarizeBoost: number;
  tint: MilkdropShaderColorControls;
  textureLayer: MilkdropShaderTextureLayerControls;
  warpTexture: MilkdropShaderTextureWarpControls;
};

export type MilkdropPostEffects = {
  shaderEnabled: boolean;
  textureWrap: boolean;
  feedbackTexture: boolean;
  outerBorderStyle: boolean;
  innerBorderStyle: boolean;
  shaderControls: MilkdropShaderControls;
  shaderControlExpressions: MilkdropShaderControlExpressions;
  brighten: boolean;
  darken: boolean;
  solarize: boolean;
  invert: boolean;
  gammaAdj: number;
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
  shaderText: {
    warp: string | null;
    comp: string | null;
    warpAst: MilkdropShaderStatement[];
    compAst: MilkdropShaderStatement[];
    supported: boolean;
    unsupportedLines: string[];
    controls: MilkdropShaderControls;
    controlExpressions: MilkdropShaderControlExpressions;
  };
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
  styled: boolean;
};

export type MilkdropMotionVectorVisual = {
  positions: number[];
  color: MilkdropColor;
  alpha: number;
  thickness: number;
  additive: boolean;
};

export type MilkdropProceduralFieldVisual = {
  density: number;
  zoom: number;
  rotation: number;
  warp: number;
  warpAnimSpeed: number;
};

export type MilkdropProceduralWaveVisual = {
  samples: number[];
  velocities: number[];
  mode: number;
  centerX: number;
  centerY: number;
  scale: number;
  mystery: number;
  time: number;
  beatPulse: number;
  trebleAtt: number;
  color: MilkdropColor;
  alpha: number;
  additive: boolean;
  thickness: number;
};

export type MilkdropProceduralCustomWaveVisual = {
  samples: number[];
  spectrum: boolean;
  centerX: number;
  centerY: number;
  scaling: number;
  mystery: number;
  time: number;
  color: MilkdropColor;
  alpha: number;
  additive: boolean;
};

export type MilkdropProceduralMotionVectorFieldVisual = {
  countX: number;
  countY: number;
  zoom: number;
  rotation: number;
  warp: number;
  warpAnimSpeed: number;
};

export type MilkdropGpuGeometryHints = {
  mainWave: MilkdropProceduralWaveVisual | null;
  trailWaves: MilkdropProceduralWaveVisual[];
  customWaves: MilkdropProceduralCustomWaveVisual[];
  meshField: MilkdropProceduralFieldVisual | null;
  motionVectorField: MilkdropProceduralMotionVectorFieldVisual | null;
};

export type MilkdropPostVisual = {
  shaderEnabled: boolean;
  textureWrap: boolean;
  feedbackTexture: boolean;
  outerBorderStyle: boolean;
  innerBorderStyle: boolean;
  shaderControls: MilkdropShaderControls;
  brighten: boolean;
  darken: boolean;
  solarize: boolean;
  invert: boolean;
  gammaAdj: number;
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
  inputX: number;
  inputY: number;
  input_x: number;
  input_y: number;
  inputDx: number;
  inputDy: number;
  input_dx: number;
  input_dy: number;
  inputSpeed: number;
  input_speed: number;
  inputPressed: number;
  input_pressed: number;
  inputJustPressed: number;
  input_just_pressed: number;
  inputJustReleased: number;
  input_just_released: number;
  inputCount: number;
  input_count: number;
  gestureScale: number;
  gesture_scale: number;
  gestureRotation: number;
  gesture_rotation: number;
  gestureTranslateX: number;
  gestureTranslateY: number;
  gesture_translate_x: number;
  gesture_translate_y: number;
  hoverActive: number;
  hover_active: number;
  hoverX: number;
  hoverY: number;
  hover_x: number;
  hover_y: number;
  wheelDelta: number;
  wheel_delta: number;
  wheelAccum: number;
  wheel_accum: number;
  dragIntensity: number;
  drag_intensity: number;
  dragAngle: number;
  drag_angle: number;
  accentPulse: number;
  accent_pulse: number;
  actionAccent: number;
  action_accent: number;
  actionModeNext: number;
  action_mode_next: number;
  actionModePrevious: number;
  action_mode_previous: number;
  actionPresetNext: number;
  action_preset_next: number;
  actionPresetPrevious: number;
  action_preset_previous: number;
  actionQuickLook1: number;
  action_quick_look_1: number;
  actionQuickLook2: number;
  action_quick_look_2: number;
  actionQuickLook3: number;
  action_quick_look_3: number;
  actionRemix: number;
  action_remix: number;
  inputSourcePointer: number;
  input_source_pointer: number;
  inputSourceKeyboard: number;
  input_source_keyboard: number;
  inputSourceGamepad: number;
  input_source_gamepad: number;
  inputSourceMouse: number;
  input_source_mouse: number;
  inputSourceTouch: number;
  input_source_touch: number;
  inputSourcePen: number;
  input_source_pen: number;
  motionX: number;
  motionY: number;
  motionZ: number;
  motion_x: number;
  motion_y: number;
  motion_z: number;
  motionEnabled: number;
  motion_enabled: number;
  motionStrength: number;
  motion_strength: number;
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
  motionVectors: MilkdropMotionVectorVisual[];
  post: MilkdropPostVisual;
  signals: MilkdropRuntimeSignals;
  variables: Record<string, number>;
  compatibility: MilkdropCompatibilityReport;
  gpuGeometry: MilkdropGpuGeometryHints;
};

export type MilkdropBlendState = {
  background: MilkdropColor;
  waveform: MilkdropWaveVisual;
  mainWave: MilkdropWaveVisual;
  customWaves: MilkdropWaveVisual[];
  trails: MilkdropPolyline[];
  shapes: MilkdropShapeVisual[];
  borders: MilkdropBorderVisual[];
  motionVectors: MilkdropMotionVectorVisual[];
  post: MilkdropPostVisual;
  alpha: number;
};

export type MilkdropRenderPayload = {
  frameState: MilkdropFrameState;
  blendState?: MilkdropBlendState | null;
};

export type MilkdropFeedbackCompositeState = {
  mixAlpha: number;
  zoom: number;
  brighten: number;
  darken: number;
  solarize: number;
  invert: number;
  gammaAdj: number;
  textureWrap: number;
  feedbackTexture: number;
  warpScale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  zoomMul: number;
  saturation: number;
  contrast: number;
  colorScale: {
    r: number;
    g: number;
    b: number;
  };
  hueShift: number;
  brightenBoost: number;
  invertBoost: number;
  solarizeBoost: number;
  tint: {
    r: number;
    g: number;
    b: number;
  };
  overlayTextureSource: number;
  overlayTextureMode: number;
  overlayTextureAmount: number;
  overlayTextureScale: {
    x: number;
    y: number;
  };
  overlayTextureOffset: {
    x: number;
    y: number;
  };
  warpTextureSource: number;
  warpTextureAmount: number;
  warpTextureScale: {
    x: number;
    y: number;
  };
  warpTextureOffset: {
    x: number;
    y: number;
  };
  signalBass: number;
  signalMid: number;
  signalTreb: number;
  signalBeat: number;
  signalEnergy: number;
  signalTime: number;
};

export type MilkdropFeedbackSetRenderTarget = {
  bivarianceHack(target: unknown | null): void;
}['bivarianceHack'];

export interface MilkdropFeedbackManager {
  applyCompositeState(state: MilkdropFeedbackCompositeState): void;
  render(
    renderer: {
      render(scene: Scene, camera: Camera): void;
      setRenderTarget?: MilkdropFeedbackSetRenderTarget;
    },
    sourceScene: Scene,
    sourceCamera: Camera,
  ): boolean;
  swap(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface MilkdropVM {
  setPreset(preset: MilkdropCompiledPreset): void;
  setDetailScale(scale: number): void;
  setRenderBackend(backend: 'webgl' | 'webgpu'): void;
  reset(): void;
  step(signals: MilkdropRuntimeSignals): MilkdropFrameState;
  getStateSnapshot(): Record<string, number>;
}

export interface MilkdropRendererAdapter {
  readonly backend: 'webgl' | 'webgpu';
  attach(): void;
  setPreset(preset: MilkdropCompiledPreset): void;
  render(payload: MilkdropRenderPayload): boolean;
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
  corpusTier?: 'bundled' | 'certified' | 'exploratory';
  certification?: 'bundled' | 'certified' | 'exploratory';
  expectedFidelityClass?: MilkdropFidelityClass;
  visualEvidenceTier?: MilkdropVisualEvidenceTier;
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
