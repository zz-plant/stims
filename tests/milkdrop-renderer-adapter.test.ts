import { describe, expect, test } from 'bun:test';
import type { Vector2 } from 'three';
import {
  HalfFloatType,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import { createMilkdropRendererAdapterCore } from '../assets/js/milkdrop/renderer-adapter.ts';
import { createMilkdropRendererAdapter } from '../assets/js/milkdrop/renderer-adapter-factory.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropRuntimeSignals,
} from '../assets/js/milkdrop/types.ts';
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
  test('uses WebGPU-safe shape fills and thick outlines', () => {
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
    expect(fill?.material).toBeInstanceOf(MeshBasicMaterial);
    expect(fill?.material).not.toBeInstanceOf(ShaderMaterial);
  });

  test('reuses cached polygon geometries for same-sided shapes', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shared Shape Geometry
shapecode_0_enabled=1
shapecode_0_sides=6
shapecode_1_enabled=1
shapecode_1_sides=6
      `.trim(),
      { id: 'shared-shape-geometry' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    expect(frameState.shapes).toHaveLength(2);

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
      children: Array<{
        children?: Array<{ children?: Array<{ geometry?: unknown }> }>;
      }>;
    };
    const shapesGroup = root.children[5] as {
      children: Array<{ children: Array<{ geometry?: unknown }> }>;
    };

    const firstFillGeometry = shapesGroup.children[0]?.children[0]?.geometry;
    const secondFillGeometry = shapesGroup.children[1]?.children[0]?.geometry;
    const firstBorderGeometry = shapesGroup.children[0]?.children[1]?.geometry;
    const secondBorderGeometry = shapesGroup.children[1]?.children[1]?.geometry;

    expect(firstFillGeometry).toBeDefined();
    expect(firstFillGeometry).toBe(secondFillGeometry);
    expect(firstBorderGeometry).toBeDefined();
    expect(firstBorderGeometry).toBe(secondBorderGeometry);
  });

  test('reuses wave and border objects across renders', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Stable Objects
ob_size=0.03
      `.trim(),
      { id: 'stable-objects' },
    );

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgpu',
    });

    const firstFrame = createMilkdropVM(preset).step(makeSignals());
    const secondFrame = createMilkdropVM(preset).step(makeSignals());

    adapter.attach();
    adapter.render({
      frameState: firstFrame,
      blendState: null,
    });

    const root = scene.children[0] as {
      children: Array<{ children?: unknown[] }>;
    };
    const mainWaveGroup = root.children[2] as { children: unknown[] };
    const borderGroup = root.children[6] as { children: unknown[] };
    const firstWaveObject = mainWaveGroup.children[0];
    const firstBorderObject = borderGroup.children[0];

    adapter.render({
      frameState: secondFrame,
      blendState: null,
    });

    expect(mainWaveGroup.children[0]).toBe(firstWaveObject);
    expect(borderGroup.children[0]).toBe(firstBorderObject);
  });

  test('reuses shape groups and wave position attributes across renders', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Stable Shapes
shapecode_0_enabled=1
shapecode_0_sides=6
shapecode_0_thickoutline=1
      `.trim(),
      { id: 'stable-shapes' },
    );

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgpu',
    });

    const firstFrame = createMilkdropVM(preset).step(makeSignals());
    const secondFrame = createMilkdropVM(preset).step(makeSignals());

    adapter.attach();
    adapter.render({
      frameState: firstFrame,
      blendState: null,
    });

    const root = scene.children[0] as {
      children: Array<{ children?: unknown[] }>;
    };
    const mainWaveGroup = root.children[2] as {
      children: Array<{
        geometry?: { getAttribute: (name: string) => unknown };
      }>;
    };
    const shapesGroup = root.children[5] as {
      children: Array<{ children?: Array<{ geometry?: unknown }> }>;
    };
    const firstWaveAttribute =
      mainWaveGroup.children[0]?.geometry?.getAttribute('position');
    const firstShapeGroup = shapesGroup.children[0];

    adapter.render({
      frameState: secondFrame,
      blendState: null,
    });

    const secondWaveAttribute =
      mainWaveGroup.children[0]?.geometry?.getAttribute('position');
    expect(shapesGroup.children[0]).toBe(firstShapeGroup);
    expect(secondWaveAttribute).toBe(firstWaveAttribute);
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

  test('renders motion vector overlays as line objects', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Motion Vectors
motion_vectors=1
motion_vectors_x=5
motion_vectors_y=3
mv_a=0.25
per_pixel_1=zoom=1.08; rot=0.15; warp=0.3;
      `.trim(),
      { id: 'motion-vectors' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    expect(frameState.motionVectors.length).toBeGreaterThan(0);

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
      children: Array<{ children?: Array<{ type?: string }> }>;
    };
    const motionVectorGroup = root.children[7] as {
      children: Array<{ type?: string; children?: Array<{ type?: string }> }>;
    };

    expect(motionVectorGroup.children.length).toBeGreaterThan(0);
    expect(motionVectorGroup.children[0]?.type ?? 'Group').toBe('Group');
    expect(motionVectorGroup.children[0]?.children?.[0]?.type).toBe('Line');
  });

  test('renders mesh geometry directly on webgpu when per-pixel VM work is absent', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Procedural Mesh
mesh_density=14
zoom=1.12
rot=0.18
warp=0.22
warpanimspeed=1.4
      `.trim(),
      { id: 'procedural-mesh' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgpu');
    const frameState = vm.step(makeSignals());

    expect(frameState.mesh.positions.length).toBeGreaterThan(0);
    expect(frameState.gpuGeometry.meshField).toBeNull();

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
      children: Array<{ material?: unknown; geometry?: unknown }>;
    };
    const meshLines = root.children[1] as {
      material?: unknown;
      geometry?: unknown;
    };

    expect(meshLines.material).toBeInstanceOf(LineBasicMaterial);
    expect(meshLines.geometry).toBeDefined();
  });

  test('renders motion vectors directly on webgpu when per-pixel VM work is absent', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Procedural Motion Vectors
motion_vectors=1
motion_vectors_x=6
motion_vectors_y=4
mv_a=0.3
zoom=1.05
rot=0.12
warp=0.26
warpanimspeed=1.25
      `.trim(),
      { id: 'procedural-motion-vectors' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgpu');
    const frameState = vm.step(makeSignals());

    expect(frameState.motionVectors.length).toBeGreaterThan(0);
    expect(frameState.gpuGeometry.motionVectorField).toBeNull();

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
      children: Array<{
        children?: Array<{ type?: string; material?: unknown }>;
      }>;
    };
    const motionVectorGroup = root.children[7] as {
      children: Array<{
        type?: string;
        visible?: boolean;
        material?: unknown;
        children?: Array<{ type?: string }>;
      }>;
    };
    const cpuMotionVectors = motionVectorGroup.children[0];
    const proceduralMotionVectors = motionVectorGroup.children[1] as {
      visible?: boolean;
    };

    expect(cpuMotionVectors?.children?.[0]?.type).toBe('Line');
    expect(proceduralMotionVectors).toBeInstanceOf(LineSegments);
    expect(proceduralMotionVectors?.visible).toBe(false);
  });

  test('passes semantic feedback state to the feedback manager', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Feedback Contract
video_echo=1
      `.trim(),
      { id: 'feedback-contract' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const compositeStates: MilkdropFeedbackCompositeState[] = [];
    let renderCalls = 0;
    const feedback = {
      applyCompositeState(state: MilkdropFeedbackCompositeState) {
        compositeStates.push(state);
      },
      render() {
        renderCalls += 1;
        return true;
      },
      swap() {},
      resize() {},
      dispose() {},
    } as MilkdropFeedbackManager;

    const renderer = {
      getSize: (target: Vector2) => target.set(320, 180),
      render() {},
      setRenderTarget() {},
    };
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapterCore({
      scene,
      camera,
      renderer,
      backend: 'webgl',
      createFeedbackManager: () => feedback,
    });

    adapter.attach();
    expect(
      adapter.render({
        frameState,
        blendState: null,
      }),
    ).toBe(true);
    expect(renderCalls).toBe(1);
    expect(compositeStates[0]?.mixAlpha).toBeGreaterThan(0);
    expect(compositeStates[0]?.signalTime).toBeCloseTo(
      frameState.signals.time,
      6,
    );
  });

  test('forwards overlay and warp volume sampling metadata into feedback state', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Feedback Volume Metadata
video_echo=1
      `.trim(),
      { id: 'feedback-volume-metadata' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    frameState.post.shaderControls.textureLayer.source = 'simplex';
    frameState.post.shaderControls.textureLayer.mode = 'mix';
    frameState.post.shaderControls.textureLayer.sampleDimension = '3d';
    frameState.post.shaderControls.textureLayer.inverted = true;
    frameState.post.shaderControls.textureLayer.volumeSliceZ = 0.25;
    frameState.post.shaderControls.warpTexture.source = 'aura';
    frameState.post.shaderControls.warpTexture.sampleDimension = '3d';
    frameState.post.shaderControls.warpTexture.amount = 0.4;
    frameState.post.shaderControls.warpTexture.volumeSliceZ = 0.75;

    const compositeStates: MilkdropFeedbackCompositeState[] = [];
    const feedback = {
      applyCompositeState(state: MilkdropFeedbackCompositeState) {
        compositeStates.push(state);
      },
      render() {
        return true;
      },
      swap() {},
      resize() {},
      dispose() {},
    } as MilkdropFeedbackManager;

    const renderer = {
      getSize: (target: Vector2) => target.set(320, 180),
      render() {},
      setRenderTarget() {},
    };
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapterCore({
      scene,
      camera,
      renderer,
      backend: 'webgl',
      createFeedbackManager: () => feedback,
    });

    adapter.attach();
    expect(
      adapter.render({
        frameState,
        blendState: null,
      }),
    ).toBe(true);

    expect(compositeStates[0]).toMatchObject({
      overlayTextureSampleDimension: 1,
      overlayTextureInvert: 1,
      overlayTextureVolumeSliceZ: 0.25,
      warpTextureSampleDimension: 1,
      warpTextureVolumeSliceZ: 0.75,
    });
  });

  test('prefers translated shader controls when direct shader programs are unavailable', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Direct Shader Program Feedback
video_echo=1
warp_shader=shader_body=tex2d(sampler_main,uv).rgb;
comp_shader=ret = tex2d(sampler_main, uv).rgb + vec3(0.1, 0.0, 0.0);
      `.trim(),
      { id: 'direct-shader-program-feedback' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const compositeStates: MilkdropFeedbackCompositeState[] = [];
    const feedback = {
      applyCompositeState(state: MilkdropFeedbackCompositeState) {
        compositeStates.push(state);
      },
      render() {
        return true;
      },
      swap() {},
      resize() {},
      dispose() {},
    } as MilkdropFeedbackManager;
    const adapter = createMilkdropRendererAdapterCore({
      scene: new Scene(),
      camera: new OrthographicCamera(-1, 1, 1, -1, 0, 10),
      renderer: {
        getSize: (target: Vector2) => target.set(320, 180),
        render() {},
        setRenderTarget() {},
      },
      backend: 'webgpu',
      createFeedbackManager: () => feedback,
    });

    adapter.attach();
    expect(
      adapter.render({
        frameState,
        blendState: null,
      }),
    ).toBe(true);

    expect(compositeStates[0]?.shaderExecution).toBe('controls');
    expect(compositeStates[0]?.shaderPrograms.comp).toBeNull();
  });

  test('renders main wave and trails directly on webgpu line-wave presets', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Procedural Wave Renderer
wave_mode=5
wave_usedots=0
wave_scale=1.2
wave_mystery=0.35
wave_x=0.58
wave_y=0.42
mesh_density=16
      `.trim(),
      { id: 'procedural-wave-renderer' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgpu');
    const firstFrame = vm.step(makeSignals());
    const secondSignals = makeSignals();
    secondSignals.frame = 2;
    secondSignals.time = 0.3;
    const secondFrame = vm.step(secondSignals);

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgpu',
    });

    adapter.attach();
    adapter.render({
      frameState: firstFrame,
      blendState: null,
    });
    adapter.render({
      frameState: secondFrame,
      blendState: null,
    });

    const root = scene.children[0] as {
      children: Array<{ children?: Array<{ material?: unknown }> }>;
    };
    const mainWaveGroup = root.children[2] as {
      children: Array<{ material?: unknown }>;
    };
    const trailGroup = root.children[4] as {
      children: Array<{ material?: unknown }>;
    };

    expect(firstFrame.gpuGeometry.mainWave).toBeNull();
    expect(secondFrame.gpuGeometry.trailWaves).toHaveLength(0);
    expect(mainWaveGroup.children[0]?.material).toBeInstanceOf(
      LineBasicMaterial,
    );
    expect(trailGroup.children.length).toBeGreaterThan(0);
    expect(trailGroup.children[0]?.material).toBeInstanceOf(LineBasicMaterial);
  });

  test('renders custom waves directly on webgpu-safe custom waves', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Procedural Custom Wave Renderer
wavecode_0_enabled=1
wavecode_0_samples=40
wavecode_0_spectrum=1
wavecode_0_scaling=1.15
wavecode_0_mystery=0.25
wavecode_0_usedots=0
wavecode_0_x=0.55
wavecode_0_y=0.45
wavecode_0_r=0.8
wavecode_0_g=0.4
wavecode_0_b=1
wavecode_0_a=0.35
      `.trim(),
      { id: 'procedural-custom-wave-renderer' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgpu');
    const frameState = vm.step(makeSignals());

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
      children: Array<{ children?: Array<{ material?: unknown }> }>;
    };
    const customWaveGroup = root.children[3] as {
      children: Array<{ material?: unknown }>;
    };

    expect(frameState.gpuGeometry.customWaves).toHaveLength(0);
    expect(customWaveGroup.children[0]?.material).toBeInstanceOf(
      LineBasicMaterial,
    );
  });

  test('skips feedback composite rendering when shader mode is disabled', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Off
fShader=0
video_echo=1
      `.trim(),
      { id: 'shader-off' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const fakeRenderer = Object.create(
      WebGLRenderer.prototype,
    ) as WebGLRenderer & {
      setRenderTargetCalls: number;
    };
    fakeRenderer.setRenderTargetCalls = 0;
    fakeRenderer.getSize = (target: Vector2) => target.set(640, 360);
    fakeRenderer.setRenderTarget = () => {
      fakeRenderer.setRenderTargetCalls += 1;
      return fakeRenderer;
    };
    fakeRenderer.render = () => fakeRenderer;

    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      renderer: fakeRenderer,
      backend: 'webgl',
    });

    adapter.attach();
    const result = adapter.render({
      frameState,
      blendState: null,
    });

    expect(result).toBe(false);
    expect(fakeRenderer.setRenderTargetCalls).toBe(0);
  });

  test('renders the feedback composite path on webgpu backends', () => {
    const preset = compileMilkdropPresetSource(
      `
title=WebGPU Feedback
video_echo=1
warp_shader=warp=0.6; hue=0.2
comp_shader=mix=0.25; tint=1,0.5,0.5
texture_wrap=1
feedback_texture=1
ob_size=0.02
ob_border=1
      `.trim(),
      { id: 'webgpu-feedback' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const fakeRenderer = {
      setRenderTargetCalls: 0,
      renderCalls: 0,
      getSize: (target: Vector2) => target.set(640, 360),
      setRenderTarget: () => {
        fakeRenderer.setRenderTargetCalls += 1;
      },
      render: () => {
        fakeRenderer.renderCalls += 1;
      },
    };

    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      renderer: fakeRenderer,
      backend: 'webgpu',
    });

    adapter.attach();
    const result = adapter.render({
      frameState,
      blendState: null,
    });

    const feedback = (
      adapter as unknown as {
        feedback: {
          sceneTarget: {
            width: number;
            height: number;
            samples: number;
            texture: { type: number; minFilter: number; magFilter: number };
          };
        } | null;
      }
    ).feedback;

    expect(result).toBe(true);
    expect(fakeRenderer.setRenderTargetCalls).toBe(3);
    expect(fakeRenderer.renderCalls).toBe(3);
    expect(feedback).not.toBeNull();
  });

  test('allocates a feedback manager on webgpu when shader mode is enabled', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Gamma Feedback WebGPU
fGammaAdj=1.85
video_echo=1
      `.trim(),
      { id: 'gamma-feedback-webgpu' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const fakeRenderer = {
      getSize: (target: Vector2) => target.set(640, 360),
      setRenderTarget: () => {},
      render: () => {},
    };

    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      renderer: fakeRenderer,
      backend: 'webgpu',
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const feedback = (
      adapter as unknown as {
        feedback: {
          sceneTarget: {
            width: number;
            height: number;
            samples: number;
            texture: { type: number; minFilter: number; magFilter: number };
          };
        } | null;
      }
    ).feedback;

    expect(feedback).not.toBeNull();
  });

  test('routes webgpu audio-only presets through the feedback composite path', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Signal Field WebGPU
video_echo=1
      `.trim(),
      { id: 'signal-field-webgpu' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const fakeRenderer = {
      setRenderTargetCalls: 0,
      renderCalls: 0,
      getSize: (target: Vector2) => target.set(640, 360),
      setRenderTarget: () => {
        fakeRenderer.setRenderTargetCalls += 1;
      },
      render: () => {
        fakeRenderer.renderCalls += 1;
      },
    };

    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      renderer: fakeRenderer,
      backend: 'webgpu',
    });

    adapter.attach();
    const result = adapter.render({
      frameState,
      blendState: null,
    });

    const feedback = (
      adapter as unknown as {
        feedback: {
          sceneTarget: {
            width: number;
            height: number;
            samples: number;
            texture: {
              type: number;
              minFilter: number;
              magFilter: number;
            };
          };
        } | null;
      }
    ).feedback;

    expect(result).toBe(true);
    expect(fakeRenderer.setRenderTargetCalls).toBe(3);
    expect(fakeRenderer.renderCalls).toBe(3);
    expect(feedback).not.toBeNull();
  });

  test('uses full-resolution half-float feedback targets on webgpu backends', () => {
    const preset = compileMilkdropPresetSource(
      `
title=WebGPU Feedback Quality
video_echo=1
      `.trim(),
      { id: 'webgpu-feedback-quality' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const fakeRenderer = {
      getSize: (target: Vector2) => target.set(640, 360),
      setRenderTarget: () => {},
      render: () => {},
    };

    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      renderer: fakeRenderer,
      backend: 'webgpu',
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const feedback = (
      adapter as unknown as {
        feedback: {
          sceneTarget: {
            width: number;
            height: number;
            samples: number;
            texture: {
              type: number;
              minFilter: number;
              magFilter: number;
            };
          };
        } | null;
      }
    ).feedback;

    expect(feedback).not.toBeNull();
    expect(feedback?.sceneTarget.width).toBe(544);
    expect(feedback?.sceneTarget.height).toBe(306);
    expect(feedback?.sceneTarget.samples).toBe(0);
    expect(feedback?.sceneTarget.texture.type).toBe(HalfFloatType);
    expect(feedback?.sceneTarget.texture.minFilter).toBe(LinearFilter);
    expect(feedback?.sceneTarget.texture.magFilter).toBe(LinearFilter);
  });

  test('uses tuned feedback targets on webgl backends', () => {
    const preset = compileMilkdropPresetSource(
      `
title=WebGL Feedback Quality
video_echo=1
      `.trim(),
      { id: 'webgl-feedback-quality' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const fakeRenderer = {
      getSize: (target: Vector2) => target.set(640, 360),
      setRenderTarget: () => {},
      render: () => {},
    };

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
          sceneTarget: {
            width: number;
            height: number;
            samples: number;
            texture: { type: number; minFilter: number; magFilter: number };
          };
        } | null;
      }
    ).feedback;

    expect(feedback).not.toBeNull();
    expect(feedback?.sceneTarget.width).toBe(461);
    expect(feedback?.sceneTarget.height).toBe(259);
    expect(feedback?.sceneTarget.samples).toBe(0);
    expect(feedback?.sceneTarget.texture.type).not.toBe(HalfFloatType);
    expect(feedback?.sceneTarget.texture.minFilter).toBe(LinearFilter);
    expect(feedback?.sceneTarget.texture.magFilter).toBe(LinearFilter);
  });

  test('forwards shader transform controls into composite uniforms', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Transform Render
warp_shader=dx=0.05; dy=-0.02; rot=0.18; zoom=1.12
      `.trim(),
      { id: 'shader-transform-render' },
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
        feedback: { compositeMaterial: ShaderMaterial } | null;
      }
    ).feedback;

    expect(feedback?.compositeMaterial.uniforms.offsetX.value).toBeCloseTo(
      0.05,
      6,
    );
    expect(feedback?.compositeMaterial.uniforms.offsetY.value).toBeCloseTo(
      -0.02,
      6,
    );
    expect(feedback?.compositeMaterial.uniforms.rotation.value).toBeCloseTo(
      0.18,
      6,
    );
    expect(feedback?.compositeMaterial.uniforms.zoomMul.value).toBeCloseTo(
      1.12,
      6,
    );
  });

  test('forwards shader color controls into composite uniforms', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Color Render
comp_shader=saturation=1.4; contrast=1.2; r=1.1; g=0.85; b=0.65
      `.trim(),
      { id: 'shader-color-render' },
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
        feedback: { compositeMaterial: ShaderMaterial } | null;
      }
    ).feedback;

    expect(feedback?.compositeMaterial.uniforms.saturation.value).toBeCloseTo(
      1.4,
      6,
    );
    expect(feedback?.compositeMaterial.uniforms.contrast.value).toBeCloseTo(
      1.2,
      6,
    );
    expect(feedback?.compositeMaterial.uniforms.colorScale.value.r).toBeCloseTo(
      1.1,
      6,
    );
    expect(feedback?.compositeMaterial.uniforms.colorScale.value.g).toBeCloseTo(
      0.85,
      6,
    );
    expect(feedback?.compositeMaterial.uniforms.colorScale.value.b).toBeCloseTo(
      0.65,
      6,
    );
  });

  test('forwards texture sampler controls into composite uniforms', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Texture Uniforms
comp_shader=ret = tex2d(sampler_pattern, uv * 1.4 + vec2(0.2, -0.15)).rgb
warp_shader=warp_texture_source = sampler_noise; warp_texture_amount = 0.08; warp_texture_scale = vec2(2.2, 1.7); warp_texture_offset = vec2(0.05, 0.1)
      `.trim(),
      { id: 'shader-texture-uniforms' },
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
        feedback: { compositeMaterial: ShaderMaterial } | null;
      }
    ).feedback;

    expect(
      feedback?.compositeMaterial.uniforms.overlayTextureSource.value,
    ).toBe(6);
    expect(feedback?.compositeMaterial.uniforms.overlayTextureMode.value).toBe(
      1,
    );
    expect(
      feedback?.compositeMaterial.uniforms.overlayTextureAmount.value,
    ).toBeCloseTo(1, 6);
    expect(
      feedback?.compositeMaterial.uniforms.overlayTextureScale.value.x,
    ).toBeCloseTo(1.4, 6);
    expect(
      feedback?.compositeMaterial.uniforms.overlayTextureScale.value.y,
    ).toBeCloseTo(1.4, 6);
    expect(
      feedback?.compositeMaterial.uniforms.overlayTextureOffset.value.x,
    ).toBeCloseTo(0.2, 6);
    expect(
      feedback?.compositeMaterial.uniforms.overlayTextureOffset.value.y,
    ).toBeCloseTo(-0.15, 6);
    expect(feedback?.compositeMaterial.uniforms.warpTextureSource.value).toBe(
      1,
    );
    expect(
      feedback?.compositeMaterial.uniforms.warpTextureAmount.value,
    ).toBeCloseTo(0.08, 6);
    expect(
      feedback?.compositeMaterial.uniforms.warpTextureScale.value.x,
    ).toBeCloseTo(2.2, 6);
    expect(
      feedback?.compositeMaterial.uniforms.warpTextureScale.value.y,
    ).toBeCloseTo(1.7, 6);
  });
});
