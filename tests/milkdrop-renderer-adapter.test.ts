import { describe, expect, test } from 'bun:test';
import type { Vector2 } from 'three';
import {
  AdditiveBlending,
  HalfFloatType,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  type Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Texture,
  WebGLRenderer,
} from 'three';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import {
  __milkdropRendererAdapterTestUtils,
  createMilkdropRendererAdapterCore,
} from '../assets/js/milkdrop/renderer-adapter.ts';
import { createMilkdropRendererAdapter } from '../assets/js/milkdrop/renderer-adapter-factory.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropRuntimeSignals,
} from '../assets/js/milkdrop/types.ts';
import { createMilkdropVM } from '../assets/js/milkdrop/vm.ts';
import { DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS } from '../assets/js/milkdrop/webgpu-optimization-flags.ts';

type RenderTreeNode = {
  children?: RenderTreeNode[];
  geometry?: {
    getAttribute?: (name: string) => unknown;
  };
  material?: unknown;
  type?: string;
  instanceCount?: number;
};

function flattenRenderTree(node: RenderTreeNode): RenderTreeNode[] {
  const children = Array.isArray(node.children) ? node.children : [];
  return [node, ...children.flatMap((child) => flattenRenderTree(child))];
}

function getGeometryInstanceCount(node: RenderTreeNode | undefined) {
  return (
    node?.geometry as
      | {
          instanceCount?: number;
        }
      | undefined
  )?.instanceCount;
}

function isWebGPUSegmentBatchNode(node: RenderTreeNode) {
  return node.geometry?.getAttribute?.('instanceLine') !== undefined;
}

function getFloat32AttributeArray(
  node: RenderTreeNode | undefined,
  name: string,
): Float32Array | null {
  const attribute = node?.geometry?.getAttribute?.(name) as
    | {
        array?: ArrayLike<number>;
      }
    | undefined;
  if (!attribute?.array) {
    return null;
  }
  return Float32Array.from(attribute.array);
}

function makeSignals(
  overrides: Partial<MilkdropRuntimeSignals> = {},
): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  frequencyData.fill(160);
  const waveformData = new Uint8Array(64);
  for (let index = 0; index < waveformData.length; index += 1) {
    const ratio = index / Math.max(1, waveformData.length - 1);
    waveformData[index] = Math.round(
      128 + Math.sin(ratio * Math.PI * 4 + Math.PI / 6) * 56,
    );
  }

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
    waveformData,
    ...overrides,
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
      preset,
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const root = scene.children[0] as RenderTreeNode;
    const batchedShapes = flattenRenderTree(root).filter(
      (child) =>
        child.geometry?.getAttribute?.('instanceTransform') !== undefined,
    );
    const fillMesh = batchedShapes.find(
      (child) =>
        child.geometry?.getAttribute?.('instancePrimaryColorAlpha') !==
        undefined,
    );
    const fillControl = fillMesh?.geometry?.getAttribute?.(
      'instanceFillControl',
    ) as { array: Float32Array } | undefined;
    const fillPrimary = fillMesh?.geometry?.getAttribute?.(
      'instancePrimaryColorAlpha',
    ) as { array: Float32Array } | undefined;
    const fillSecondary = fillMesh?.geometry?.getAttribute?.(
      'instanceSecondaryColorAlpha',
    ) as { array: Float32Array } | undefined;

    expect(batchedShapes).toHaveLength(3);
    batchedShapes.forEach((mesh) => {
      expect(mesh.material).toBeInstanceOf(ShaderMaterial);
      expect(getGeometryInstanceCount(mesh) ?? 0).toBeGreaterThan(0);
    });
    expect(fillMesh).toBeDefined();
    expect(fillControl?.array[0]).toBe(1);
    expect(fillPrimary?.array).toEqual(new Float32Array([1, 0.2, 0.1, 0.7]));
    expect(fillSecondary?.array).toEqual(new Float32Array([0.1, 0.2, 1, 0.3]));
  });

  test('falls back to non-batched shape rendering for textured custom shapes on WebGPU', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Textured Shape Fallback
shapecode_0_enabled=1
shapecode_0_textured=1
shapecode_0_tex_zoom=0.8
shapecode_0_tex_ang=0.35
      `.trim(),
      { id: 'textured-shape-fallback' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgpu',
      preset,
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const root = scene.children[0] as {
      children?: RenderTreeNode[];
    };
    const shapesGroup = root.children?.[5] as RenderTreeNode | undefined;
    const batchedShapes = flattenRenderTree(shapesGroup ?? {}).filter(
      (child) =>
        child.geometry?.getAttribute?.('instanceTransform') !== undefined,
    );
    const meshFills = flattenRenderTree(shapesGroup ?? {}).filter(
      (child) =>
        child.type === 'Mesh' && child.material instanceof MeshBasicMaterial,
    );

    expect(batchedShapes).toHaveLength(0);
    expect(meshFills.length).toBeGreaterThan(0);
  });

  test('batches textured custom shapes on WebGPU when a shape texture is available', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Textured Shape Batched
shapecode_0_enabled=1
shapecode_0_textured=1
shapecode_0_tex_zoom=0.8
shapecode_0_tex_ang=0.35
      `.trim(),
      { id: 'textured-shape-batched' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const feedbackTexture = new Texture();
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgpu',
      preset,
    }) as unknown as {
      attach: () => void;
      render: (payload: {
        frameState: typeof frameState;
        blendState: null;
      }) => void;
      feedback: { getShapeTexture: () => Texture | null } | null;
    };

    adapter.attach();
    adapter.feedback = {
      getShapeTexture() {
        return feedbackTexture;
      },
    };
    adapter.render({
      frameState,
      blendState: null,
    });

    const root = scene.children[0] as RenderTreeNode;
    const shapeChildren =
      (root.children?.[5] as RenderTreeNode | undefined) ?? {};
    const batchedFill = flattenRenderTree(root).find(
      (child) =>
        child.geometry?.getAttribute?.('instanceTransform') !== undefined &&
        child.geometry?.getAttribute?.('instanceFillControl') !== undefined,
    ) as
      | {
          material?: ShaderMaterial & {
            uniforms?: { shapeTexture?: { value: Texture | null } };
          };
        }
      | undefined;
    const meshFills = flattenRenderTree(shapeChildren).filter(
      (child) =>
        child.type === 'Mesh' && child.material instanceof MeshBasicMaterial,
    );

    expect(batchedFill?.material).toBeInstanceOf(ShaderMaterial);
    expect(batchedFill?.material?.uniforms?.shapeTexture?.value).toBe(
      feedbackTexture,
    );
    expect(
      getFloat32AttributeArray(batchedFill, 'instanceFillControl'),
    ).toEqual(Float32Array.from([0, 1, 0.8, 0.35]));
    expect(meshFills).toHaveLength(0);
  });

  test('samples the previous feedback frame when textured shapes have a shape texture available', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Textured Shape Shader
shapecode_0_enabled=1
shapecode_0_textured=1
shapecode_0_tex_zoom=0.75
shapecode_0_tex_ang=0.2
      `.trim(),
      { id: 'textured-shape-shader' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const feedbackTexture = new Texture();
    const feedback = {
      applyCompositeState() {},
      getShapeTexture() {
        return feedbackTexture;
      },
      render() {
        return true;
      },
      swap() {},
      resize() {},
      dispose() {},
    } as MilkdropFeedbackManager;

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapterCore({
      scene,
      camera,
      renderer: {
        getSize: (target: Vector2) => target.set(320, 180),
        render() {},
        setRenderTarget() {},
      },
      backend: 'webgl',
      preset,
      createFeedbackManager: () => feedback,
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const root = scene.children[0] as {
      children?: Array<{ children?: unknown[] }>;
    };
    const shapesGroup = root.children?.[5] as
      | { children?: unknown[] }
      | undefined;
    const shapeGroup = shapesGroup?.children?.[0] as
      | { children?: unknown[] }
      | undefined;
    const fill = shapeGroup?.children?.[0] as Mesh | undefined;
    const material = fill?.material as ShaderMaterial | undefined;

    expect(material).toBeInstanceOf(ShaderMaterial);
    expect(material?.uniforms.shapeTexture.value).toBe(feedbackTexture);
    expect(material?.uniforms.textured.value).toBe(1);
    expect(material?.uniforms.textureZoom.value).toBeCloseTo(0.75, 6);
    expect(material?.uniforms.textureAngle.value).toBeCloseTo(0.2, 6);
    expect(material?.fragmentShader).toContain('fract(sampleUv)');
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
      preset,
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const root = scene.children[0] as RenderTreeNode;
    const batchedShapes = flattenRenderTree(root).filter(
      (child) =>
        child.geometry?.getAttribute?.('instanceTransform') !== undefined,
    );
    const fillMeshes = batchedShapes.filter(
      (child) =>
        child.geometry?.getAttribute?.('instanceTransform') !== undefined &&
        child.geometry?.getAttribute?.('instanceScales') === undefined,
    );
    const outlineMeshes = batchedShapes.filter(
      (child) =>
        child.geometry?.getAttribute?.('instanceTransform') !== undefined &&
        child.geometry?.getAttribute?.('instanceScales') !== undefined,
    );
    const populatedFillMeshes = fillMeshes.filter(
      (mesh) => (getGeometryInstanceCount(mesh) ?? 0) > 0,
    );
    const populatedOutlineMeshes = outlineMeshes.filter(
      (mesh) => (getGeometryInstanceCount(mesh) ?? 0) > 0,
    );

    expect(populatedFillMeshes.length).toBeGreaterThan(0);
    expect(populatedOutlineMeshes.length).toBeGreaterThan(0);
  });

  test('keeps WebGPU shape outline thickness stable across different radii', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Stable Outline Thickness
shapecode_0_enabled=1
shapecode_0_sides=6
shapecode_0_rad=0.2
shapecode_0_border_a=1
shapecode_0_thickoutline=1
shapecode_1_enabled=1
shapecode_1_sides=6
shapecode_1_rad=0.4
shapecode_1_border_a=1
shapecode_1_thickoutline=1
      `.trim(),
      { id: 'stable-outline-thickness' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgpu',
      preset,
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const root = scene.children[0] as RenderTreeNode;
    const ringMeshes = flattenRenderTree(root).filter(
      (child) => child.geometry?.getAttribute?.('instanceScales') !== undefined,
    );
    const outlineScales = ringMeshes
      .map((mesh) => getFloat32AttributeArray(mesh, 'instanceScales'))
      .filter(
        (scales): scales is Float32Array =>
          scales !== null && (scales[0] ?? 0) <= 1.001,
      )
      .map((scales) => Array.from(scales).map((value) => Number(value)))
      .sort((left, right) => (left[1] ?? 0) - (right[1] ?? 0));
    const accentScales = ringMeshes
      .map((mesh) => getFloat32AttributeArray(mesh, 'instanceScales'))
      .filter(
        (scales): scales is Float32Array =>
          scales !== null && (scales[0] ?? 0) > 1.001,
      )
      .map((scales) => Array.from(scales).map((value) => Number(value)))
      .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));

    expect(frameState.shapes).toHaveLength(2);
    expect(outlineScales).toHaveLength(2);
    expect(accentScales).toHaveLength(2);
    expect(outlineScales).toEqual([
      [1, 0.9656862616539001],
      [1, 0.9828431606292725],
    ]);
    expect(accentScales).toEqual([
      [1.0220588445663452, 1.0049020051956177],
      [1.0441176891326904, 1.0098038911819458],
    ]);
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

    const root = scene.children[0] as RenderTreeNode;
    const firstWaveObject = flattenRenderTree(root).find(
      isWebGPUSegmentBatchNode,
    );
    const firstBorderObject = flattenRenderTree(root).find(
      (child) => child.geometry?.getAttribute?.('instanceInsets') !== undefined,
    );

    adapter.render({
      frameState: secondFrame,
      blendState: null,
    });

    const secondWaveObject = flattenRenderTree(root).find(
      isWebGPUSegmentBatchNode,
    );
    const secondBorderObject = flattenRenderTree(root).find(
      (child) => child.geometry?.getAttribute?.('instanceInsets') !== undefined,
    );

    expect(secondWaveObject).toBe(firstWaveObject);
    expect(secondBorderObject).toBe(firstBorderObject);
  });

  test('keeps styled border accent opacity attenuated on initial WebGL render', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Styled Border Accent
ob_size=0.03
ob_a=0.8
ob_r=1
ob_g=0.9
ob_b=0.7
ob_border=1
      `.trim(),
      { id: 'styled-border-accent' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgl',
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const root = scene.children[0] as {
      children: Array<{
        children?: Array<{
          children?: Array<{
            material?: LineBasicMaterial | MeshBasicMaterial;
          }>;
        }>;
      }>;
    };
    const borderGroup = root.children[6];
    const outerBorder = borderGroup?.children?.[0];
    const outline = outerBorder?.children?.[1] as
      | { material?: LineBasicMaterial }
      | undefined;
    const accent = outerBorder?.children?.[2] as
      | { material?: LineBasicMaterial }
      | undefined;

    expect(outline?.material).toBeInstanceOf(LineBasicMaterial);
    expect(accent?.material).toBeInstanceOf(LineBasicMaterial);
    expect(outline?.material?.opacity).toBeCloseTo(0.8, 6);
    expect(accent?.material?.opacity).toBeCloseTo(0.44, 6);
    expect(accent?.material?.opacity ?? 0).toBeLessThan(
      outline?.material?.opacity ?? 0,
    );
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

    const root = scene.children[0] as RenderTreeNode;
    const firstWaveMesh = flattenRenderTree(root).find(
      isWebGPUSegmentBatchNode,
    );
    const firstWaveAttribute =
      firstWaveMesh?.geometry?.getAttribute?.('instanceLine');
    const firstShapeMesh = flattenRenderTree(root).find(
      (child) =>
        child.geometry?.getAttribute?.('instanceTransform') !== undefined,
    );

    adapter.render({
      frameState: secondFrame,
      blendState: null,
    });

    const secondWaveMesh = flattenRenderTree(root).find(
      isWebGPUSegmentBatchNode,
    );
    const secondWaveAttribute =
      secondWaveMesh?.geometry?.getAttribute?.('instanceLine');
    const secondShapeMesh = flattenRenderTree(root).find(
      (child) =>
        child.geometry?.getAttribute?.('instanceTransform') !== undefined,
    );

    expect(secondShapeMesh).toBe(firstShapeMesh);
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

    const root = scene.children[0] as RenderTreeNode;
    const matchingMotionVectorMesh = flattenRenderTree(root).find(
      (child) =>
        isWebGPUSegmentBatchNode(child) &&
        getGeometryInstanceCount(child) === frameState.motionVectors.length,
    );

    expect(matchingMotionVectorMesh).toBeDefined();
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

    expect(frameState.mesh.positions).toHaveLength(0);
    expect(frameState.gpuGeometry.meshField).not.toBeNull();

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

    expect(meshLines.material).toBeInstanceOf(ShaderMaterial);
    expect(meshLines.geometry).toBeDefined();
  });

  test('renders lowered per-pixel mesh programs directly on webgpu', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Procedural Mesh Per Pixel
mesh_density=10
per_pixel_1=q1=sin(time+x*2.5);
per_pixel_2=x=x+q1*0.04;
per_pixel_3=zoom=zoom+abs(y)*0.08;
      `.trim(),
      { id: 'procedural-mesh-per-pixel' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgpu');
    const frameState = vm.step(makeSignals({ time: 0.75 }));

    expect(frameState.mesh.positions).toHaveLength(0);
    expect(frameState.gpuGeometry.meshField?.program).not.toBeNull();

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
      children: Array<{ material?: unknown }>;
    };
    const meshLines = root.children[1] as {
      material?: ShaderMaterial;
    };

    expect(meshLines.material).toBeInstanceOf(ShaderMaterial);
    expect(meshLines.material?.userData.fieldProgramSignature).toBe(
      frameState.gpuGeometry.meshField?.program?.signature,
    );
  });

  test('normalizes lowered field shader centers after per-pixel programs run', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Procedural Mesh Center
mesh_density=10
per_pixel_1=cx=x;
per_pixel_2=cy=y;
per_pixel_3=sx=2;
      `.trim(),
      { id: 'procedural-mesh-center' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgpu');
    const frameState = vm.step(makeSignals({ time: 0.75 }));

    expect(frameState.gpuGeometry.meshField?.centerX).toBeCloseTo(0, 6);
    expect(frameState.gpuGeometry.meshField?.centerY).toBeCloseTo(0, 6);

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
      children: Array<{ material?: unknown }>;
    };
    const meshLines = root.children[1] as {
      material?: ShaderMaterial;
    };

    expect(meshLines.material).toBeInstanceOf(ShaderMaterial);
    expect(meshLines.material?.vertexShader).toContain(
      'float fieldCenterX = milkdropDenormalizeTransformCenterX(paramCenterX);',
    );
    expect(meshLines.material?.vertexShader).toContain(
      'float fieldCenterY = milkdropDenormalizeTransformCenterY(paramCenterY);',
    );
    expect(meshLines.material?.vertexShader).toContain(
      'float normalizedCenterX = milkdropNormalizeTransformCenterX(fieldCenterX);',
    );
    expect(meshLines.material?.vertexShader).toContain(
      'float normalizedCenterY = milkdropNormalizeTransformCenterY(fieldCenterY);',
    );
    expect(meshLines.material?.vertexShader).toContain(
      'return value >= 0.0 && value <= 1.0 ? (value - 0.5) * 2.0 : value;',
    );
    expect(meshLines.material?.vertexShader).toContain(
      'return value >= 0.0 && value <= 1.0 ? (0.5 - value) * 2.0 : value;',
    );
    expect(meshLines.material?.vertexShader).toContain(
      '(field_x - normalizedCenterX) * fieldScaleX',
    );
    expect(meshLines.material?.vertexShader).toContain(
      '(field_y - normalizedCenterY) * fieldScaleY',
    );
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

    expect(frameState.motionVectors).toHaveLength(0);
    expect(frameState.gpuGeometry.motionVectorField).not.toBeNull();

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
    const motionVectorGroup = root.children?.[7] as {
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

    expect(cpuMotionVectors?.children).toHaveLength(0);
    expect(proceduralMotionVectors).toBeInstanceOf(LineSegments);
    expect(motionVectorGroup.children[1]?.material).toBeDefined();
  });

  test('falls back to CPU motion-vector overlays on webgpu for legacy controls', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Legacy Motion Vector Overlay
motion_vectors=1
motion_vectors_x=6
motion_vectors_y=4
mv_l=0.2
zoom=1.05
rot=0.12
warp=0.26
warpanimspeed=1.25
      `.trim(),
      { id: 'legacy-motion-vector-overlay' },
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

    const root = scene.children[0] as RenderTreeNode;
    const motionVectorGroup = root.children?.[7] as {
      children: Array<{
        type?: string;
        visible?: boolean;
      }>;
    };

    const matchingMotionVectorMesh = flattenRenderTree(root).find(
      (child) =>
        isWebGPUSegmentBatchNode(child) &&
        getGeometryInstanceCount(child) === frameState.motionVectors.length,
    );

    expect(matchingMotionVectorMesh).toBeDefined();
    expect(motionVectorGroup.children[1]?.visible).toBe(false);
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
    expect(compositeStates[0]?.mixAlpha).toBe(0);
    expect(compositeStates[0]?.videoEchoAlpha).toBeGreaterThan(0);
    expect(compositeStates[0]?.videoEchoOrientation).toBe(0);
    expect(compositeStates[0]?.signalTime).toBeCloseTo(
      frameState.signals.time,
      6,
    );
  });

  test.each([
    'webgl',
    'webgpu',
  ] as const)('routes video echo orientation through the feedback composite state on %s', (backend) => {
    const preset = compileMilkdropPresetSource(
      `
title=Feedback Orientation Routing
video_echo=1
video_echo_alpha=0.42
video_echo_zoom=1.11
warp_shader=warp=0.6
comp_shader=mix=0.25
video_echo_orientation=3
        `.trim(),
      { id: `feedback-orientation-routing-${backend}` },
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
      backend,
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
      mixAlpha: 0.25,
      videoEchoAlpha: 0.42,
      videoEchoOrientation: 3,
      zoom: frameState.post.videoEchoZoom,
      warpScale: frameState.post.shaderControls.warpScale,
    });
  });

  test('routes red-blue stereo flag through the feedback composite state', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Feedback Stereo Routing
bRedBlueStereo=1
      `.trim(),
      { id: 'feedback-red-blue-stereo-routing' },
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

    expect(compositeStates[0]?.redBlueStereo).toBe(1);
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

  test('keeps translated shader-only feedback state on controls when no direct program payload exists', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Direct Shader Program Feedback
video_echo=1
warp_shader=shader_body=tex2d(sampler_main,uv).rgb;
comp_shader=ret = tex2d(sampler_main, uv).rgb * 1.2;
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

  test('forwards direct shader programs into the webgpu feedback composite state', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Direct Shader Program Feedback
fShader=1
video_echo=1
comp_shader=mix = 0.35; ret = tex2d(sampler_main, uv).rgb + vec3(mix, 0.0, 0.0)
      `.trim(),
      { id: 'direct-shader-program-feedback' },
    );
    const frameState = createMilkdropVM(preset).step(makeSignals());
    const compositeStates: MilkdropFeedbackCompositeState[] = [];
    const feedback = {
      applyCompositeState(state: MilkdropFeedbackCompositeState) {
        compositeStates.push(state);
      },
      swap() {},
      resize() {},
      render() {
        return true;
      },
      getTexture() {
        return new Texture();
      },
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

    expect(compositeStates[0]?.shaderExecution).toBe('direct');
    expect(compositeStates[0]?.shaderPrograms.comp).toEqual(
      expect.objectContaining({
        source: 'ret = tex2d(sampler_main, uv).rgb + vec3(mix, 0.0, 0.0)',
        execution: expect.objectContaining({
          kind: 'direct-feedback-program',
          stage: 'comp',
          requiresControlFallback: true,
        }),
      }),
    );
  });

  test('forwards direct warp shader_body programs into the webgpu feedback composite state', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Direct Warp Shader Body Feedback
fShader=1
video_echo=1
warp_shader=shader_body=uv + vec2(time * 0.02, 0.0)
      `.trim(),
      { id: 'direct-warp-shader-body-feedback' },
    );
    const frameState = createMilkdropVM(preset).step(makeSignals());
    const compositeStates: MilkdropFeedbackCompositeState[] = [];
    const feedback = {
      applyCompositeState(state: MilkdropFeedbackCompositeState) {
        compositeStates.push(state);
      },
      swap() {},
      resize() {},
      render() {
        return true;
      },
      getTexture() {
        return new Texture();
      },
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

    expect(compositeStates[0]?.shaderExecution).toBe('direct');
    expect(compositeStates[0]?.shaderPrograms.warp).toEqual(
      expect.objectContaining({
        source: 'shader_body=uv + vec2(time * 0.02, 0.0)',
        execution: expect.objectContaining({
          kind: 'direct-feedback-program',
          stage: 'warp',
          entryTarget: 'uv',
          supportedBackends: ['webgpu'],
        }),
      }),
    );
  });

  test('renders waveform-driven main wave and trails on webgpu line-wave presets', () => {
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

    const webgpuCpuFallbackFlags = {
      ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
      proceduralMainWave: false,
      proceduralTrailWaves: false,
    };
    const vm = createMilkdropVM(preset, webgpuCpuFallbackFlags);
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
      webgpuOptimizationFlags: webgpuCpuFallbackFlags,
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

    const root = scene.children[0] as RenderTreeNode;
    const batchedSegmentMeshes = flattenRenderTree(root).filter(
      isWebGPUSegmentBatchNode,
    );

    expect(firstFrame.gpuGeometry.mainWave).toBeNull();
    expect(secondFrame.gpuGeometry.trailWaves).toHaveLength(0);
    const populatedSegmentMeshes = batchedSegmentMeshes.filter(
      (mesh) => (getGeometryInstanceCount(mesh) ?? 0) > 0,
    );

    expect(populatedSegmentMeshes.length).toBeGreaterThan(0);
    populatedSegmentMeshes.forEach((mesh) => {
      expect(mesh.material).toBeInstanceOf(ShaderMaterial);
      expect(getGeometryInstanceCount(mesh) ?? 0).toBeGreaterThan(0);
    });
  });

  test('closes manually closed batched main waves on webgpu', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Closed Batched Wave
wave_mode=0
wave_usedots=0
wave_additive=0
wave_a=0.9
bModWaveAlphaByVolume=1
modwavealphastart=0.2
modwavealphaend=0.6
      `.trim(),
      { id: 'closed-batched-wave' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
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

    const expectedSegmentCount = frameState.mainWave.positions.length / 3;
    const root = scene.children[0] as RenderTreeNode;
    const segmentCounts = flattenRenderTree(root)
      .filter(isWebGPUSegmentBatchNode)
      .map((child) => getGeometryInstanceCount(child) ?? 0);

    expect(frameState.mainWave.closed).toBe(true);
    expect(segmentCounts).toContain(expectedSegmentCount);
  });

  test('uploads compact line and control attributes for batched webgpu waves', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Compact Batched Wave Upload
wave_mode=0
wave_usedots=0
wave_additive=0
wave_a=0.7
      `.trim(),
      { id: 'compact-batched-wave-upload' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
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

    const root = scene.children[0] as RenderTreeNode;
    const waveMesh = flattenRenderTree(root).find(
      (child) =>
        isWebGPUSegmentBatchNode(child) &&
        getGeometryInstanceCount(child) ===
          frameState.mainWave.positions.length / 3,
    );
    const lineArray = getFloat32AttributeArray(waveMesh, 'instanceLine');
    const controlArray = getFloat32AttributeArray(waveMesh, 'instanceControl');
    const colorArray = getFloat32AttributeArray(waveMesh, 'instanceColorAlpha');
    const positions = frameState.mainWave.positions;

    expect(lineArray?.slice(0, 4)).toEqual(
      Float32Array.from([
        positions[0] ?? 0,
        positions[1] ?? 0,
        (positions[3] ?? 0) - (positions[0] ?? 0),
        (positions[4] ?? 0) - (positions[1] ?? 0),
      ]),
    );
    expect(controlArray?.slice(0, 3)).toEqual(
      Float32Array.from([
        positions[2] ?? 0.24,
        positions[5] ?? 0.24,
        0.0025 * Math.max(1, frameState.mainWave.thickness) * 0.5,
      ]),
    );
    expect(colorArray?.slice(0, 4)).toEqual(
      Float32Array.from([
        frameState.mainWave.color.r,
        frameState.mainWave.color.g,
        frameState.mainWave.color.b,
        frameState.mainWave.alpha,
      ]),
    );
  });

  test('preserves per-point depth across compact WebGPU wave uploads', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Compact Wave Depth
wave_mode=0
wave_usedots=0
wave_additive=0
wave_a=0.7
      `.trim(),
      { id: 'compact-wave-depth' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
    const positions = frameState.mainWave.positions;
    const segmentIndex = Array.from(
      { length: Math.max(0, positions.length / 3 - 1) },
      (_, index) => index,
    ).find((index) => {
      const startZ = positions[index * 3 + 2] ?? 0;
      const endZ = positions[index * 3 + 5] ?? 0;
      return Math.abs(endZ - startZ) > 1e-6;
    });

    expect(segmentIndex).toBeDefined();

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

    const root = scene.children[0] as RenderTreeNode;
    const waveMesh = flattenRenderTree(root).find(
      (child) =>
        isWebGPUSegmentBatchNode(child) &&
        getGeometryInstanceCount(child) ===
          frameState.mainWave.positions.length / 3,
    );
    const controlArray = getFloat32AttributeArray(waveMesh, 'instanceControl');
    const controlOffset = (segmentIndex ?? 0) * 3;

    expect(controlArray?.slice(controlOffset, controlOffset + 3)).toEqual(
      Float32Array.from([
        positions[(segmentIndex ?? 0) * 3 + 2] ?? 0.24,
        positions[(segmentIndex ?? 0) * 3 + 5] ?? 0.24,
        0.0025 * Math.max(1, frameState.mainWave.thickness) * 0.5,
      ]),
    );
  });

  test('keeps additive wave materials transparent when alpha exceeds 1', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Additive Wave Alpha
wave_mode=0
wave_usedots=0
wave_additive=1
wave_a=1.4
bModWaveAlphaByVolume=1
modwavealphastart=0.1
modwavealphaend=0.4
      `.trim(),
      { id: 'additive-wave-alpha' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals());
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

    const root = scene.children[0] as RenderTreeNode;
    const additiveWaveMesh = flattenRenderTree(root).find(
      (child) =>
        isWebGPUSegmentBatchNode(child) &&
        child.material instanceof ShaderMaterial &&
        child.material.blending === AdditiveBlending,
    );

    expect(additiveWaveMesh?.material).toBeInstanceOf(ShaderMaterial);
    expect(
      (additiveWaveMesh?.material as ShaderMaterial | undefined)?.transparent,
    ).toBe(true);
    expect(frameState.mainWave.alpha).toBeGreaterThan(1);
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
wavecode_0_thick=5
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
    const renderedWaveChildren = root.children.flatMap(
      (group) => group.children ?? [],
    );

    expect(frameState.gpuGeometry.customWaves).toHaveLength(1);
    expect(renderedWaveChildren.length).toBeGreaterThan(0);
    expect(frameState.gpuGeometry.customWaves[0]?.thickness).toBe(5);
  });

  test('keeps procedural blend interaction alpha separate from blend alpha on webgpu', () => {
    const currentWave = {
      samples: [0.2, -0.1, 0.3, -0.25, 0.15],
      velocities: [0.04, -0.02, 0.01, -0.03, 0.02],
      mode: 0,
      centerX: 0,
      centerY: 0,
      scale: 1,
      mystery: 0,
      time: 0.3,
      beatPulse: 0.2,
      trebleAtt: 0.35,
      color: { r: 1, g: 1, b: 1, a: 1 },
      alpha: 0.4,
      additive: false,
      thickness: 1,
    };
    const previousWave = {
      ...currentWave,
      time: 0.1,
    };

    const line =
      __milkdropRendererAdapterTestUtils.syncInterpolatedProceduralWaveObject(
        undefined,
        previousWave,
        currentWave,
        0.75,
        0.25,
        {
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          scale: 1,
          alphaMultiplier: 0.675,
        },
      );
    const material = line.material as ShaderMaterial;

    expect(material.uniforms.alpha.value).toBeCloseTo(0.1, 6);
    expect(material.uniforms.interactionAlpha.value).toBeCloseTo(0.675, 6);
    expect(material.uniforms.blendMix.value).toBeCloseTo(0.75, 6);
  });

  test('resamples previous procedural wave buffers to the current vertex count during webgpu blends', () => {
    const interpolatedMainWave =
      __milkdropRendererAdapterTestUtils.syncInterpolatedProceduralWaveObject(
        undefined,
        {
          samples: [0.5, -0.4, 0.3],
          velocities: [0.08, -0.06, 0.05],
          mode: 0,
          centerX: 0,
          centerY: 0,
          scale: 1,
          mystery: 0,
          time: 0.1,
          beatPulse: 0.2,
          trebleAtt: 0.35,
          color: { r: 1, g: 1, b: 1, a: 1 },
          alpha: 0.5,
          additive: false,
          thickness: 1,
        },
        {
          samples: [0.2, -0.1, 0.3, -0.25, 0.15],
          velocities: [0.04, -0.02, 0.01, -0.03, 0.02],
          mode: 0,
          centerX: 0,
          centerY: 0,
          scale: 1,
          mystery: 0,
          time: 0.3,
          beatPulse: 0.2,
          trebleAtt: 0.35,
          color: { r: 1, g: 1, b: 1, a: 1 },
          alpha: 0.5,
          additive: false,
          thickness: 1,
        },
        0.6,
        0.4,
        null,
      );
    const interpolatedCustomWave =
      __milkdropRendererAdapterTestUtils.syncInterpolatedProceduralCustomWaveObject(
        undefined,
        {
          samples: [0.25, -0.15, 0.05],
          spectrum: false,
          centerX: 0,
          centerY: 0,
          scaling: 1,
          mystery: 0,
          time: 0.1,
          color: { r: 1, g: 0.8, b: 0.6, a: 1 },
          alpha: 0.35,
          additive: false,
          thickness: 1,
        },
        {
          samples: Array.from({ length: 40 }, (_, index) =>
            Math.sin(index / 8),
          ),
          spectrum: false,
          centerX: 0,
          centerY: 0,
          scaling: 1,
          mystery: 0,
          time: 0.3,
          color: { r: 0.8, g: 0.4, b: 1, a: 1 },
          alpha: 0.35,
          additive: false,
          thickness: 1,
        },
        0.6,
        0.4,
        null,
      );

    const mainPreviousSampleValues = interpolatedMainWave.geometry.getAttribute(
      'previousSampleValue',
    );
    const mainPreviousSampleVelocities =
      interpolatedMainWave.geometry.getAttribute('previousSampleVelocity');
    const mainSampleT = interpolatedMainWave.geometry.getAttribute('sampleT');
    const customPreviousSampleValues =
      interpolatedCustomWave.geometry.getAttribute('previousSampleValue');
    const customSampleT =
      interpolatedCustomWave.geometry.getAttribute('sampleT');

    expect(mainPreviousSampleValues.array.length).toBe(
      mainSampleT.array.length,
    );
    expect(mainPreviousSampleVelocities.array.length).toBe(
      mainSampleT.array.length,
    );
    expect(customPreviousSampleValues.array.length).toBe(
      customSampleT.array.length,
    );
  });

  test('renders GPU blend snapshots on webgl without requiring CPU-cloned wave state', () => {
    const preset = compileMilkdropPresetSource(
      `
title=WebGL GPU Blend
wave_mode=0
wave_a=1
      `.trim(),
      { id: 'webgl-gpu-blend' },
    );
    const vm = createMilkdropVM(preset);
    const previousFrame = vm.step(makeSignals({ time: 0.1 }));
    const frameState = vm.step(makeSignals({ time: 0.3 }));

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgl',
      preset,
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: {
        mode: 'gpu',
        previousFrame,
        alpha: 0.5,
      },
    });

    const root = scene.children[0] as {
      children: Array<{ children?: Array<{ material?: unknown }> }>;
    };
    const blendWaveGroup = root.children[8];

    expect(blendWaveGroup?.children?.length ?? 0).toBeGreaterThan(0);
    const renderedBlendWave = blendWaveGroup?.children?.[0] as
      | {
          material?: LineBasicMaterial;
        }
      | undefined;
    expect(renderedBlendWave?.material).toBeInstanceOf(LineBasicMaterial);
    expect(renderedBlendWave?.material?.opacity).toBeCloseTo(0.5, 6);
  });

  test('keeps WebGL fallback on CPU geometry for descriptors that WebGPU synthesizes procedurally', () => {
    const preset = compileMilkdropPresetSource(
      `
title=WebGL Fallback Renderer
mesh_density=14
motion_vectors=1
motion_vectors_x=6
motion_vectors_y=4
wave_mode=5
wave_usedots=0
wave_thick=5
wavecode_0_enabled=1
wavecode_0_samples=40
wavecode_0_spectrum=1
wavecode_0_usedots=0
wavecode_0_thick=4
      `.trim(),
      { id: 'webgl-fallback-renderer' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgl');
    const signals = makeSignals();
    signals.frame = 2;
    signals.time = 0.2;
    const frameState = vm.step(signals);

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      backend: 'webgl',
    });

    adapter.attach();
    adapter.render({
      frameState,
      blendState: null,
    });

    const root = scene.children[0] as {
      children: Array<{
        material?: unknown;
        children?: Array<{ material?: unknown }>;
      }>;
    };
    const meshLines = root.children[1] as { material?: unknown };
    const mainWaveGroup = root.children[2] as {
      children: Array<{ material?: unknown }>;
    };
    const customWaveGroup = root.children[3] as {
      children: Array<{ material?: unknown }>;
    };
    const motionVectorGroup = root.children[7] as {
      children: Array<{ children?: Array<{ material?: unknown }> }>;
    };

    expect(frameState.gpuGeometry.mainWave).toBeNull();
    expect(frameState.gpuGeometry.customWaves).toHaveLength(0);
    expect(frameState.gpuGeometry.meshField).toBeNull();
    expect(frameState.gpuGeometry.motionVectorField).toBeNull();
    expect(meshLines.material).toBeInstanceOf(LineBasicMaterial);
    expect(mainWaveGroup.children[0]?.material).toBeInstanceOf(
      LineBasicMaterial,
    );
    expect(customWaveGroup.children[0]?.material).toBeInstanceOf(
      LineBasicMaterial,
    );
    expect(
      (mainWaveGroup.children[0]?.material as LineBasicMaterial | undefined)
        ?.linewidth,
    ).toBe(5);
    expect(
      (customWaveGroup.children[0]?.material as LineBasicMaterial | undefined)
        ?.linewidth,
    ).toBe(4);
    expect(
      motionVectorGroup.children[0]?.children?.[0]?.material,
    ).toBeInstanceOf(LineBasicMaterial);
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
          targets: Array<{ width: number; height: number }>;
        } | null;
      }
    ).feedback;

    expect(result).toBe(true);
    expect(fakeRenderer.setRenderTargetCalls).toBe(3);
    expect(fakeRenderer.renderCalls).toBe(3);
    expect(feedback).not.toBeNull();
  });

  test('uses mixed-resolution half-float feedback targets on webgpu backends', () => {
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
          targets: Array<{ width: number; height: number }>;
        } | null;
      }
    ).feedback;

    expect(feedback).not.toBeNull();
    expect(feedback?.sceneTarget.width).toBe(640);
    expect(feedback?.sceneTarget.height).toBe(360);
    expect(feedback?.targets[0]?.width).toBe(640);
    expect(feedback?.targets[0]?.height).toBe(360);
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
