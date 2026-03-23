import type { ShaderQuality } from '../../core/performance-panel';
import type { UnifiedInputState } from '../../utils/unified-input.ts';
import type {
  MilkdropFrameState,
  MilkdropGpuGeometryHints,
  MilkdropGpuInteractionPayload,
  MilkdropPostVisual,
  MilkdropRuntimeSignals,
} from '../types.ts';

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
