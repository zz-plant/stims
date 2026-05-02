import { describe, expect, test } from 'bun:test';
import {
  describeMilkdropScenePickResult,
  getMilkdropSceneDragFieldUpdates,
  getMilkdropScenePickResult,
  type MilkdropScenePickResult,
  resolveMilkdropScenePointerPoint,
} from '../assets/js/milkdrop/runtime/scene-selection.ts';
import type { MilkdropFrameState } from '../assets/js/milkdrop/types.ts';

function makeFrameState(
  overrides: Partial<MilkdropFrameState> = {},
): MilkdropFrameState {
  const base = {
    presetId: 'test',
    title: 'Test',
    background: { r: 0, g: 0, b: 0, a: 1 },
    waveform: {
      positions: [],
      color: { r: 1, g: 1, b: 1, a: 1 },
      alpha: 1,
      thickness: 1,
      drawMode: 'line',
      additive: false,
      pointSize: 1,
    },
    mainWave: {
      positions: [0, 0, 0, 0.9, 0, 0, 0.9, 0.5, 0],
      color: { r: 1, g: 1, b: 1, a: 1 },
      alpha: 1,
      thickness: 0.18,
      drawMode: 'line',
      additive: false,
      pointSize: 1,
    },
    customWaves: [
      {
        positions: [-0.75, -0.2, 0, -0.1, -0.1, 0, 0.7, -0.15, 0],
        color: { r: 1, g: 0.7, b: 0.8, a: 1 },
        alpha: 1,
        thickness: 0.14,
        drawMode: 'line',
        additive: false,
        pointSize: 1,
      },
    ],
    trails: [],
    mesh: {
      positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
      color: { r: 0.8, g: 0.9, b: 1, a: 0.3 },
      alpha: 0.3,
    },
    shapes: [
      {
        key: 'shape_1',
        x: 0.2,
        y: 0.15,
        radius: 0.2,
        sides: 6,
        rotation: 0,
        textured: false,
        textureZoom: 1,
        textureAngle: 0,
        color: { r: 1, g: 0.5, b: 0.8, a: 0.25 },
        secondaryColor: null,
        borderColor: { r: 1, g: 0.9, b: 1, a: 0.8 },
        additive: false,
        thickOutline: true,
      },
    ],
    borders: [
      {
        key: 'outer',
        size: 0.08,
        color: { r: 1, g: 1, b: 1, a: 1 },
        alpha: 1,
        styled: true,
      },
      {
        key: 'inner',
        size: 0.05,
        color: { r: 1, g: 1, b: 1, a: 1 },
        alpha: 1,
        styled: false,
      },
    ],
    motionVectors: [],
    post: {
      shaderEnabled: false,
      textureWrap: false,
      feedbackTexture: false,
      outerBorderStyle: false,
      innerBorderStyle: false,
      shaderControls: {
        r: 1,
        g: 1,
        b: 1,
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
      },
      shaderPrograms: { warp: null, comp: null },
      brighten: false,
      darken: false,
      darkenCenter: false,
      solarize: false,
      invert: false,
      gammaAdj: 1,
      videoEchoEnabled: false,
      videoEchoAlpha: 0,
      videoEchoZoom: 1,
      videoEchoOrientation: 0,
      warp: 0,
    },
    signals: {
      time: 1,
      deltaMs: 16,
      frame: 12,
      fps: 60,
      bass: 0.6,
      mid: 0.5,
      mids: 0.5,
      treb: 0.4,
      treble: 0.4,
      bassAtt: 0.6,
      midAtt: 0.5,
      midsAtt: 0.5,
      trebleAtt: 0.4,
      bass_att: 0.6,
      mid_att: 0.5,
      mids_att: 0.5,
      treb_att: 0.4,
      treble_att: 0.4,
      rms: 0.5,
      vol: 0.5,
      music: 0.5,
      beat: 0,
      beatPulse: 0,
      beat_pulse: 0,
      transient: 0,
      spectralFlux: 0,
      weightedEnergy: 0.5,
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
      frequencyData: new Uint8Array(64),
      waveformData: new Uint8Array(64),
    },
    variables: {},
    compatibility: {
      backends: {
        webgl: { status: 'supported', reasons: [] },
        webgpu: { status: 'supported', reasons: [] },
      },
      gpuDescriptorPlans: {
        webgpu: {
          routing: 'generic-frame-payload',
          proceduralWaves: [],
          proceduralMesh: null,
          proceduralMotionVectors: null,
          feedback: null,
          unsupported: [],
        },
      },
      parity: {
        fidelityClass: 'exact',
        visualEvidenceTier: 'runtime',
        evidence: { compile: 1, runtime: 1, visual: 1 },
        backendDivergence: [],
        visualFallbacks: [],
        visualCertification: null,
        semanticSupport: null,
        degradationReasons: [],
      },
      featureAnalysis: {
        featuresUsed: [],
        registerUsage: { q: 0, t: 0 },
      },
      warnings: [],
      blockingReasons: [],
      supportedFeatures: [],
      unsupportedKeys: [],
      softUnknownKeys: [],
      hardUnsupportedKeys: [],
      webgl: true,
      webgpu: true,
    },
    gpuGeometry: {
      mainWave: null,
      trailWaves: [],
      customWaves: [],
      meshField: null,
      motionVectorField: null,
    },
    interaction: null,
  } as unknown as MilkdropFrameState;

  return {
    ...base,
    ...overrides,
  };
}

describe('milkdrop scene selection helpers', () => {
  test('picks the closest visible shape and exposes edit fields', () => {
    const frameState = makeFrameState();
    const point = resolveMilkdropScenePointerPoint({
      clientX: 600,
      clientY: 420,
      viewportWidth: 1000,
      viewportHeight: 1000,
    });
    const selection = getMilkdropScenePickResult({ frameState, point });

    expect(selection?.kind).toBe('shape');
    expect(selection?.slotIndex).toBe(1);
    expect(selection?.sourceFields).toContain('shape_1_x');
    expect(describeMilkdropScenePickResult(selection).title).toBe('Shape 1');
  });

  test('picks waves, borders, and mesh targets from screen-space points', () => {
    const frameState = makeFrameState();

    const customWaveSelection = getMilkdropScenePickResult({
      frameState,
      point: { worldX: -0.1, worldY: -0.1 },
    });
    expect(customWaveSelection?.kind).toBe('custom-wave');
    expect(customWaveSelection?.sourceFields).toContain(
      'custom_wave_1_samples',
    );

    const mainWaveSelection = getMilkdropScenePickResult({
      frameState: makeFrameState({
        shapes: [],
        customWaves: [],
        borders: [],
      }),
      point: { worldX: 0.88, worldY: 0.02 },
    });
    expect(mainWaveSelection?.kind).toBe('main-wave');

    const borderSelection = getMilkdropScenePickResult({
      frameState: makeFrameState({
        shapes: [],
        customWaves: [],
        mainWave: {
          positions: [],
          color: { r: 1, g: 1, b: 1, a: 1 },
          alpha: 1,
          thickness: 0.1,
          drawMode: 'line',
          additive: false,
          pointSize: 1,
        },
      }),
      point: { worldX: 0.98, worldY: 0.02 },
    });
    expect(borderSelection?.kind).toBe('border');

    const meshSelection = getMilkdropScenePickResult({
      frameState: makeFrameState({
        shapes: [],
        customWaves: [],
        mainWave: {
          positions: [],
          color: { r: 1, g: 1, b: 1, a: 1 },
          alpha: 1,
          thickness: 0.1,
          drawMode: 'line',
          additive: false,
          pointSize: 1,
        },
        borders: [],
      }),
      point: { worldX: 0, worldY: 0 },
    });
    expect(meshSelection?.kind).toBe('mesh');
  });

  test('builds shape drag updates from pointer motion and modifiers', () => {
    const selection: MilkdropScenePickResult = {
      kind: 'shape',
      slotIndex: 1,
      worldX: 0.2,
      worldY: 0.15,
      sourceFields: ['shape_1_x', 'shape_1_y', 'shape_1_rad', 'shape_1_ang'],
    };
    const baseFields = {
      shape_1_x: 0.2,
      shape_1_y: 0.15,
      shape_1_rad: 0.2,
      shape_1_ang: 0.1,
    };
    const compiled = {
      ir: {
        numericFields: baseFields,
        customShapes: [],
        customWaves: [],
        mainWave: {},
      },
    } as never;

    const moveUpdates = getMilkdropSceneDragFieldUpdates({
      compiled,
      selection,
      startPoint: { worldX: 0.2, worldY: 0.15 },
      currentPoint: { worldX: 0.45, worldY: -0.1 },
      baseFields,
    });
    expect(moveUpdates).toEqual({
      shape_1_x: 0.325,
      shape_1_y: 0.025,
    });

    const radiusUpdates = getMilkdropSceneDragFieldUpdates({
      compiled,
      selection,
      startPoint: { worldX: 0.2, worldY: 0.15 },
      currentPoint: { worldX: 0.2, worldY: -0.1 },
      modifiers: { shiftKey: true },
      baseFields,
    });
    expect(radiusUpdates).toHaveProperty('shape_1_rad');

    const angleUpdates = getMilkdropSceneDragFieldUpdates({
      compiled,
      selection,
      startPoint: { worldX: 0.2, worldY: 0.15 },
      currentPoint: { worldX: 0.6, worldY: 0.15 },
      modifiers: { altKey: true },
      baseFields,
    });
    expect(angleUpdates).toHaveProperty('shape_1_ang');
  });
});
