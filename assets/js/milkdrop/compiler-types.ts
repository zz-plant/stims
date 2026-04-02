import type {
  MilkdropBackendSupport,
  MilkdropCompatibilityFeatureKey,
  MilkdropDiagnostic,
  MilkdropExpressionNode,
  MilkdropFeatureAnalysis,
  MilkdropParityReport,
  MilkdropPresetAST,
  MilkdropPresetSource,
  MilkdropProgramBlock,
  MilkdropRenderBackend,
} from './common-types.ts';

export type MilkdropGpuDescriptorRouting =
  | 'generic-frame-payload'
  | 'descriptor-plan'
  | 'fallback-webgl';

export type MilkdropProceduralWaveDescriptorPlan = {
  kind: 'procedural-wave';
  target: 'main-wave' | 'trail-waves' | 'custom-wave';
  slotIndex: number | null;
  sampleSource: 'waveform' | 'spectrum';
  fieldProgram?: MilkdropGpuFieldProgramDescriptor | null;
};

export type MilkdropGpuFieldExpression =
  | { type: 'literal'; value: number }
  | { type: 'identifier'; name: string }
  | {
      type: 'unary';
      operator: '+' | '-' | '!';
      operand: MilkdropGpuFieldExpression;
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
      left: MilkdropGpuFieldExpression;
      right: MilkdropGpuFieldExpression;
    }
  | {
      type: 'call';
      name: string;
      args: MilkdropGpuFieldExpression[];
    };

export type MilkdropGpuFieldStatement = {
  target: string;
  expression: MilkdropGpuFieldExpression;
};

export type MilkdropGpuFieldProgramDescriptor = {
  kind: 'gpu-field-program';
  statements: MilkdropGpuFieldStatement[];
  temporaries: string[];
  signature: string;
};

export type MilkdropProceduralMeshDescriptorPlan = {
  kind: 'procedural-mesh';
  requiresPerPixelProgram: boolean;
  fieldProgram: MilkdropGpuFieldProgramDescriptor | null;
};

export type MilkdropProceduralMotionVectorDescriptorPlan = {
  kind: 'procedural-motion-vectors';
  requiresPerPixelProgram: boolean;
  fieldProgram: MilkdropGpuFieldProgramDescriptor | null;
};

export type MilkdropFeedbackPostEffectDescriptorPlan = {
  kind: 'feedback-post-effect';
  shaderExecution: 'none' | 'controls' | 'direct';
  usesFeedbackTexture: boolean;
  usesVideoEcho: boolean;
  usesPostEffects: boolean;
  targetResolution: 'feedback' | 'scene' | 'adaptive';
  fallbackToLegacyFeedback: boolean;
};

export type MilkdropGpuDescriptorUnsupportedMarker = {
  kind: 'unsupported-feature';
  feature: MilkdropCompatibilityFeatureKey;
  reason: string;
  recommendedFallback: MilkdropRenderBackend;
};

export type MilkdropWebGpuDescriptorPlan = {
  routing: MilkdropGpuDescriptorRouting;
  proceduralWaves: MilkdropProceduralWaveDescriptorPlan[];
  proceduralMesh: MilkdropProceduralMeshDescriptorPlan | null;
  proceduralMotionVectors: MilkdropProceduralMotionVectorDescriptorPlan | null;
  feedback: MilkdropFeedbackPostEffectDescriptorPlan | null;
  unsupported: MilkdropGpuDescriptorUnsupportedMarker[];
};

export type MilkdropCompatibilityReport = {
  backends: {
    webgl: MilkdropBackendSupport;
    webgpu: MilkdropBackendSupport;
  };
  gpuDescriptorPlans: {
    webgpu: MilkdropWebGpuDescriptorPlan;
  };
  parity: MilkdropParityReport;
  featureAnalysis: MilkdropFeatureAnalysis;
  warnings: string[];
  blockingReasons: string[];
  supportedFeatures: string[];
  unsupportedKeys: string[];
  softUnknownKeys: string[];
  hardUnsupportedKeys: string[];
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

export type MilkdropShaderSampleDimension = '2d' | '3d';

export type MilkdropShaderSampleValue = {
  dimension: MilkdropShaderSampleDimension;
  uv: MilkdropShaderExpressionNode;
  z: MilkdropShaderExpressionNode | null;
};

export type MilkdropExtractedShaderSampleMetadata = {
  source: string;
  sampleDimension: MilkdropShaderSampleDimension;
  uv: MilkdropShaderExpressionNode;
  volumeSliceZ: MilkdropShaderExpressionNode | null;
};

export type MilkdropShaderTextureLayerControls = {
  source: MilkdropShaderTextureSampler;
  mode: MilkdropShaderTextureBlendMode;
  sampleDimension: MilkdropShaderSampleDimension;
  inverted: boolean;
  amount: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  volumeSliceZ: number | null;
};

export type MilkdropShaderTextureWarpControls = {
  source: MilkdropShaderTextureSampler;
  sampleDimension: MilkdropShaderSampleDimension;
  amount: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  volumeSliceZ: number | null;
};

export type MilkdropShaderTextureLayerExpressions = {
  sampleDimension: MilkdropShaderSampleDimension;
  amount: MilkdropExpressionNode | null;
  scaleX: MilkdropExpressionNode | null;
  scaleY: MilkdropExpressionNode | null;
  offsetX: MilkdropExpressionNode | null;
  offsetY: MilkdropExpressionNode | null;
  volumeSliceZ: MilkdropExpressionNode | null;
};

export type MilkdropShaderTextureWarpExpressions = {
  sampleDimension: MilkdropShaderSampleDimension;
  amount: MilkdropExpressionNode | null;
  scaleX: MilkdropExpressionNode | null;
  scaleY: MilkdropExpressionNode | null;
  offsetX: MilkdropExpressionNode | null;
  offsetY: MilkdropExpressionNode | null;
  volumeSliceZ: MilkdropExpressionNode | null;
};

export type MilkdropShaderExpressionNode =
  | { type: 'literal'; value: number }
  | { type: 'identifier'; name: string }
  | {
      type: 'unary';
      operator: '+' | '-' | '!';
      operand: MilkdropShaderExpressionNode;
    }
  | {
      type: 'binary';
      operator:
        | '+'
        | '-'
        | '*'
        | '/'
        | '%'
        | '<'
        | '<='
        | '>'
        | '>='
        | '=='
        | '!='
        | '&&'
        | '||';
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

export type MilkdropShaderProgramStage = 'warp' | 'comp';

export type MilkdropShaderProgramExecutionDescriptor = {
  kind: 'direct-feedback-program';
  stage: MilkdropShaderProgramStage;
  entryTarget: 'uv' | 'ret';
  supportedBackends: MilkdropRenderBackend[];
  requiresControlFallback: boolean;
  statementTargets: string[];
};

export type MilkdropShaderProgramPayload = {
  stage: MilkdropShaderProgramStage;
  source: string;
  normalizedLines: string[];
  statements: MilkdropShaderStatement[];
  execution: MilkdropShaderProgramExecutionDescriptor;
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

export type MilkdropVideoEchoOrientation = 0 | 1 | 2 | 3;

export type MilkdropPostEffects = {
  shaderEnabled: boolean;
  textureWrap: boolean;
  feedbackTexture: boolean;
  outerBorderStyle: boolean;
  innerBorderStyle: boolean;
  shaderControls: MilkdropShaderControls;
  shaderControlExpressions: MilkdropShaderControlExpressions;
  shaderPrograms: {
    warp: MilkdropShaderProgramPayload | null;
    comp: MilkdropShaderProgramPayload | null;
  };
  brighten: boolean;
  darken: boolean;
  darkenCenter: boolean;
  solarize: boolean;
  invert: boolean;
  gammaAdj: number;
  videoEchoEnabled: boolean;
  videoEchoAlpha: number;
  videoEchoZoom: number;
  videoEchoOrientation: MilkdropVideoEchoOrientation;
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
    warpProgram: MilkdropShaderProgramPayload | null;
    compProgram: MilkdropShaderProgramPayload | null;
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
