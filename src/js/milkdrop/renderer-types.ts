import type { Camera, Scene, Texture } from 'three';
import type { MilkdropExpressionNode } from './common-types.ts';
import type {
  MilkdropCompatibilityReport,
  MilkdropCompiledPreset,
  MilkdropGpuFieldProgramDescriptor,
  MilkdropShaderControls,
  MilkdropShaderProgramPayload,
  MilkdropVideoEchoOrientation,
} from './compiler-types.ts';
import type { MilkdropRuntimeSignals } from './runtime-types.ts';

export type MilkdropPostprocessingProfile = {
  enabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  afterimageDamp: number;
  filmNoise: number;
  filmScanlines: number;
  filmScanlineCount: number;
  vignetteStrength: number;
  chromaOffset: number;
  saturation: number;
  contrast: number;
  pulseWarp: number;
};

export type MilkdropColor = {
  r: number;
  g: number;
  b: number;
  a?: number;
};

export type MilkdropPolyline = {
  positions: number[] | Float32Array;
  color: MilkdropColor;
  alpha: number;
  thickness: number;
  closed?: boolean;
};

export type MilkdropWaveVisual = MilkdropPolyline & {
  /** Optional RGB triplets, one per vertex, used for custom-wave per-point colors. */
  colors?: number[] | Float32Array;
  drawMode: 'line' | 'dots';
  additive: boolean;
  blendMode?: 'subtractive' | 'multiplicative';
  pointSize: number;
  spectrum?: boolean;
};

/**
 * The warp grid the feedback pass draws the previous frame onto: vertex
 * positions are the transformed lattice (renderer space), uvs are where each
 * vertex reads from in the previous frame. Buffers are owned by the VM and
 * reused across frames — consumers must upload, not retain.
 */
export type MilkdropWarpFieldVisual = {
  density: number;
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
};

export type MilkdropMeshVisual = {
  positions: number[] | Float32Array;
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
  textured: boolean;
  textureZoom: number;
  textureAngle: number;
  color: MilkdropColor;
  secondaryColor?: MilkdropColor | null;
  borderColor: MilkdropColor;
  additive: boolean;
  blendMode?: 'subtractive' | 'multiplicative';
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

export type MilkdropProceduralFieldTransformVisual = {
  zoom: number;
  zoomExponent: number;
  rotation: number;
  warp: number;
  warpAnimSpeed: number;
  centerX: number;
  centerY: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
};

/** Frame-constant `q` register values a lowered per-pixel program reads as
 * uniforms. Sparse: producers only populate the registers the program's
 * `registerInputs` actually name (full bank is `q1`..`q32`). */
export type MilkdropPerFrameFieldRegisters = Partial<Record<string, number>>;

export type MilkdropGpuFieldSignalInputs = {
  time: number;
  frame: number;
  fps: number;
  aspect?: number;
  bass: number;
  mid: number;
  mids: number;
  treble: number;
  bassAtt: number;
  midAtt: number;
  midsAtt: number;
  trebleAtt: number;
  beat: number;
  beatPulse: number;
  rms: number;
  vol: number;
  music: number;
  weightedEnergy: number;
  /** Real viewport pixel size when the runtime knows it; consumers fall back
   * to deriveMilkdropViewportSignalValues' aspect-based estimate otherwise. */
  pixelsx?: number;
  pixelsy?: number;
};

export type MilkdropProceduralMeshFieldVisual =
  MilkdropProceduralFieldTransformVisual & {
    density: number;
    program: MilkdropGpuFieldProgramDescriptor | null;
    signals: MilkdropGpuFieldSignalInputs;
    registers?: MilkdropPerFrameFieldRegisters;
  };

export type MilkdropProceduralWaveVisual = {
  samples: number[] | Float32Array;
  velocities: number[] | Float32Array;
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
  closed: boolean;
};

export type MilkdropProceduralCustomWaveVisual = {
  samples: number[] | Float32Array;
  sampleValues2?: number[] | Float32Array;
  spectrum: boolean;
  centerX: number;
  centerY: number;
  scaling: number;
  mystery: number;
  time: number;
  sampleCount?: number;
  signals?: MilkdropGpuFieldSignalInputs;
  fieldProgram?: MilkdropGpuFieldProgramDescriptor | null;
  color: MilkdropColor;
  alpha: number;
  additive: boolean;
  thickness: number;
};

export type MilkdropProceduralMotionVectorFieldVisual =
  MilkdropProceduralFieldTransformVisual & {
    countX: number;
    countY: number;
    sourceOffsetX: number;
    sourceOffsetY: number;
    explicitLength: number;
    legacyControls: boolean;
    program: MilkdropGpuFieldProgramDescriptor | null;
    signals: MilkdropGpuFieldSignalInputs;
    registers?: MilkdropPerFrameFieldRegisters;
    /** Warp mesh density, for the meshx/meshy builtins. */
    density?: number;
    tint?: MilkdropColor;
    alpha?: number;
  };

export type MilkdropParticleFieldVisual = {
  enabled: boolean;
  instanceCount: number;
  size: number;
  alpha: number;
  motionScale: number;
  seed: number;
  anchorSource: 'mesh-field';
};

export type MilkdropGpuGeometryHints = {
  mainWave: MilkdropProceduralWaveVisual | null;
  trailWaves: MilkdropProceduralWaveVisual[];
  customWaves: MilkdropProceduralCustomWaveVisual[];
  meshField: MilkdropProceduralMeshFieldVisual | null;
  motionVectorField: MilkdropProceduralMotionVectorFieldVisual | null;
  particleField?: MilkdropParticleFieldVisual | null;
};

export type MilkdropGpuInteractionTransform = {
  offsetX: number;
  offsetY: number;
  rotation: number;
  scale: number;
  alphaMultiplier: number;
};

export type MilkdropGpuInteractionPayload = {
  waves: MilkdropGpuInteractionTransform;
  mesh: MilkdropGpuInteractionTransform;
  motionVectors: MilkdropGpuInteractionTransform;
};

export type MilkdropPostVisual = {
  shaderEnabled: boolean;
  textureWrap: boolean;
  feedbackTexture: boolean;
  outerBorderStyle: boolean;
  innerBorderStyle: boolean;
  redBlueStereo?: boolean;
  shaderControls: MilkdropShaderControls;
  shaderPrograms: {
    warp: MilkdropShaderProgramPayload | null;
    comp: MilkdropShaderProgramPayload | null;
  };
  /** Per-pixel equation targets and their expression trees for GPU evaluation */
  perPixelPrograms?: Array<{ target: string; exprStrings: string[] }> | null;
  /** Per-pixel equation targets and source expressions for fragment evaluation */
  perPixelStatements?: Array<{
    target: string;
    source: string;
    expression: MilkdropExpressionNode;
  }> | null;
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
  warp: number;
  decay: number;
  postprocessingProfile?: MilkdropPostprocessingProfile | null;
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
  /** Null when the preset's transform is identity or a shader owns the warp. */
  warpField?: MilkdropWarpFieldVisual | null;
  interaction?: MilkdropGpuInteractionPayload | null;
};

export type MilkdropCpuBlendState = {
  mode: 'cpu';
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

export type MilkdropGpuBlendState = {
  mode: 'gpu';
  previousFrame: MilkdropFrameState;
  alpha: number;
};

export type MilkdropBlendState = MilkdropCpuBlendState | MilkdropGpuBlendState;

export type MilkdropRenderPayload = {
  frameState: MilkdropFrameState;
  blendState?: MilkdropBlendState | null;
};

export type MilkdropFeedbackCompositeState = {
  shaderExecution: 'controls' | 'direct';
  shaderPrograms: {
    warp: MilkdropShaderProgramPayload | null;
    comp: MilkdropShaderProgramPayload | null;
  };
  /** Per-pixel equation programs that modify warp/zoom/rot per fragment */
  perPixelPrograms?: {
    statements: Array<{
      target: string;
      source: string;
      expression: MilkdropExpressionNode;
    }>;
  } | null;
  perPixelVariables?: Readonly<Record<string, number>>;
  mixAlpha: number;
  videoEchoAlpha: number;
  zoom: number;
  videoEchoOrientation: MilkdropVideoEchoOrientation;
  brighten: number;
  darken: number;
  darkenCenter: number;
  solarize: number;
  invert: number;
  redBlueStereo?: number;
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
  vignette?: number;
  chromaticAberration?: number;
  tint: {
    r: number;
    g: number;
    b: number;
  };
  overlayTextureSource: number;
  overlayTextureMode: number;
  overlayTextureSampleDimension: number;
  overlayTextureInvert: number;
  overlayTextureAmount: number;
  overlayTextureScale: {
    x: number;
    y: number;
  };
  overlayTextureOffset: {
    x: number;
    y: number;
  };
  overlayTextureVolumeSliceZ: number;
  warpTextureSource: number;
  warpTextureSampleDimension: number;
  warpTextureAmount: number;
  warpTextureScale: {
    x: number;
    y: number;
  };
  warpTextureOffset: {
    x: number;
    y: number;
  };
  warpTextureVolumeSliceZ: number;
  signalBass: number;
  signalBassAtt?: number;
  signalMid: number;
  signalMidAtt?: number;
  signalTreb: number;
  signalTrebAtt?: number;
  /** Harmonic/percussive decomposition; see
   * `harmonic-percussive-shader-signals.ts` for the neutral defaults applied
   * when the host has not supplied them. */
  signalPercussive?: number;
  signalHarmonic?: number;
  signalPercussiveLow?: number;
  signalPercussiveMid?: number;
  signalPercussiveHigh?: number;
  signalPercussiveRatio?: number;
  signalBeat: number;
  signalBeatPulse: number;
  signalEnergy: number;
  signalTime: number;
  signalFrame?: number;
  signalFps?: number;
  aspect: number;
  decay: number;
  /** Effective feedback softening for this preset. Zero when the preset never
   * samples the blur textures, so the always-on softness taps (and the
   * backend's blur passes) are skipped instead of rasterizing work nothing
   * consumes. */
  feedbackSoftness: number;
};

export type MilkdropFeedbackSetRenderTarget = {
  bivarianceHack(target: unknown | null): void;
}['bivarianceHack'];

export interface MilkdropFeedbackManager {
  applyCompositeState(state: MilkdropFeedbackCompositeState): void;
  applyPostprocessingProfile?(
    profile: MilkdropPostprocessingProfile | null | undefined,
  ): void;
  getShapeTexture?(): Texture | null;
  /**
   * This frame's warp grid. Optional: a manager without it falls back to the
   * uniform-driven warp, which cannot express per-pixel transforms.
   */
  setWarpField?(field: MilkdropWarpFieldVisual | null): void;
  setAudioTexture?(texture: Texture | null): void;
  setAdaptiveQuality?(
    multipliers: Partial<{
      feedbackResolutionMultiplier: number;
    }>,
  ): void;
  saveCurrentFrame?(): void;
  setTransitionBlend?(alpha: number): void;
  /** True while an async warp/comp shader swap is still warming. */
  isDirectShaderSwapPending?(): boolean;
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

/* global GPUDevice */

export interface MilkdropVM {
  setPreset(preset: MilkdropCompiledPreset): void;
  setDetailScale(scale: number): void;
  setRenderBackend(backend: 'webgl' | 'webgpu'): void;
  setGpuDevice(device: GPUDevice | null): void;
  reset(): void;
  /**
   * Apply one numeric field to live per-frame state without recompiling.
   * Feeds the Tune pane's drag feedback: a fader moves and the next frame
   * reflects it, while the source/compile path stays on the commit.
   */
  setField(key: string, value: number): void;
  step(signals: MilkdropRuntimeSignals): MilkdropFrameState;
  stepAsync?(signals: MilkdropRuntimeSignals): Promise<MilkdropFrameState>;
  getStateSnapshot(): Record<string, number>;
}

export interface MilkdropRendererAdapter {
  readonly backend: 'webgl' | 'webgpu';
  attach(): void;
  setPreset(preset: MilkdropCompiledPreset): void;
  setAdaptiveQuality?(
    multipliers: Partial<{
      feedbackResolutionMultiplier: number;
    }>,
  ): void;
  saveFeedbackFrame?(): void;
  setTransitionBlend?(alpha: number): void;
  render(payload: MilkdropRenderPayload): boolean;
  getAudioTexture?(): Texture | null;
  resize(width: number, height: number): void;
  dispose(): void;
}
