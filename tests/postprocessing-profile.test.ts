import { describe, expect, test } from 'bun:test';
import type {
  MilkdropPostVisual,
  MilkdropRuntimeSignals,
  MilkdropShaderControls,
} from '../assets/js/milkdrop/types.ts';
import { deriveMilkdropPostprocessingProfile } from '../assets/js/milkdrop/vm/post-effects-builder.ts';

function createShaderControls(
  overrides: Partial<MilkdropShaderControls> = {},
): MilkdropShaderControls {
  return {
    warpScale: 0,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    zoom: 1,
    saturation: 1,
    contrast: 1,
    colorScale: { r: 1, g: 1, b: 1 },
    hueShift: 0,
    mixAlpha: 0,
    brightenBoost: 0,
    invertBoost: 0,
    solarizeBoost: 0,
    tint: { r: 1, g: 1, b: 1 },
    textureLayer: {
      source: 'none',
      mode: 'none',
      sampleDimension: '2d',
      inverted: false,
      amount: 0,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      volumeSliceZ: null,
    },
    warpTexture: {
      source: 'none',
      sampleDimension: '2d',
      amount: 0,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      volumeSliceZ: null,
    },
    ...overrides,
  };
}

function createSignals(
  overrides: Partial<MilkdropRuntimeSignals> = {},
): MilkdropRuntimeSignals {
  return {
    time: 0.5,
    deltaMs: 16.67,
    frame: 12,
    fps: 60,
    bass: 0.72,
    mid: 0.55,
    mids: 0.55,
    treb: 0.48,
    treble: 0.48,
    bassAtt: 0.64,
    midAtt: 0.4,
    midsAtt: 0.4,
    trebleAtt: 0.35,
    bass_att: 0.64,
    mid_att: 0.4,
    mids_att: 0.4,
    treb_att: 0.35,
    treble_att: 0.35,
    rms: 0.72,
    vol: 0.63,
    music: 0.58,
    beat: 1,
    beatPulse: 0.28,
    beat_pulse: 0.28,
    weightedEnergy: 0.82,
    inputX: 0,
    inputY: 0,
    input_x: 0,
    input_y: 0,
    inputDx: 0,
    inputDy: 0,
    input_dx: 0,
    input_dy: 0,
    inputSpeed: 0,
    input_speed: 0,
    inputPressed: 0,
    input_pressed: 0,
    inputJustPressed: 0,
    input_just_pressed: 0,
    inputJustReleased: 0,
    input_just_released: 0,
    inputCount: 0,
    input_count: 0,
    gestureScale: 1,
    gesture_scale: 1,
    gestureRotation: 0,
    gesture_rotation: 0,
    gestureTranslateX: 0,
    gestureTranslateY: 0,
    gesture_translate_x: 0,
    gesture_translate_y: 0,
    hoverActive: 0,
    hover_active: 0,
    hoverX: 0,
    hoverY: 0,
    hover_x: 0,
    hover_y: 0,
    wheelDelta: 0,
    wheel_delta: 0,
    wheelAccum: 0,
    wheel_accum: 0,
    dragIntensity: 0,
    drag_intensity: 0,
    dragAngle: 0,
    drag_angle: 0,
    accentPulse: 0,
    accent_pulse: 0,
    actionAccent: 0,
    action_accent: 0,
    actionModeNext: 0,
    action_mode_next: 0,
    actionModePrevious: 0,
    action_mode_previous: 0,
    actionPresetNext: 0,
    action_preset_next: 0,
    actionPresetPrevious: 0,
    action_preset_previous: 0,
    actionQuickLook1: 0,
    action_quick_look_1: 0,
    actionQuickLook2: 0,
    action_quick_look_2: 0,
    actionQuickLook3: 0,
    action_quick_look_3: 0,
    actionRemix: 0,
    action_remix: 0,
    inputSourcePointer: 0,
    input_source_pointer: 0,
    inputSourceKeyboard: 0,
    input_source_keyboard: 0,
    inputSourceGamepad: 0,
    input_source_gamepad: 0,
    inputSourceMouse: 0,
    input_source_mouse: 0,
    inputSourceTouch: 0,
    input_source_touch: 0,
    inputSourcePen: 0,
    input_source_pen: 0,
    motionX: 0,
    motionY: 0,
    motionZ: 0,
    motion_x: 0,
    motion_y: 0,
    motion_z: 0,
    motionEnabled: 0,
    motion_enabled: 0,
    motionStrength: 0,
    motion_strength: 0,
    frequencyData: new Uint8Array([160, 176, 192, 208]),
    waveformData: new Uint8Array([128, 128, 128, 128]),
    ...overrides,
  };
}

function createPost(
  overrides: Partial<MilkdropPostVisual> = {},
): MilkdropPostVisual {
  return {
    shaderEnabled: true,
    textureWrap: false,
    feedbackTexture: false,
    outerBorderStyle: false,
    innerBorderStyle: false,
    redBlueStereo: false,
    shaderControls: createShaderControls(),
    shaderPrograms: { warp: null, comp: null },
    brighten: false,
    darken: false,
    darkenCenter: false,
    solarize: false,
    invert: false,
    gammaAdj: 1,
    videoEchoEnabled: false,
    videoEchoAlpha: 0.18,
    videoEchoZoom: 1,
    videoEchoOrientation: 0,
    warp: 0.08,
    ...overrides,
  };
}

describe('milkdrop postprocessing profile derivation', () => {
  test('stays disabled for inert post state and low-energy input', () => {
    const profile = deriveMilkdropPostprocessingProfile({
      post: createPost({
        shaderEnabled: false,
        shaderControls: createShaderControls(),
      }),
      signals: createSignals({
        weightedEnergy: 0,
        rms: 0,
        beatPulse: 0,
        bassAtt: 0,
        midAtt: 0,
        trebleAtt: 0,
      }),
    });

    expect(profile.enabled).toBe(false);
    expect(profile.bloomStrength).toBe(0);
    expect(profile.filmNoise).toBe(0);
    expect(profile.filmScanlines).toBe(0);
    expect(profile.vignetteStrength).toBe(0);
    expect(profile.chromaOffset).toBe(0);
  });

  test('derives bloom plus film and chroma accents from active post state', () => {
    const profile = deriveMilkdropPostprocessingProfile({
      post: createPost({
        videoEchoEnabled: true,
        brighten: true,
        solarize: true,
        gammaAdj: 1.15,
        shaderControls: createShaderControls({
          hueShift: 0.42,
          mixAlpha: 0.28,
          brightenBoost: 0.22,
          invertBoost: 0.12,
          solarizeBoost: 0.18,
          saturation: 1.12,
          contrast: 1.08,
          offsetX: 0.06,
          offsetY: -0.03,
        }),
      }),
      signals: createSignals({
        weightedEnergy: 0.84,
        rms: 0.76,
        beatPulse: 0.34,
      }),
    });

    expect(profile.enabled).toBe(true);
    expect(profile.bloomStrength).toBeGreaterThan(0);
    expect(profile.filmNoise).toBeGreaterThan(0);
    expect(profile.filmScanlines).toBeGreaterThan(0);
    expect(profile.vignetteStrength).toBeGreaterThan(0);
    expect(profile.chromaOffset).toBeGreaterThan(0);
    expect(profile.filmScanlineCount).toBeGreaterThan(1024);
  });
});
