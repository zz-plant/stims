import { describe, expect, test } from 'bun:test';
import type { Vector2 } from 'three';
import {
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import { createMilkdropRendererAdapter } from '../assets/js/milkdrop/renderer-adapter.ts';
import type { MilkdropRuntimeSignals } from '../assets/js/milkdrop/types.ts';
import { createMilkdropVM } from '../assets/js/milkdrop/vm.ts';

function makeSignals(): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  frequencyData.fill(160);

  return {
    time: 1 / 60,
    deltaMs: 16.67,
    frame: 1,
    fps: 60,
    bass: 0.7,
    mid: 0.5,
    mids: 0.5,
    treb: 0.4,
    treble: 0.4,
    bassAtt: 0.6,
    bass_att: 0.6,
    mid_att: 0.45,
    midsAtt: 0.45,
    mids_att: 0.45,
    treb_att: 0.35,
    trebleAtt: 0.35,
    treble_att: 0.35,
    rms: 0.5,
    vol: 0.5,
    music: 0.58,
    beat: 1,
    beatPulse: 0.2,
    beat_pulse: 0.2,
    weightedEnergy: 0.58,
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
    frequencyData,
  };
}

describe('milkdrop renderer adapter', () => {
  test('renders polygon shape fills with secondary-color shader and thick outlines', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shape Fidelity
shapecode_0_enabled=1
shapecode_0_sides=6
shapecode_0_rad=0.22
shapecode_0_a=0.7
shapecode_0_r=1
shapecode_0_g=0.2
shapecode_0_b=0.1
shapecode_0_a2=0.3
shapecode_0_r2=0.1
shapecode_0_g2=0.2
shapecode_0_b2=1
shapecode_0_border_a=0.9
shapecode_0_thickoutline=1
      `.trim(),
      { id: 'shape-fidelity' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    expect(frameState.shapes).toHaveLength(1);
    expect(frameState.shapes[0]?.secondaryColor).not.toBeNull();
    expect(frameState.shapes[0]?.thickOutline).toBe(true);

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgpu',
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const root = scene.children[0] as {
      children: Array<{ children?: unknown[] }>;
    };
    const shapesGroup = root.children[5] as {
      children: Array<{ children: unknown[] }>;
    };
    const renderedShapeGroup = shapesGroup.children[0] as {
      children: Array<{ geometry?: { type?: string }; material?: unknown }>;
    };

    expect(renderedShapeGroup.children).toHaveLength(3);

    const fill = renderedShapeGroup.children.find(
      (child) => child.geometry?.type === 'ShapeGeometry',
    );
    expect(fill).toBeDefined();
    expect(fill?.material).toBeInstanceOf(ShaderMaterial);
    expect(
      (fill?.material as ShaderMaterial).uniforms.secondaryColor?.value,
    ).toBeDefined();
  });

  test('forwards gamma-adjusted post state into feedback uniforms', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Gamma Feedback
fGammaAdj=1.85
video_echo=1
      `.trim(),
      { id: 'gamma-feedback' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const fakeRenderer = Object.create(
      WebGLRenderer.prototype,
    ) as WebGLRenderer;
    fakeRenderer.getSize = (target: Vector2) => target.set(640, 360);
    fakeRenderer.setRenderTarget = () => fakeRenderer;
    fakeRenderer.render = () => fakeRenderer;

    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      renderer: fakeRenderer,
      backend: 'webgl',
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const feedback = (
      adapter as unknown as {
        feedback: {
          compositeMaterial: ShaderMaterial;
        } | null;
      }
    ).feedback;

    expect(feedback).not.toBeNull();
    expect(feedback?.compositeMaterial.uniforms.gammaAdj.value).toBeCloseTo(
      1.85,
      6,
    );
  });
});
