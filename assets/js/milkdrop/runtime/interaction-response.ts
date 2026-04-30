import type { ShaderQuality } from '../../core/performance-panel';
import type { UnifiedInputState } from '../../core/unified-input.ts';
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

function transformScenePositionsInPlace(
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
    return;
  }

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const scaledX = x * scale;
    const scaledY = y * scale;
    positions[index] = scaledX * cos - scaledY * sin + offsetX;
    positions[index + 1] = scaledX * sin + scaledY * cos + offsetY;
  }
}

function nudgeCenter(value: number, offset: number) {
  return clamp(value + offset * 0.5, 0, 1);
}

function enhancePostEffectsInPlace(
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
): void {
  post.warp = clamp(
    post.warp + dragBoost * 0.28 + Math.abs(pinchDelta) * 0.12,
    0,
    1,
  );
  post.videoEchoZoom = clamp(
    post.videoEchoZoom + pinchDelta * 0.12,
    0.85,
    1.35,
  );
  post.shaderControls.offsetX = clamp(
    post.shaderControls.offsetX + offsetX * 0.5,
    -0.3,
    0.3,
  );
  post.shaderControls.offsetY = clamp(
    post.shaderControls.offsetY + offsetY * 0.5,
    -0.3,
    0.3,
  );
  post.shaderControls.rotation = clamp(
    post.shaderControls.rotation + rotation * 0.85,
    -1.6,
    1.6,
  );
  post.shaderControls.zoom = clamp(
    post.shaderControls.zoom + pinchDelta * 0.3,
    0.72,
    1.45,
  );
  post.shaderControls.warpScale = clamp(
    post.shaderControls.warpScale + pinchDelta * 0.24 + dragBoost * 0.16,
    0,
    2,
  );
}

function enhanceGpuGeometryInPlace(
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
): void {
  if (gpuGeometry.mainWave) {
    gpuGeometry.mainWave.centerX = nudgeCenter(
      gpuGeometry.mainWave.centerX,
      offsetX,
    );
    gpuGeometry.mainWave.centerY = nudgeCenter(
      gpuGeometry.mainWave.centerY,
      -offsetY,
    );
    gpuGeometry.mainWave.scale = clamp(
      gpuGeometry.mainWave.scale * scale,
      0.45,
      2.4,
    );
  }
  for (let wi = 0; wi < gpuGeometry.trailWaves.length; wi += 1) {
    const wave = gpuGeometry.trailWaves[wi];
    if (!wave) continue;
    wave.centerX = nudgeCenter(wave.centerX, offsetX);
    wave.centerY = nudgeCenter(wave.centerY, -offsetY);
    wave.scale = clamp(wave.scale * scale, 0.45, 2.4);
  }
  for (let ci = 0; ci < gpuGeometry.customWaves.length; ci += 1) {
    const wave = gpuGeometry.customWaves[ci];
    if (!wave) continue;
    wave.centerX = nudgeCenter(wave.centerX, offsetX);
    wave.centerY = nudgeCenter(wave.centerY, -offsetY);
    wave.scaling = clamp(wave.scaling * scale, 0.45, 2.4);
  }
  if (gpuGeometry.meshField) {
    gpuGeometry.meshField.rotation =
      gpuGeometry.meshField.rotation + rotation * 0.9;
    gpuGeometry.meshField.zoom = clamp(
      gpuGeometry.meshField.zoom - pinchDelta * 0.2,
      0.5,
      2.6,
    );
    gpuGeometry.meshField.warp = clamp(
      gpuGeometry.meshField.warp + Math.abs(pinchDelta) * 0.1,
      0,
      1.4,
    );
  }
  if (gpuGeometry.motionVectorField) {
    gpuGeometry.motionVectorField.rotation =
      gpuGeometry.motionVectorField.rotation + rotation * 0.9;
    gpuGeometry.motionVectorField.zoom = clamp(
      gpuGeometry.motionVectorField.zoom - pinchDelta * 0.2,
      0.5,
      2.6,
    );
    gpuGeometry.motionVectorField.warp = clamp(
      gpuGeometry.motionVectorField.warp + Math.abs(pinchDelta) * 0.1,
      0,
      1.4,
    );
  }
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

  frameState.interaction = interaction;

  if (usesGpuInteractionPayload) {
    frameState.mainWave.thickness = clamp(
      frameState.mainWave.thickness + dragBoost * 0.8,
      1,
      12,
    );
    frameState.mesh.alpha = clamp(
      frameState.mesh.alpha + Math.abs(pinchDelta) * 0.12,
      0,
      1,
    );
    for (let si = 0; si < frameState.shapes.length; si += 1) {
      const shape = frameState.shapes[si];
      if (!shape) continue;
      shape.x = nudgeCenter(shape.x, offsetX);
      shape.y = nudgeCenter(shape.y, -offsetY);
      shape.radius = clamp(shape.radius * scale, 0.02, 0.6);
      shape.rotation = shape.rotation + rotation;
    }
    enhancePostEffectsInPlace(frameState.post, {
      offsetX,
      offsetY,
      rotation,
      pinchDelta,
      dragBoost,
    });
    enhanceGpuGeometryInPlace(frameState.gpuGeometry, {
      offsetX,
      offsetY,
      rotation,
      scale,
      pinchDelta,
    });
    return frameState;
  }

  frameState.mainWave.thickness = clamp(
    frameState.mainWave.thickness + dragBoost * 0.8,
    1,
    12,
  );
  transformScenePositionsInPlace(frameState.mainWave.positions, {
    offsetX,
    offsetY,
    rotation,
    scale,
  });
  for (let wi = 0; wi < frameState.customWaves.length; wi += 1) {
    const wave = frameState.customWaves[wi];
    if (!wave) continue;
    transformScenePositionsInPlace(wave.positions, {
      offsetX,
      offsetY,
      rotation,
      scale,
    });
  }
  for (let ti = 0; ti < frameState.trails.length; ti += 1) {
    const trail = frameState.trails[ti];
    if (!trail) continue;
    transformScenePositionsInPlace(trail.positions, {
      offsetX,
      offsetY,
      rotation,
      scale,
    });
  }
  transformScenePositionsInPlace(frameState.mesh.positions, {
    offsetX,
    offsetY,
    rotation,
    scale,
  });
  frameState.mesh.alpha = clamp(
    frameState.mesh.alpha + Math.abs(pinchDelta) * 0.12,
    0,
    1,
  );
  for (let si = 0; si < frameState.shapes.length; si += 1) {
    const shape = frameState.shapes[si];
    if (!shape) continue;
    shape.x = nudgeCenter(shape.x, offsetX);
    shape.y = nudgeCenter(shape.y, -offsetY);
    shape.radius = clamp(shape.radius * scale, 0.02, 0.6);
    shape.rotation = shape.rotation + rotation;
  }
  for (let vi = 0; vi < frameState.motionVectors.length; vi += 1) {
    const vec = frameState.motionVectors[vi];
    if (!vec) continue;
    transformScenePositionsInPlace(vec.positions, {
      offsetX,
      offsetY,
      rotation,
      scale,
    });
  }
  enhancePostEffectsInPlace(frameState.post, {
    offsetX,
    offsetY,
    rotation,
    pinchDelta,
    dragBoost,
  });
  enhanceGpuGeometryInPlace(frameState.gpuGeometry, {
    offsetX,
    offsetY,
    rotation,
    scale,
    pinchDelta,
  });
  return frameState;
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
  type NumericSignalKey = {
    [Key in keyof MilkdropRuntimeSignals]: MilkdropRuntimeSignals[Key] extends number
      ? Key
      : never;
  }[keyof MilkdropRuntimeSignals];
  type NumericSignalName = Exclude<NumericSignalKey, undefined>;

  const gesture = input?.gesture;
  const performance = input?.performance;
  const sourceFlags = performance?.sourceFlags;
  const actions = performance?.actions;
  const normalizedCentroid = input?.normalizedCentroid;
  const dragDelta = input?.dragDelta;
  const hover = performance?.hover;
  const numericTarget = target as Partial<Record<NumericSignalName, number>>;
  const inputSpeed = Math.hypot(dragDelta?.x ?? 0, dragDelta?.y ?? 0);
  const assignAliasedValue = (
    camelKey: NumericSignalName,
    snakeKey: NumericSignalName,
    value: number,
  ) => {
    numericTarget[camelKey] = value;
    numericTarget[snakeKey] = value;
  };

  assignAliasedValue('inputX', 'input_x', normalizedCentroid?.x ?? 0);
  assignAliasedValue('inputY', 'input_y', normalizedCentroid?.y ?? 0);
  assignAliasedValue('inputDx', 'input_dx', dragDelta?.x ?? 0);
  assignAliasedValue('inputDy', 'input_dy', dragDelta?.y ?? 0);
  assignAliasedValue('inputSpeed', 'input_speed', inputSpeed);
  assignAliasedValue('inputPressed', 'input_pressed', input?.isPressed ? 1 : 0);
  assignAliasedValue(
    'inputJustPressed',
    'input_just_pressed',
    input?.justPressed ? 1 : 0,
  );
  assignAliasedValue(
    'inputJustReleased',
    'input_just_released',
    input?.justReleased ? 1 : 0,
  );
  assignAliasedValue('inputCount', 'input_count', input?.pointerCount ?? 0);
  assignAliasedValue('gestureScale', 'gesture_scale', gesture?.scale ?? 1);
  assignAliasedValue(
    'gestureRotation',
    'gesture_rotation',
    gesture?.rotation ?? 0,
  );
  assignAliasedValue(
    'gestureTranslateX',
    'gesture_translate_x',
    gesture?.translation.x ?? 0,
  );
  assignAliasedValue(
    'gestureTranslateY',
    'gesture_translate_y',
    gesture?.translation.y ?? 0,
  );
  assignAliasedValue(
    'hoverActive',
    'hover_active',
    performance?.hoverActive ? 1 : 0,
  );
  assignAliasedValue('hoverX', 'hover_x', hover?.x ?? 0);
  assignAliasedValue('hoverY', 'hover_y', hover?.y ?? 0);
  assignAliasedValue('wheelDelta', 'wheel_delta', performance?.wheelDelta ?? 0);
  assignAliasedValue('wheelAccum', 'wheel_accum', performance?.wheelAccum ?? 0);
  assignAliasedValue(
    'dragIntensity',
    'drag_intensity',
    performance?.dragIntensity ?? 0,
  );
  assignAliasedValue('dragAngle', 'drag_angle', performance?.dragAngle ?? 0);
  assignAliasedValue(
    'accentPulse',
    'accent_pulse',
    performance?.accentPulse ?? 0,
  );
  assignAliasedValue('actionAccent', 'action_accent', actions?.accent ?? 0);
  assignAliasedValue(
    'actionModeNext',
    'action_mode_next',
    actions?.modeNext ?? 0,
  );
  assignAliasedValue(
    'actionModePrevious',
    'action_mode_previous',
    actions?.modePrevious ?? 0,
  );
  assignAliasedValue(
    'actionPresetNext',
    'action_preset_next',
    actions?.presetNext ?? 0,
  );
  assignAliasedValue(
    'actionPresetPrevious',
    'action_preset_previous',
    actions?.presetPrevious ?? 0,
  );
  assignAliasedValue(
    'actionQuickLook1',
    'action_quick_look_1',
    actions?.quickLook1 ?? 0,
  );
  assignAliasedValue(
    'actionQuickLook2',
    'action_quick_look_2',
    actions?.quickLook2 ?? 0,
  );
  assignAliasedValue(
    'actionQuickLook3',
    'action_quick_look_3',
    actions?.quickLook3 ?? 0,
  );
  assignAliasedValue('actionRemix', 'action_remix', actions?.remix ?? 0);
  assignAliasedValue(
    'inputSourcePointer',
    'input_source_pointer',
    sourceFlags?.pointer ? 1 : 0,
  );
  assignAliasedValue(
    'inputSourceKeyboard',
    'input_source_keyboard',
    sourceFlags?.keyboard ? 1 : 0,
  );
  assignAliasedValue(
    'inputSourceGamepad',
    'input_source_gamepad',
    sourceFlags?.gamepad ? 1 : 0,
  );
  assignAliasedValue(
    'inputSourceMouse',
    'input_source_mouse',
    sourceFlags?.mouse ? 1 : 0,
  );
  assignAliasedValue(
    'inputSourceTouch',
    'input_source_touch',
    sourceFlags?.touch ? 1 : 0,
  );
  assignAliasedValue(
    'inputSourcePen',
    'input_source_pen',
    sourceFlags?.pen ? 1 : 0,
  );

  return target;
}
