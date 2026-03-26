import type { Camera, Scene } from 'three';
import type {
  MilkdropCompatibilityReport,
  MilkdropCompiledPreset,
  MilkdropGpuFieldProgramDescriptor,
  MilkdropShaderControls,
  MilkdropShaderProgramPayload,
  MilkdropVideoEchoOrientation,
} from './compiler-types.ts';
import type { MilkdropRuntimeSignals } from './runtime-types.ts';

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

export type MilkdropGpuFieldSignalInputs = {
  time: number;
  frame: number;
  fps: number;
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
};

export type MilkdropProceduralMeshFieldVisual =
  MilkdropProceduralFieldTransformVisual & {
    density: number;
    program: MilkdropGpuFieldProgramDescriptor | null;
    signals: MilkdropGpuFieldSignalInputs;
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
  };

export type MilkdropGpuGeometryHints = {
  mainWave: MilkdropProceduralWaveVisual | null;
  trailWaves: MilkdropProceduralWaveVisual[];
  customWaves: MilkdropProceduralCustomWaveVisual[];
  meshField: MilkdropProceduralMeshFieldVisual | null;
  motionVectorField: MilkdropProceduralMotionVectorFieldVisual | null;
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
  shaderControls: MilkdropShaderControls;
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
  warp: number;
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
  mixAlpha: number;
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
  setAdaptiveQuality?(
    multipliers: Partial<{
      feedbackResolutionMultiplier: number;
    }>,
  ): void;
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
  setAdaptiveQuality?(
    multipliers: Partial<{
      feedbackResolutionMultiplier: number;
    }>,
  ): void;
  render(payload: MilkdropRenderPayload): boolean;
  resize(width: number, height: number): void;
  dispose(): void;
}
