import {
  clearDebugSnapshot,
  isAgentMode,
  setDebugSnapshot,
} from '../core/agent-api.ts';
import type { ShaderQuality } from '../core/performance-panel';
import {
  isCompatibilityModeEnabled,
  setCompatibilityMode,
} from '../core/render-preferences';
import { getCachedRendererCapabilities } from '../core/renderer-capabilities.ts';
import {
  type AdaptiveQualityController,
  type AdaptiveQualityState,
  createAdaptiveQualityController,
} from '../core/services/adaptive-quality-controller.ts';
import {
  type QualityPreset,
  setQualityPresetById,
} from '../core/settings-panel.ts';
import type { ToyRuntimeFrame, ToyRuntimeInstance } from '../core/toy-runtime';
import type { QualityPresetManager } from '../utils/toy-settings';
import type { UnifiedInputState } from '../utils/unified-input';
import { createMilkdropCatalogStore } from './catalog-store';
import { compileMilkdropPresetSource } from './compiler';
import { createMilkdropEditorSession } from './editor-session';
import { upsertMilkdropFields } from './formatter';
import { MilkdropOverlay } from './overlay';
import { consumeRequestedMilkdropOverlayTab } from './overlay-intent';
import { consumeRequestedMilkdropPresetSelection } from './preset-selection';
import { createMilkdropRendererAdapter } from './renderer-adapter-factory';
import { createMilkdropCatalogCoordinator } from './runtime/catalog-coordinator';
import { createMilkdropRuntimeInteractionPresenter } from './runtime/interaction-presenter';
import { createMilkdropPresetFileActions } from './runtime/preset-file-actions';
import { createMilkdropPresetNavigationController } from './runtime/preset-navigation-controller';
import { createMilkdropRuntimePreferences } from './runtime/runtime-preferences';
import { cloneBlendState, estimateFrameBlendWorkload } from './runtime/session';
import {
  installRequestedOverlayTabListener,
  installRequestedPresetListener,
} from './runtime/ui-bridge';
import { createMilkdropSignalTracker } from './runtime-signals';
import type {
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropGpuGeometryHints,
  MilkdropGpuInteractionPayload,
  MilkdropPostVisual,
  MilkdropRuntimeSignals,
} from './types';
import { createMilkdropVM } from './vm';
import {
  getDisabledMilkdropWebGpuOptimizationFlags,
  resolveMilkdropWebGpuOptimizationFlags,
  shouldFallbackMilkdropPresetToWebgl,
} from './webgpu-optimization-flags';

const DEFAULT_PRESET_SOURCE = `title=Signal Bloom
author=Stims
description=Curated fallback preset used before the bundled catalog loads.

fRating=4
blend_duration=2.5
fDecay=0.93
zoom=1.02
rot=0.01
warp=0.14
wave_mode=0
wave_scale=1.08
wave_smoothing=0.72
wave_a=0.88
wave_r=0.35
wave_g=0.72
wave_b=1
wave_x=0.5
wave_y=0.52
wave_mystery=0.24
mesh_density=18
mesh_alpha=0.18
mesh_r=0.28
mesh_g=0.52
mesh_b=0.94
bg_r=0.02
bg_g=0.03
bg_b=0.06
bBrighten=1
video_echo_enabled=1
video_echo_alpha=0.18
video_echo_zoom=1.03
ob_size=0.02
ob_r=0.9
ob_g=0.95
ob_b=1
ob_a=0.76
shapecode_0_enabled=1
shapecode_0_sides=6
shapecode_0_x=0.5
shapecode_0_y=0.5
shapecode_0_rad=0.17
shapecode_0_ang=0
shapecode_0_a=0.18
shapecode_0_r=1
shapecode_0_g=0.48
shapecode_0_b=0.84
shapecode_0_border_a=0.9
shapecode_0_border_r=1
shapecode_0_border_g=0.78
shapecode_0_border_b=1
shapecode_0_additive=1
shapecode_0_thickoutline=1
wavecode_0_enabled=1
wavecode_0_samples=72
wavecode_0_spectrum=1
wavecode_0_additive=1
wavecode_0_r=0.92
wavecode_0_g=0.6
wavecode_0_b=1
wavecode_0_a=0.42

per_frame_1=zoom = 1.0 + bass_att * 0.08
per_frame_2=rot = rot + beat_pulse * 0.004
per_frame_3=wave_y = 0.5 + sin(time * 0.35) * 0.08
per_frame_4=shape_1_ang = shape_1_ang + 0.01 + treb_att * 0.01
per_frame_5=ob_size = 0.01 + beat_pulse * 0.02

per_pixel_1=warp = warp + sin(rad * 10 + time * 0.8) * 0.03
wave_0_per_frame1=a = 0.18 + bass_att * 0.36
wave_0_per_point1=y = y + sin(sample * pi * 12 + time) * 0.06
shape_0_per_frame1=rad = 0.14 + beat_pulse * 0.08
`;

function sanitizeRuntimeSignals(signals: MilkdropRuntimeSignals) {
  const {
    frequencyData: _frequencyData,
    waveformData: _waveformData,
    ...rest
  } = signals;
  return rest;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function normalizeSceneTranslation(value: number) {
  return clamp(value, -0.22, 0.22);
}

function transformScenePositions(
  positions: number[],
  {
    offsetX,
    offsetY,
    rotation,
    scale,
  }: { offsetX: number; offsetY: number; rotation: number; scale: number },
) {
  if (
    positions.length === 0 ||
    (Math.abs(offsetX) < 0.0001 &&
      Math.abs(offsetY) < 0.0001 &&
      Math.abs(rotation) < 0.0001 &&
      Math.abs(scale - 1) < 0.0001)
  ) {
    return positions;
  }

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const transformed = [...positions];

  for (let index = 0; index < transformed.length; index += 3) {
    const x = transformed[index] ?? 0;
    const y = transformed[index + 1] ?? 0;
    const scaledX = x * scale;
    const scaledY = y * scale;
    transformed[index] = scaledX * cos - scaledY * sin + offsetX;
    transformed[index + 1] = scaledX * sin + scaledY * cos + offsetY;
  }

  return transformed;
}

function nudgeCenter(value: number, offset: number) {
  return clamp(value + offset * 0.5, 0, 1);
}

function enhancePostEffects(
  post: MilkdropPostVisual,
  {
    offsetX,
    offsetY,
    rotation,
    pinchDelta,
    dragBoost,
  }: {
    offsetX: number;
    offsetY: number;
    rotation: number;
    pinchDelta: number;
    dragBoost: number;
  },
): MilkdropPostVisual {
  return {
    ...post,
    warp: clamp(
      post.warp + dragBoost * 0.28 + Math.abs(pinchDelta) * 0.12,
      0,
      1,
    ),
    videoEchoZoom: clamp(post.videoEchoZoom + pinchDelta * 0.12, 0.85, 1.35),
    shaderControls: {
      ...post.shaderControls,
      offsetX: clamp(post.shaderControls.offsetX + offsetX * 0.5, -0.3, 0.3),
      offsetY: clamp(post.shaderControls.offsetY + offsetY * 0.5, -0.3, 0.3),
      rotation: clamp(
        post.shaderControls.rotation + rotation * 0.85,
        -1.6,
        1.6,
      ),
      zoom: clamp(post.shaderControls.zoom + pinchDelta * 0.3, 0.72, 1.45),
      warpScale: clamp(
        post.shaderControls.warpScale + pinchDelta * 0.24 + dragBoost * 0.16,
        0,
        2,
      ),
    },
  };
}

function enhanceGpuGeometry(
  gpuGeometry: MilkdropGpuGeometryHints,
  {
    offsetX,
    offsetY,
    rotation,
    scale,
    pinchDelta,
  }: {
    offsetX: number;
    offsetY: number;
    rotation: number;
    scale: number;
    pinchDelta: number;
  },
): MilkdropGpuGeometryHints {
  return {
    ...gpuGeometry,
    mainWave: gpuGeometry.mainWave
      ? {
          ...gpuGeometry.mainWave,
          centerX: nudgeCenter(gpuGeometry.mainWave.centerX, offsetX),
          centerY: nudgeCenter(gpuGeometry.mainWave.centerY, -offsetY),
          scale: clamp(gpuGeometry.mainWave.scale * scale, 0.45, 2.4),
        }
      : null,
    trailWaves: gpuGeometry.trailWaves.map((wave) => ({
      ...wave,
      centerX: nudgeCenter(wave.centerX, offsetX),
      centerY: nudgeCenter(wave.centerY, -offsetY),
      scale: clamp(wave.scale * scale, 0.45, 2.4),
    })),
    customWaves: gpuGeometry.customWaves.map((wave) => ({
      ...wave,
      centerX: nudgeCenter(wave.centerX, offsetX),
      centerY: nudgeCenter(wave.centerY, -offsetY),
      scaling: clamp(wave.scaling * scale, 0.45, 2.4),
    })),
    meshField: gpuGeometry.meshField
      ? {
          ...gpuGeometry.meshField,
          rotation: gpuGeometry.meshField.rotation + rotation * 0.9,
          zoom: clamp(gpuGeometry.meshField.zoom - pinchDelta * 0.2, 0.5, 2.6),
          warp: clamp(
            gpuGeometry.meshField.warp + Math.abs(pinchDelta) * 0.1,
            0,
            1.4,
          ),
        }
      : null,
    motionVectorField: gpuGeometry.motionVectorField
      ? {
          ...gpuGeometry.motionVectorField,
          rotation: gpuGeometry.motionVectorField.rotation + rotation * 0.9,
          zoom: clamp(
            gpuGeometry.motionVectorField.zoom - pinchDelta * 0.2,
            0.5,
            2.6,
          ),
          warp: clamp(
            gpuGeometry.motionVectorField.warp + Math.abs(pinchDelta) * 0.1,
            0,
            1.4,
          ),
        }
      : null,
  };
}

export function applyMilkdropInteractionResponse(
  frameState: MilkdropFrameState,
  input: UnifiedInputState | null,
  backend: 'webgl' | 'webgpu' = 'webgl',
): MilkdropFrameState {
  if (!input) {
    return frameState;
  }

  const gesture = input.gesture;
  const dragBoost = clamp(input.performance.dragIntensity, 0, 1);
  const pinchDelta = clamp((gesture?.scale ?? 1) - 1, -0.45, 0.7);
  const rotation = clamp(gesture?.rotation ?? 0, -Math.PI / 2, Math.PI / 2);
  const offsetX = normalizeSceneTranslation(
    input.dragDelta.x * 0.9 + (gesture?.translation.x ?? 0) * 0.45,
  );
  const offsetY = normalizeSceneTranslation(
    input.dragDelta.y * 0.9 + (gesture?.translation.y ?? 0) * 0.45,
  );
  const scale = clamp(1 + pinchDelta * 0.45, 0.7, 1.55);
  const waveAlphaMultiplier = clamp(
    1 + Math.abs(pinchDelta) * 0.14 + dragBoost * 0.06,
    0.72,
    1.35,
  );
  const meshAlphaMultiplier = clamp(1 + Math.abs(pinchDelta) * 0.12, 0.72, 1.3);
  const motionVectorAlphaMultiplier = clamp(
    1 + Math.abs(pinchDelta) * 0.16 + dragBoost * 0.08,
    0.72,
    1.4,
  );
  const usesGpuInteractionPayload = backend === 'webgpu';

  if (
    dragBoost < 0.001 &&
    Math.abs(pinchDelta) < 0.001 &&
    Math.abs(rotation) < 0.001 &&
    Math.abs(offsetX) < 0.001 &&
    Math.abs(offsetY) < 0.001
  ) {
    return frameState;
  }

  const interaction: MilkdropGpuInteractionPayload | null =
    usesGpuInteractionPayload
      ? {
          waves: {
            offsetX,
            offsetY,
            rotation,
            scale,
            alphaMultiplier: waveAlphaMultiplier,
          },
          mesh: {
            offsetX,
            offsetY,
            rotation,
            scale,
            alphaMultiplier: meshAlphaMultiplier,
          },
          motionVectors: {
            offsetX,
            offsetY,
            rotation,
            scale,
            alphaMultiplier: motionVectorAlphaMultiplier,
          },
        }
      : null;

  return {
    ...frameState,
    interaction,
    mainWave: {
      ...frameState.mainWave,
      positions:
        usesGpuInteractionPayload && frameState.gpuGeometry.mainWave
          ? frameState.mainWave.positions
          : transformScenePositions(frameState.mainWave.positions, {
              offsetX,
              offsetY,
              rotation,
              scale,
            }),
      thickness: clamp(frameState.mainWave.thickness + dragBoost * 0.8, 1, 12),
    },
    customWaves: frameState.customWaves.map((wave, index) => ({
      ...wave,
      positions:
        usesGpuInteractionPayload &&
        Boolean(frameState.gpuGeometry.customWaves[index])
          ? wave.positions
          : transformScenePositions(wave.positions, {
              offsetX,
              offsetY,
              rotation,
              scale,
            }),
    })),
    trails: frameState.trails.map((trail, index) => ({
      ...trail,
      positions:
        usesGpuInteractionPayload &&
        Boolean(frameState.gpuGeometry.trailWaves[index])
          ? trail.positions
          : transformScenePositions(trail.positions, {
              offsetX,
              offsetY,
              rotation,
              scale,
            }),
    })),
    mesh: {
      ...frameState.mesh,
      positions:
        usesGpuInteractionPayload && frameState.gpuGeometry.meshField
          ? frameState.mesh.positions
          : transformScenePositions(frameState.mesh.positions, {
              offsetX,
              offsetY,
              rotation,
              scale,
            }),
      alpha: clamp(frameState.mesh.alpha + Math.abs(pinchDelta) * 0.12, 0, 1),
    },
    shapes: frameState.shapes.map((shape) => ({
      ...shape,
      x: nudgeCenter(shape.x, offsetX),
      y: nudgeCenter(shape.y, -offsetY),
      radius: clamp(shape.radius * scale, 0.02, 0.6),
      rotation: shape.rotation + rotation,
    })),
    motionVectors: frameState.motionVectors.map((vector) => ({
      ...vector,
      positions:
        usesGpuInteractionPayload && frameState.gpuGeometry.motionVectorField
          ? vector.positions
          : transformScenePositions(vector.positions, {
              offsetX,
              offsetY,
              rotation,
              scale,
            }),
    })),
    post: enhancePostEffects(frameState.post, {
      offsetX,
      offsetY,
      rotation,
      pinchDelta,
      dragBoost,
    }),
    gpuGeometry: enhanceGpuGeometry(frameState.gpuGeometry, {
      offsetX,
      offsetY,
      rotation,
      scale,
      pinchDelta,
    }),
  };
}

export function getMilkdropDetailScale({
  backend,
  particleScale,
  particleBudget,
  shaderQuality = 'balanced',
}: {
  backend: 'webgl' | 'webgpu';
  particleScale?: number;
  particleBudget: number;
  shaderQuality?: ShaderQuality;
}) {
  const baseScale = (particleScale ?? 1) * particleBudget;
  const backendBoost = backend === 'webgpu' ? 1.55 : 1.1;
  const shaderQualityScale =
    shaderQuality === 'low' ? 0.72 : shaderQuality === 'high' ? 1.2 : 1;
  return Math.min(
    2,
    Math.max(0.5, baseScale * backendBoost * shaderQualityScale),
  );
}

export function buildMilkdropInputSignalOverrides(
  input: UnifiedInputState | null,
  target: Partial<MilkdropRuntimeSignals> = {},
): Partial<MilkdropRuntimeSignals> {
  const gesture = input?.gesture;
  const performance = input?.performance;
  const sourceFlags = performance?.sourceFlags;
  const actions = performance?.actions;
  const inputSpeed = Math.hypot(
    input?.dragDelta.x ?? 0,
    input?.dragDelta.y ?? 0,
  );

  return Object.assign(target, {
    inputX: input?.normalizedCentroid.x ?? 0,
    inputY: input?.normalizedCentroid.y ?? 0,
    input_x: input?.normalizedCentroid.x ?? 0,
    input_y: input?.normalizedCentroid.y ?? 0,
    inputDx: input?.dragDelta.x ?? 0,
    inputDy: input?.dragDelta.y ?? 0,
    input_dx: input?.dragDelta.x ?? 0,
    input_dy: input?.dragDelta.y ?? 0,
    inputSpeed: inputSpeed,
    input_speed: inputSpeed,
    inputPressed: input?.isPressed ? 1 : 0,
    input_pressed: input?.isPressed ? 1 : 0,
    inputJustPressed: input?.justPressed ? 1 : 0,
    input_just_pressed: input?.justPressed ? 1 : 0,
    inputJustReleased: input?.justReleased ? 1 : 0,
    input_just_released: input?.justReleased ? 1 : 0,
    inputCount: input?.pointerCount ?? 0,
    input_count: input?.pointerCount ?? 0,
    gestureScale: gesture?.scale ?? 1,
    gesture_scale: gesture?.scale ?? 1,
    gestureRotation: gesture?.rotation ?? 0,
    gesture_rotation: gesture?.rotation ?? 0,
    gestureTranslateX: gesture?.translation.x ?? 0,
    gestureTranslateY: gesture?.translation.y ?? 0,
    gesture_translate_x: gesture?.translation.x ?? 0,
    gesture_translate_y: gesture?.translation.y ?? 0,
    hoverActive: performance?.hoverActive ? 1 : 0,
    hover_active: performance?.hoverActive ? 1 : 0,
    hoverX: performance?.hover?.x ?? 0,
    hoverY: performance?.hover?.y ?? 0,
    hover_x: performance?.hover?.x ?? 0,
    hover_y: performance?.hover?.y ?? 0,
    wheelDelta: performance?.wheelDelta ?? 0,
    wheel_delta: performance?.wheelDelta ?? 0,
    wheelAccum: performance?.wheelAccum ?? 0,
    wheel_accum: performance?.wheelAccum ?? 0,
    dragIntensity: performance?.dragIntensity ?? 0,
    drag_intensity: performance?.dragIntensity ?? 0,
    dragAngle: performance?.dragAngle ?? 0,
    drag_angle: performance?.dragAngle ?? 0,
    accentPulse: performance?.accentPulse ?? 0,
    accent_pulse: performance?.accentPulse ?? 0,
    actionAccent: actions?.accent ?? 0,
    action_accent: actions?.accent ?? 0,
    actionModeNext: actions?.modeNext ?? 0,
    action_mode_next: actions?.modeNext ?? 0,
    actionModePrevious: actions?.modePrevious ?? 0,
    action_mode_previous: actions?.modePrevious ?? 0,
    actionPresetNext: actions?.presetNext ?? 0,
    action_preset_next: actions?.presetNext ?? 0,
    actionPresetPrevious: actions?.presetPrevious ?? 0,
    action_preset_previous: actions?.presetPrevious ?? 0,
    actionQuickLook1: actions?.quickLook1 ?? 0,
    action_quick_look_1: actions?.quickLook1 ?? 0,
    actionQuickLook2: actions?.quickLook2 ?? 0,
    action_quick_look_2: actions?.quickLook2 ?? 0,
    actionQuickLook3: actions?.quickLook3 ?? 0,
    action_quick_look_3: actions?.quickLook3 ?? 0,
    actionRemix: actions?.remix ?? 0,
    action_remix: actions?.remix ?? 0,
    inputSourcePointer: sourceFlags?.pointer ? 1 : 0,
    input_source_pointer: sourceFlags?.pointer ? 1 : 0,
    inputSourceKeyboard: sourceFlags?.keyboard ? 1 : 0,
    input_source_keyboard: sourceFlags?.keyboard ? 1 : 0,
    inputSourceGamepad: sourceFlags?.gamepad ? 1 : 0,
    input_source_gamepad: sourceFlags?.gamepad ? 1 : 0,
    inputSourceMouse: sourceFlags?.mouse ? 1 : 0,
    input_source_mouse: sourceFlags?.mouse ? 1 : 0,
    inputSourceTouch: sourceFlags?.touch ? 1 : 0,
    input_source_touch: sourceFlags?.touch ? 1 : 0,
    inputSourcePen: sourceFlags?.pen ? 1 : 0,
    input_source_pen: sourceFlags?.pen ? 1 : 0,
  });
}

function buildAgentMilkdropDebugSnapshot({
  activePresetId,
  compiledPreset,
  frameState,
  status,
  adaptiveQuality,
}: {
  activePresetId: string | null;
  compiledPreset: MilkdropCompiledPreset | null;
  frameState: MilkdropFrameState | null;
  status: string | null;
  adaptiveQuality?: AdaptiveQualityState | null;
}) {
  if (!frameState) {
    return {
      activePresetId,
      status,
      adaptiveQuality,
      frameState: null,
      title: compiledPreset?.title ?? null,
    };
  }

  return {
    activePresetId,
    status,
    adaptiveQuality,
    title: compiledPreset?.title ?? frameState.title,
    frameState: {
      presetId: frameState.presetId,
      title: frameState.title,
      signals: sanitizeRuntimeSignals(frameState.signals),
      variables: frameState.variables,
      mainWave: frameState.mainWave,
      shapes: frameState.shapes,
      post: frameState.post,
    },
  };
}

export function createMilkdropExperience({
  container,
  quality,
  qualityControl,
  initialPresetId,
}: {
  container?: HTMLElement | null;
  quality: QualityPresetManager;
  qualityControl: {
    presets: QualityPreset[];
    storageKey: string;
  };
  initialPresetId?: string;
}) {
  const catalogStore = createMilkdropCatalogStore();
  const defaultPreset = compileMilkdropPresetSource(DEFAULT_PRESET_SOURCE, {
    id: 'signal-bloom',
    title: 'Signal Bloom',
    origin: 'bundled',
    author: 'Stims',
  });
  const preferences = createMilkdropRuntimePreferences();
  const webgpuOptimizationFlags = resolveMilkdropWebGpuOptimizationFlags();
  const disabledWebGpuOptimizationFlags =
    getDisabledMilkdropWebGpuOptimizationFlags(webgpuOptimizationFlags);
  const vm = createMilkdropVM(defaultPreset, webgpuOptimizationFlags);
  const signalTracker = createMilkdropSignalTracker();
  const session = createMilkdropEditorSession({
    initialPreset: defaultPreset.source,
  });

  let runtime: ToyRuntimeInstance | null = null;
  let adapter: ReturnType<typeof createMilkdropRendererAdapter> | null = null;
  let activeCompiled: MilkdropCompiledPreset = defaultPreset;
  let activePresetId = defaultPreset.source.id;
  let activeBackend: 'webgl' | 'webgpu' = 'webgl';
  let currentFrameState: MilkdropFrameState | null = null;
  let blendState = cloneBlendState(currentFrameState);
  let blendEndAtMs = 0;
  let autoplay = preferences.getAutoplay();
  let blendDuration = preferences.getBlendDuration(
    activeCompiled.ir.numericFields.blend_duration,
  );
  let transitionMode = preferences.getTransitionMode();
  let lastPresetSwitchAt = performance.now();
  let fallbackTriggered = false;
  let lastStatusMessage: string | null = null;
  let disposeKeyboardShortcuts: (() => void) | null = null;
  let disposeRequestedPresetListener: (() => void) | null = null;
  let disposeRequestedOverlayTabListener: (() => void) | null = null;
  let lastInspectorOverlaySyncAt = 0;
  let adaptiveQualityController: AdaptiveQualityController | null = null;
  let adaptiveQualityState: AdaptiveQualityState | null = null;
  let adaptiveQualityUnsubscribe: (() => void) | null = null;
  const mergedSignals: Partial<MilkdropRuntimeSignals> = {};
  const lowQualityPostOverride = {
    shaderEnabled: false,
    videoEchoEnabled: false,
  };

  const updateAgentDebugSnapshot = () => {
    if (!isAgentMode()) {
      return;
    }
    setDebugSnapshot(
      'milkdrop',
      buildAgentMilkdropDebugSnapshot({
        activePresetId,
        compiledPreset: activeCompiled,
        frameState: currentFrameState,
        status: lastStatusMessage,
        adaptiveQuality: adaptiveQualityState,
      }),
    );
  };

  const setOverlayStatus = (message: string) => {
    lastStatusMessage = message;
    overlay.setStatus(message);
    updateAgentDebugSnapshot();
  };

  const setTransitionMode = (mode: 'blend' | 'cut') => {
    transitionMode = mode;
    overlay.setTransitionMode(mode);
    preferences.setTransitionMode(mode);
  };

  const applyCompiledPreset = (compiled: MilkdropCompiledPreset) => {
    activeCompiled = compiled;
    activePresetId = compiled.source.id;
    vm.setPreset(compiled);
    vm.setRenderBackend(activeBackend);
    adapter?.setPreset(compiled);
    overlay.setCurrentPresetTitle(compiled.title);
    overlay.setSessionState(session.getState());
    overlay.setInspectorState({
      compiled: activeCompiled,
      frameState: currentFrameState,
      backend: activeBackend,
    });
    updateAgentDebugSnapshot();
  };

  const catalogCoordinator = createMilkdropCatalogCoordinator({
    catalogStore,
    onCatalogChanged(entries, nextActivePresetId, nextActiveBackend) {
      overlay.setCatalog(entries, nextActivePresetId, nextActiveBackend);
    },
  });

  const shouldFallbackToWebgl = (compiled: MilkdropCompiledPreset) =>
    shouldFallbackMilkdropPresetToWebgl({
      backend: activeBackend,
      compatibilityMode: isCompatibilityModeEnabled(),
      descriptorPlan: compiled.ir.compatibility.gpuDescriptorPlans.webgpu,
      flags: webgpuOptimizationFlags,
    });

  const triggerWebglFallback = ({
    presetId,
    reason,
  }: {
    presetId: string;
    reason: string;
  }) => {
    if (fallbackTriggered || activeBackend !== 'webgpu') {
      return;
    }
    fallbackTriggered = true;
    preferences.recordFallback({ presetId, reason });
    setCompatibilityMode(true);
    window.location.reload();
  };

  const navigation = createMilkdropPresetNavigationController({
    catalogStore,
    catalogCoordinator,
    session,
    getActivePresetId: () => activePresetId,
    getActiveBackend: () => activeBackend,
    getCurrentFrameState: () => currentFrameState,
    getBlendDuration: () => blendDuration,
    getTransitionMode: () => transitionMode,
    applyCompiledPreset,
    setOverlayStatus,
    shouldFallbackToWebgl,
    triggerWebglFallback,
    rememberLastPreset: (id) => {
      preferences.rememberLastPreset(id);
    },
    preparePresetTransition(nextBlendState) {
      blendState = nextBlendState;
      blendEndAtMs =
        nextBlendState && blendDuration > 0
          ? performance.now() + blendDuration * 1000
          : 0;
    },
    markPresetSwitched() {
      lastPresetSwitchAt = performance.now();
    },
  });

  const presetFileActions = createMilkdropPresetFileActions({
    catalogStore,
    getActiveCatalogEntry: () =>
      catalogCoordinator.getActiveCatalogEntry(activePresetId),
    getActiveCompiled: () =>
      session.getState().activeCompiled ?? activeCompiled,
    scheduleCatalogSync: () =>
      catalogCoordinator.scheduleCatalogSync({
        activePresetId,
        activeBackend,
      }),
    selectPreset: navigation.selectPreset,
  });

  const interactionPresenter = createMilkdropRuntimeInteractionPresenter({
    overlay: {
      isOpen: () => overlay.isOpen(),
      toggleOpen: (open?: boolean) => overlay.toggleOpen(open),
    },
    overlayActions: {
      onSelectPreset: navigation.selectPreset,
      onSelectQualityPreset: (presetId) => {
        const preset = setQualityPresetById(presetId, {
          presets: qualityControl.presets,
          storageKey: qualityControl.storageKey,
        });
        if (!preset) {
          return;
        }
        quality.applyQualityPreset(preset);
      },
      onToggleFavorite: async (id, favorite) => {
        await catalogStore.setFavorite(id, favorite);
        await catalogCoordinator.syncCatalog({
          activePresetId,
          activeBackend,
        });
      },
      onSetRating: async (id, rating) => {
        await catalogStore.setRating(id, rating);
        await catalogCoordinator.syncCatalog({
          activePresetId,
          activeBackend,
        });
      },
      onToggleAutoplay: (enabled) => {
        autoplay = enabled;
        preferences.setAutoplay(enabled);
      },
      onTransitionModeChange: setTransitionMode,
      onGoBackPreset: navigation.goBackPreset,
      onNextPreset: () => navigation.selectAdjacentPreset(1),
      onPreviousPreset: () => navigation.selectAdjacentPreset(-1),
      onRandomize: navigation.selectRandomPreset,
      onBlendDurationChange: (value) => {
        blendDuration = value;
        preferences.setBlendDuration(value);
      },
      onImportFiles: presetFileActions.importFiles,
      onExport: presetFileActions.exportPreset,
      onDuplicatePreset: presetFileActions.duplicatePreset,
      onDeletePreset: presetFileActions.deleteActivePreset,
      onEditorSourceChange: (source) => session.applySource(source),
      onRevertToActive: () => session.resetToActive(),
      onInspectorFieldChange: (key, value) => session.updateField(key, value),
    },
    keybindingActions: {
      getActivePresetId: () => activePresetId,
      getActiveCatalogEntry: () =>
        catalogCoordinator.getActiveCatalogEntry(activePresetId),
      getTransitionMode: () => transitionMode,
      getBlendDuration: () => blendDuration,
      selectAdjacentPreset: (direction) => {
        void navigation.selectAdjacentPreset(direction);
      },
      selectRandomPreset: () => {
        void navigation.selectRandomPreset();
      },
      goBackPreset: () => {
        void navigation.goBackPreset();
      },
      setTransitionMode,
      setOverlayStatus,
      cycleWaveMode: (direction) => {
        void cycleWaveMode(direction);
      },
      nudgeNumericField: (args) => {
        void nudgeNumericField(args);
      },
      toggleFavorite: (id) => {
        const entry = catalogCoordinator.getActiveCatalogEntry(activePresetId);
        void catalogStore
          .setFavorite(id, !(entry?.isFavorite ?? false))
          .then(() =>
            catalogCoordinator.syncCatalog({
              activePresetId,
              activeBackend,
            }),
          );
      },
      setRating: (id, rating) => {
        void catalogStore.setRating(id, rating).then(() =>
          catalogCoordinator.syncCatalog({
            activePresetId,
            activeBackend,
          }),
        );
      },
    },
  });

  const overlay = new MilkdropOverlay({
    host: container ?? document.body,
    callbacks: interactionPresenter.overlayCallbacks,
  });

  overlay.setAutoplay(autoplay);
  overlay.setBlendDuration(blendDuration);
  overlay.setTransitionMode(transitionMode);
  overlay.setQualityPresets({
    presets: qualityControl.presets,
    activePresetId: quality.activeQuality.id,
    storageKey: qualityControl.storageKey,
  });
  overlay.setSessionState(session.getState());
  const fallbackNotice = preferences.consumeFallbackNotice();
  if (fallbackNotice) {
    setOverlayStatus(fallbackNotice);
  }

  const applyFieldValues = async (updates: Record<string, string | number>) => {
    const baseline =
      session.getState().latestCompiled?.formattedSource ??
      session.getState().source;
    return session.applySource(upsertMilkdropFields(baseline, updates));
  };

  const nudgeNumericField = async ({
    key,
    delta,
    min,
    max,
    label,
    digits = 3,
  }: {
    key: string;
    delta: number;
    min: number;
    max: number;
    label: string;
    digits?: number;
  }) => {
    const compiled = session.getState().activeCompiled ?? activeCompiled;
    const current = compiled.ir.numericFields[key] ?? 0;
    const next = Math.min(
      max,
      Math.max(min, Number.parseFloat((current + delta).toFixed(digits))),
    );
    await session.updateField(key, next);
    setOverlayStatus(`${label}: ${next.toFixed(Math.min(digits, 2))}`);
  };

  const cycleWaveMode = async (direction: 1 | -1) => {
    const compiled = session.getState().activeCompiled ?? activeCompiled;
    const current = Math.round(compiled.ir.numericFields.wave_mode ?? 0);
    const next = (((current + direction) % 8) + 8) % 8;
    await session.updateField('wave_mode', next);
    setOverlayStatus(`Wave mode: ${next}`);
  };

  session.subscribe((state) => {
    overlay.setSessionState(state);
    const nextCompiled = state.activeCompiled;
    if (!nextCompiled) {
      return;
    }
    if (shouldFallbackToWebgl(nextCompiled)) {
      triggerWebglFallback({
        presetId: nextCompiled.source.id,
        reason: `${nextCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
      });
      return;
    }
    const didPresetChange =
      nextCompiled.source.id !== activeCompiled.source.id ||
      nextCompiled.formattedSource !== activeCompiled.formattedSource;
    if (didPresetChange) {
      applyCompiledPreset(nextCompiled);
      void catalogStore.saveDraft(nextCompiled.source.id, state.source);
    }
    void catalogCoordinator.scheduleCatalogSync({
      activePresetId,
      activeBackend,
    });
  });

  disposeRequestedPresetListener = installRequestedPresetListener(
    (presetId) => {
      void navigation.selectPreset(presetId);
    },
  );
  disposeRequestedOverlayTabListener = installRequestedOverlayTabListener(
    (tab) => {
      overlay.openTab(tab);
    },
  );
  void catalogCoordinator
    .scheduleCatalogSync({
      activePresetId,
      activeBackend,
    })
    .then(async () => {
      const requestedOverlayTab = consumeRequestedMilkdropOverlayTab();
      if (requestedOverlayTab) {
        overlay.openTab(requestedOverlayTab);
      }
      const requestedPresetId = consumeRequestedMilkdropPresetSelection();
      const startupPresetId =
        requestedPresetId ?? preferences.getStartupPresetId(initialPresetId);
      if (startupPresetId) {
        await navigation.selectPreset(startupPresetId, {
          recordHistory: false,
        });
        if (activePresetId === startupPresetId) {
          return;
        }
      }
      const first = catalogCoordinator.getCatalogEntries()[0];
      if (first) {
        await navigation.selectPreset(first.id, { recordHistory: false });
      }
    });

  return {
    applyFields(updates: Record<string, string | number>) {
      return applyFieldValues(updates);
    },

    getActiveCompiledPreset() {
      return activeCompiled;
    },

    getActivePresetId() {
      return activePresetId;
    },

    selectPreset: navigation.selectPreset,

    setStatus(message: string) {
      setOverlayStatus(message);
    },

    attachRuntime(nextRuntime: ToyRuntimeInstance) {
      runtime = nextRuntime;
      if (!disposeKeyboardShortcuts) {
        disposeKeyboardShortcuts =
          interactionPresenter.installKeyboardShortcuts();
      }
      nextRuntime.toy.rendererReady.then((handle) => {
        activeBackend = handle?.backend === 'webgpu' ? 'webgpu' : 'webgl';
        vm.setRenderBackend(activeBackend);
        adapter = createMilkdropRendererAdapter({
          scene: nextRuntime.toy.scene,
          camera: nextRuntime.toy.camera,
          renderer: handle?.renderer,
          backend: activeBackend,
          preset: activeCompiled,
          webgpuOptimizationFlags,
        });
        adapter.attach();
        adaptiveQualityUnsubscribe?.();
        adaptiveQualityUnsubscribe = null;
        adaptiveQualityController = createAdaptiveQualityController({
          backend: activeBackend,
          capabilities:
            activeBackend === 'webgpu'
              ? (getCachedRendererCapabilities()?.webgpu ?? null)
              : null,
        });
        if (
          activeBackend === 'webgpu' &&
          disabledWebGpuOptimizationFlags.length > 0
        ) {
          setOverlayStatus(
            `WebGPU rollout flags active: ${disabledWebGpuOptimizationFlags.join(', ')}.`,
          );
        }
        adaptiveQualityUnsubscribe = adaptiveQualityController.subscribe(
          (state) => {
            adaptiveQualityState = state;
            if (activeBackend !== 'webgpu') {
              updateAgentDebugSnapshot();
              return;
            }
            nextRuntime.toy.updateRendererSettings({
              adaptiveRenderScaleMultiplier: state.renderScaleMultiplier,
              adaptiveMaxPixelRatioMultiplier: state.maxPixelRatioMultiplier,
              adaptiveDensityMultiplier: state.densityMultiplier,
            });
            adapter?.setAdaptiveQuality?.({
              feedbackResolutionMultiplier: state.feedbackResolutionMultiplier,
            });
            updateAgentDebugSnapshot();
          },
        );
        if (shouldFallbackToWebgl(activeCompiled)) {
          triggerWebglFallback({
            presetId: activeCompiled.source.id,
            reason: `${activeCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
          });
          return;
        }
        void catalogCoordinator.scheduleCatalogSync({
          activePresetId,
          activeBackend,
        });
      });
    },

    update(
      frame: ToyRuntimeFrame,
      options: {
        signalOverrides?: Partial<MilkdropRuntimeSignals>;
      } = {},
    ) {
      if (!runtime || !adapter) {
        return;
      }

      const now = performance.now();
      const frameStartAt = now;

      const detailScale = getMilkdropDetailScale({
        backend: activeBackend,
        particleScale: quality.activeQuality.particleScale,
        particleBudget: frame.performance.particleBudget,
        shaderQuality: frame.performance.shaderQuality,
      });
      const adaptiveDensityMultiplier =
        activeBackend === 'webgpu'
          ? (runtime.toy.rendererInfo?.adaptiveDensityMultiplier ?? 1)
          : 1;
      vm.setDetailScale(detailScale * adaptiveDensityMultiplier);
      const baseSignals = signalTracker.update({
        time: frame.time,
        deltaMs: frame.deltaMs,
        analyser: frame.analyser,
        frequencyData: frame.frequencyData,
        waveformData: frame.waveformData,
      });
      const inputOverrides = buildMilkdropInputSignalOverrides(
        frame.input,
        mergedSignals,
      );
      const signals = Object.assign(
        mergedSignals,
        baseSignals,
        inputOverrides,
        options.signalOverrides,
      );

      if (
        autoplay &&
        catalogCoordinator.getCatalogEntries().length > 1 &&
        now - lastPresetSwitchAt > Math.max(12000, blendDuration * 1000 + 6000)
      ) {
        void navigation.selectRandomPreset();
      }

      currentFrameState = applyMilkdropInteractionResponse(
        vm.step(signals),
        frame.input,
        activeBackend,
      );
      updateAgentDebugSnapshot();
      const canBlendCurrentFrame =
        estimateFrameBlendWorkload(currentFrameState) < 900;
      const activeBlendState =
        transitionMode === 'blend' &&
        frame.performance.shaderQuality !== 'low' &&
        canBlendCurrentFrame &&
        blendState &&
        now < blendEndAtMs
          ? {
              ...blendState,
              alpha:
                1 -
                (now - (blendEndAtMs - blendDuration * 1000)) /
                  (blendDuration * 1000),
            }
          : null;

      const renderFrameState =
        frame.performance.shaderQuality === 'low' &&
        (currentFrameState.post.shaderEnabled ||
          currentFrameState.post.videoEchoEnabled)
          ? {
              ...currentFrameState,
              post: Object.assign(
                lowQualityPostOverride,
                currentFrameState.post,
                {
                  shaderEnabled: false,
                  videoEchoEnabled: false,
                },
              ),
            }
          : currentFrameState;

      const renderStartAt = performance.now();
      const adapterPresentedFrame = adapter.render({
        frameState: renderFrameState,
        blendState: activeBlendState,
      });
      if (!adapterPresentedFrame) {
        runtime.toy.render();
      }
      const frameEndAt = performance.now();
      adaptiveQualityController?.recordFrame({
        frameMs: frameEndAt - frameStartAt,
        phases: {
          simulationMs: renderStartAt - frameStartAt,
          renderMs: frameEndAt - renderStartAt,
        },
      });
      if (
        overlay.shouldRenderInspectorMetrics() &&
        now - lastInspectorOverlaySyncAt >= 180
      ) {
        lastInspectorOverlaySyncAt = now;
        overlay.setInspectorState({
          compiled: activeCompiled,
          frameState: currentFrameState,
          backend: activeBackend,
        });
      }
    },

    dispose() {
      clearDebugSnapshot('milkdrop');
      overlay.dispose();
      session.dispose();
      adapter?.dispose();
      adapter = null;
      adaptiveQualityUnsubscribe?.();
      adaptiveQualityUnsubscribe = null;
      adaptiveQualityController = null;
      adaptiveQualityState = null;
      runtime = null;
      disposeKeyboardShortcuts?.();
      disposeKeyboardShortcuts = null;
      disposeRequestedPresetListener?.();
      disposeRequestedPresetListener = null;
      disposeRequestedOverlayTabListener?.();
      disposeRequestedOverlayTabListener = null;
      catalogCoordinator.dispose();
    },
  };
}

export const __milkdropRuntimeTestUtils = {
  cloneBlendState,
};
