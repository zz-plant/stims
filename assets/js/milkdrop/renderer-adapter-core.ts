import type { Camera, Scene, ShaderMaterial, Texture } from 'three';
import {
  BufferGeometry,
  Group,
  type Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector2,
} from 'three';
// @ts-expect-error - BundleGroup available in three/webgpu at runtime
import { BundleGroup as WebGpuBundleGroup } from 'three/webgpu';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import {
  type MilkdropBackendBehavior,
  WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
} from './backend-behavior';
import { createMilkdropRendererAdapterSceneOwner } from './renderer-adapter-scene.tsx';
import {
  applyBlendModeToGroup,
  BACKGROUND_GEOMETRY,
  clearGroup,
  disposeObject,
  ensureGeometryPositions,
  getBorderLinePositions,
  getMilkdropLayerRenderOrder,
  getMilkdropPassRenderOrder,
  getShaderSampleDimensionId,
  getShaderTextureBlendModeId,
  getShaderTextureSourceId,
  getShapeFillFallbackColor,
  getUnitPolygonClosedLineGeometry,
  getUnitPolygonFillGeometry,
  getUnitPolygonOutlineGeometry,
  getWaveLinePositions,
  isFeedbackCapableRenderer,
  isSharedGeometry,
  lerpNumber,
  type MilkdropFeedbackManagerFactory,
  type MilkdropRendererAdapterConfig,
  type MilkdropRendererBatcher,
  markAlwaysOnscreen,
  type RendererLike,
  setMaterialColor,
  trimGroupChildren,
  withRenderOrder,
} from './renderer-adapter-shared';
import {
  createBorderObject as createBorderObjectHelper,
  renderBorderGroup as renderBorderGroupHelper,
  syncBorderObject as syncBorderObjectHelper,
  updateBorderFill as updateBorderFillHelper,
  updateBorderLine as updateBorderLineHelper,
} from './renderer-helpers/border-renderer';
import { buildFeedbackCompositeState as buildFeedbackCompositeStateHelper } from './renderer-helpers/feedback-composite';
import { renderMesh as renderMeshHelper } from './renderer-helpers/mesh-renderer';
import { renderMotionVectors as renderMotionVectorsHelper } from './renderer-helpers/motion-vector-renderer';
import { renderParticleFieldGroup as renderParticleFieldGroupHelper } from './renderer-helpers/particle-field-renderer';
import {
  syncInterpolatedProceduralCustomWaveObject,
  syncInterpolatedProceduralWaveObject,
  syncProceduralCustomWaveObject,
  syncProceduralWaveObject,
} from './renderer-helpers/procedural-wave-renderer';
import {
  createShapeObject as createShapeObjectHelper,
  renderShapeGroup as renderShapeGroupHelper,
  syncShapeFillMaterial as syncShapeFillMaterialHelper,
  syncShapeObject as syncShapeObjectHelper,
  syncShapeOutline as syncShapeOutlineHelper,
} from './renderer-helpers/shape-renderer';
import {
  renderLineVisualGroup as renderLineVisualGroupHelper,
  renderWaveGroup as renderWaveGroupHelper,
  syncLineObject as syncLineObjectHelper,
  syncWaveObject as syncWaveObjectHelper,
} from './renderer-helpers/wave-renderer';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropCompiledPreset,
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropGpuGeometryHints,
  MilkdropGpuInteractionTransform,
  MilkdropParticleFieldVisual,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveVisual,
  MilkdropRendererAdapter,
  MilkdropRenderPayload,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
  MilkdropWebGpuDescriptorPlan,
} from './types';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags';

export type {
  FeedbackBackendProfile,
  MilkdropBackendBehavior,
} from './backend-behavior';
export {
  getFeedbackBackendProfile,
  WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
} from './backend-behavior';
export type {
  MilkdropRendererAdapterConfig,
  MilkdropRendererBatcher,
} from './renderer-adapter-shared';

const reusableInterpolatedShapes: MilkdropShapeVisual[] = [];
const reusableInterpolatedCustomWaves: {
  previous: import('./types').MilkdropProceduralCustomWaveVisual;
  current: import('./types').MilkdropProceduralCustomWaveVisual;
}[] = [];

function lerpColor(
  previousColor: MilkdropColor,
  currentColor: MilkdropColor,
  mix: number,
  { preservePreviousAlpha = false }: { preservePreviousAlpha?: boolean } = {},
): MilkdropColor {
  return {
    r: lerpNumber(previousColor.r, currentColor.r, mix),
    g: lerpNumber(previousColor.g, currentColor.g, mix),
    b: lerpNumber(previousColor.b, currentColor.b, mix),
    ...(previousColor.a !== undefined || currentColor.a !== undefined
      ? {
          a: preservePreviousAlpha
            ? (previousColor.a ?? currentColor.a ?? 0)
            : lerpNumber(previousColor.a ?? 0, currentColor.a ?? 0, mix),
        }
      : {}),
  };
}

function interpolateShapeVisual(
  previousShape: MilkdropShapeVisual,
  currentShape: MilkdropShapeVisual,
  mix: number,
): MilkdropShapeVisual {
  return {
    ...currentShape,
    x: lerpNumber(previousShape.x, currentShape.x, mix),
    y: lerpNumber(previousShape.y, currentShape.y, mix),
    radius: lerpNumber(previousShape.radius, currentShape.radius, mix),
    rotation: lerpNumber(previousShape.rotation, currentShape.rotation, mix),
    textured: previousShape.textured || currentShape.textured,
    textureZoom: lerpNumber(
      previousShape.textureZoom,
      currentShape.textureZoom,
      mix,
    ),
    textureAngle: lerpNumber(
      previousShape.textureAngle,
      currentShape.textureAngle,
      mix,
    ),
    color: lerpColor(previousShape.color, currentShape.color, mix, {
      preservePreviousAlpha: true,
    }),
    secondaryColor:
      previousShape.secondaryColor || currentShape.secondaryColor
        ? lerpColor(
            previousShape.secondaryColor ?? previousShape.color,
            currentShape.secondaryColor ?? currentShape.color,
            mix,
            {
              preservePreviousAlpha: true,
            },
          )
        : null,
    borderColor: lerpColor(
      previousShape.borderColor,
      currentShape.borderColor,
      mix,
      {
        preservePreviousAlpha: true,
      },
    ),
    additive: previousShape.additive || currentShape.additive,
    thickOutline: previousShape.thickOutline || currentShape.thickOutline,
  };
}

class ThreeMilkdropAdapter implements MilkdropRendererAdapter {
  readonly backend: 'webgl' | 'webgpu';
  private readonly behavior: MilkdropBackendBehavior;
  private readonly createFeedbackManager: MilkdropFeedbackManagerFactory | null;
  private readonly batcher: MilkdropRendererBatcher | null;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly renderer: RendererLike | null;
  private readonly root = new Group();
  private readonly background = withRenderOrder(
    markAlwaysOnscreen(
      new Mesh(
        BACKGROUND_GEOMETRY,
        new MeshBasicMaterial({
          color: 0x000000,
          transparent: false,
          opacity: 1,
          depthWrite: true,
          depthTest: false,
        }),
      ),
    ),
    getMilkdropLayerRenderOrder('background'),
  );
  private readonly meshLines: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = withRenderOrder(
    markAlwaysOnscreen(
      new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({
          color: 0x4d66f2,
          transparent: true,
          opacity: 0.24,
        }),
      ),
    ),
    getMilkdropLayerRenderOrder('mesh'),
  );
  private readonly mainWaveGroup = withRenderOrder(
    new Group(),
    getMilkdropLayerRenderOrder('main-wave'),
  );
  private readonly customWaveGroup = withRenderOrder(
    new Group(),
    getMilkdropLayerRenderOrder('custom-wave'),
  );
  private readonly trailGroup = withRenderOrder(
    new Group(),
    getMilkdropLayerRenderOrder('trails'),
  );
  private readonly particleFieldGroup = withRenderOrder(
    new Group(),
    getMilkdropLayerRenderOrder('particle-field'),
  );
  private readonly shapesGroup = withRenderOrder(
    new Group(),
    getMilkdropLayerRenderOrder('shapes'),
  );
  private readonly borderGroup = withRenderOrder(
    markAlwaysOnscreen(new Group()),
    getMilkdropLayerRenderOrder('borders'),
  );
  private readonly motionVectorGroup = withRenderOrder(
    markAlwaysOnscreen(new Group()),
    getMilkdropLayerRenderOrder('motion-vectors'),
  );
  private readonly motionVectorCpuGroup = withRenderOrder(
    markAlwaysOnscreen(new Group()),
    getMilkdropLayerRenderOrder('motion-vectors'),
  );
  private readonly proceduralMotionVectors: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = withRenderOrder(
    markAlwaysOnscreen(
      new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.35,
        }),
      ),
    ),
    getMilkdropLayerRenderOrder('motion-vectors'),
  );
  private readonly blendWaveGroup = withRenderOrder(
    new Group(),
    getMilkdropLayerRenderOrder('blend-main-wave'),
  );
  private readonly blendCustomWaveGroup = withRenderOrder(
    new Group(),
    getMilkdropLayerRenderOrder('blend-custom-wave'),
  );
  private readonly blendParticleFieldGroup = withRenderOrder(
    new Group(),
    getMilkdropLayerRenderOrder('blend-particle-field'),
  );
  private readonly blendShapeGroup = withRenderOrder(
    new Group(),
    getMilkdropLayerRenderOrder('blend-shapes'),
  );
  private readonly blendBorderGroup = withRenderOrder(
    markAlwaysOnscreen(new Group()),
    getMilkdropLayerRenderOrder('blend-borders'),
  );
  private readonly blendMotionVectorGroup = withRenderOrder(
    markAlwaysOnscreen(new Group()),
    getMilkdropLayerRenderOrder('blend-motion-vectors'),
  );
  private readonly blendMotionVectorCpuGroup = withRenderOrder(
    markAlwaysOnscreen(new Group()),
    getMilkdropLayerRenderOrder('blend-motion-vectors'),
  );
  private readonly blendProceduralMotionVectors: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = withRenderOrder(
    markAlwaysOnscreen(
      new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.35,
        }),
      ),
    ),
    getMilkdropLayerRenderOrder('blend-motion-vectors'),
  );
  private readonly feedback: MilkdropFeedbackManager | null;
  private readonly sceneOwner: ReturnType<
    typeof createMilkdropRendererAdapterSceneOwner
  >;
  private webgpuDescriptorPlan: MilkdropWebGpuDescriptorPlan | null = null;
  private readonly webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags;
  private static lineThicknessLogged = new Set<'webgl' | 'webgpu'>();

  constructor({
    scene,
    camera,
    renderer,
    backend,
    behavior,
    createFeedbackManager,
    batcher,
    webgpuOptimizationFlags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  }: {
    scene: Scene;
    camera: Camera;
    renderer: RendererLike | null;
    backend: 'webgl' | 'webgpu';
    behavior: MilkdropBackendBehavior;
    createFeedbackManager: MilkdropFeedbackManagerFactory | null;
    batcher: MilkdropRendererBatcher | null;
    webgpuOptimizationFlags?: MilkdropWebGpuOptimizationFlags;
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.backend = backend;
    this.behavior = behavior;
    this.createFeedbackManager = createFeedbackManager;
    this.batcher = batcher;
    this.webgpuOptimizationFlags = { ...webgpuOptimizationFlags };
    this.sceneOwner = createMilkdropRendererAdapterSceneOwner({
      scene: this.scene,
      root: this.root,
    });
    this.root.frustumCulled = false;
    this.meshLines.geometry.userData.skipDynamicBounds = true;
    this.proceduralMotionVectors.geometry.userData.skipDynamicBounds = true;
    this.blendProceduralMotionVectors.geometry.userData.skipDynamicBounds = true;

    this.background.position.z = -1.2;
    this.meshLines.position.z = -0.3;

    // When WebGPU render bundles are enabled, group static objects into a
    // BundleGroup so the renderer records their draw calls once per bundle
    // lifetime instead of every frame.
    const useBundles =
      backend === 'webgpu' && this.webgpuOptimizationFlags.renderBundles;
    if (useBundles && WebGpuBundleGroup) {
      const staticBundle = new WebGpuBundleGroup();
      staticBundle.add(this.background);
      staticBundle.add(this.meshLines);
      staticBundle.add(this.borderGroup);
      staticBundle.add(this.motionVectorCpuGroup);
      staticBundle.add(this.blendBorderGroup);
      staticBundle.add(this.blendMotionVectorCpuGroup);
      this.root.add(staticBundle);
    } else {
      this.root.add(this.background);
      this.root.add(this.meshLines);
    }
    this.root.add(this.mainWaveGroup);
    this.root.add(this.customWaveGroup);
    this.root.add(this.trailGroup);
    this.root.add(this.particleFieldGroup);
    this.root.add(this.shapesGroup);
    this.root.add(this.borderGroup);
    this.motionVectorGroup.add(this.motionVectorCpuGroup);
    this.proceduralMotionVectors.visible = false;
    this.motionVectorGroup.add(this.proceduralMotionVectors);
    this.root.add(this.motionVectorGroup);
    this.root.add(this.blendWaveGroup);
    this.root.add(this.blendCustomWaveGroup);
    this.root.add(this.blendParticleFieldGroup);
    this.root.add(this.blendShapeGroup);
    this.root.add(this.blendBorderGroup);
    this.blendMotionVectorGroup.add(this.blendMotionVectorCpuGroup);
    this.blendProceduralMotionVectors.visible = false;
    this.blendMotionVectorGroup.add(this.blendProceduralMotionVectors);
    this.root.add(this.blendMotionVectorGroup);
    this.batcher?.attach(this.root);

    if (!ThreeMilkdropAdapter.lineThicknessLogged.has(backend)) {
      ThreeMilkdropAdapter.lineThicknessLogged.add(backend);
      if (typeof console !== 'undefined' && 'debug' in console) {
        console.debug(
          backend === 'webgpu'
            ? 'line: WebGPU shader-quad variable-width'
            : 'line: WebGL 1px fixed-width (4 offset passes)',
        );
      }
    }

    if (
      this.behavior.supportsFeedbackPass &&
      isFeedbackCapableRenderer(renderer) &&
      this.createFeedbackManager
    ) {
      const size = renderer.getSize(new Vector2());
      this.feedback = this.createFeedbackManager(
        Math.max(1, Math.round(size.x)),
        Math.max(1, Math.round(size.y)),
      );
    } else {
      this.feedback = null;
    }
  }

  attach() {
    this.sceneOwner?.attach();
    if (!this.scene.children.includes(this.root)) {
      this.scene.add(this.root);
    }
  }

  setPreset(preset: MilkdropCompiledPreset) {
    this.webgpuDescriptorPlan =
      this.backend === 'webgpu'
        ? applyMilkdropWebGpuOptimizationFlags(
            preset.ir.compatibility.gpuDescriptorPlans.webgpu,
            this.webgpuOptimizationFlags,
          )
        : null;
  }

  assessSupport(preset: MilkdropCompiledPreset) {
    return preset.ir.compatibility.backends[this.backend];
  }

  resize(width: number, height: number) {
    this.feedback?.resize(width, height);
  }

  setAdaptiveQuality(
    multipliers: Partial<{
      feedbackResolutionMultiplier: number;
    }>,
  ) {
    this.feedback?.setAdaptiveQuality?.(multipliers);
  }

  private renderWaveGroup(
    target:
      | 'main-wave'
      | 'custom-wave'
      | 'blend-main-wave'
      | 'blend-custom-wave',
    group: Group,
    waves: MilkdropWaveVisual[],
    alphaMultiplier = 1,
  ) {
    return renderWaveGroupHelper({
      target,
      group,
      waves,
      alphaMultiplier,
      batcher: this.batcher,
      clearGroup,
      trimGroupChildren,
      syncWaveObject: (existing, wave, nextAlphaMultiplier) => {
        const synced = syncWaveObjectHelper(
          existing,
          wave,
          this.behavior,
          {
            disposeObject,
            ensureGeometryPositions,
            getWaveLinePositions,
            setMaterialColor,
          },
          nextAlphaMultiplier,
        );
        if (synced) {
          synced.renderOrder = getMilkdropPassRenderOrder(
            target,
            wave.additive,
          );
          if (wave.blendMode) {
            applyBlendModeToGroup(synced, wave.blendMode);
          }
        }
        return synced;
      },
    });
  }

  private renderProceduralWaveGroup(
    target: 'main-wave' | 'trail-waves',
    group: Group,
    waves: MilkdropProceduralWaveVisual[],
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    if (this.batcher?.renderProceduralWaveGroup?.(target, group, waves)) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropProceduralWaveVisual;
      const existing = group.children[index] as Line | undefined;
      const synced = syncProceduralWaveObject(existing, wave, interaction);
      synced.renderOrder = getMilkdropPassRenderOrder(
        target === 'trail-waves' ? 'trails' : 'main-wave',
        wave.additive,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderProceduralCustomWaveGroup(
    group: Group,
    waves: MilkdropProceduralCustomWaveVisual[],
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    if (this.batcher?.renderProceduralCustomWaveGroup?.(group, waves)) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropProceduralCustomWaveVisual;
      const existing = group.children[index] as Line | undefined;
      const synced = syncProceduralCustomWaveObject(
        existing,
        wave,
        interaction,
      );
      synced.renderOrder = getMilkdropPassRenderOrder(
        'custom-wave',
        wave.additive,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderInterpolatedProceduralWaveGroup(
    group: Group,
    waves: Array<{
      previous: MilkdropProceduralWaveVisual;
      current: MilkdropProceduralWaveVisual;
    }>,
    mix: number,
    alphaMultiplier: number,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as {
        previous: MilkdropProceduralWaveVisual;
        current: MilkdropProceduralWaveVisual;
      };
      const existing = group.children[index] as Line | undefined;
      const synced = syncInterpolatedProceduralWaveObject(
        existing,
        wave.previous,
        wave.current,
        mix,
        alphaMultiplier,
        interaction,
      );
      synced.renderOrder = getMilkdropPassRenderOrder(
        'blend-main-wave',
        wave.previous.additive || wave.current.additive,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderInterpolatedProceduralCustomWaveGroup(
    group: Group,
    waves: Array<{
      previous: MilkdropProceduralCustomWaveVisual;
      current: MilkdropProceduralCustomWaveVisual;
    }>,
    mix: number,
    alphaMultiplier: number,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as {
        previous: MilkdropProceduralCustomWaveVisual;
        current: MilkdropProceduralCustomWaveVisual;
      };
      const existing = group.children[index] as Line | undefined;
      const synced = syncInterpolatedProceduralCustomWaveObject(
        existing,
        wave.previous,
        wave.current,
        mix,
        alphaMultiplier,
        interaction,
      );
      synced.renderOrder = getMilkdropPassRenderOrder(
        'blend-custom-wave',
        wave.previous.additive || wave.current.additive,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderShapeGroup(
    target: 'shapes' | 'blend-shapes',
    group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier = 1,
  ) {
    this.batcher?.setShapeTexture?.(
      (this.feedback?.getShapeTexture?.() as Texture | null) ?? null,
    );
    return renderShapeGroupHelper({
      target,
      group,
      shapes,
      alphaMultiplier,
      batcher: this.batcher,
      clearGroup,
      trimGroupChildren,
      syncShapeObject: (existing, shape, nextAlphaMultiplier) => {
        const synced = syncShapeObjectHelper(
          existing,
          shape,
          this.behavior,
          {
            disposeObject,
            createShapeObject: (nextShape, createAlphaMultiplier) =>
              createShapeObjectHelper(
                nextShape,
                this.behavior,
                {
                  getShapeFillFallbackColor,
                  getShapeTexture: () =>
                    (this.feedback?.getShapeTexture?.() as Texture | null) ??
                    null,
                  getUnitPolygonFillGeometry,
                  getUnitPolygonOutlineGeometry,
                  getUnitPolygonClosedLineGeometry,
                },
                createAlphaMultiplier,
              ),
            syncShapeFillMaterial: (mesh, nextShape, syncAlphaMultiplier) =>
              syncShapeFillMaterialHelper(
                mesh,
                nextShape,
                this.behavior,
                {
                  disposeMaterial,
                  getShapeFillFallbackColor,
                  getShapeTexture: () =>
                    (this.feedback?.getShapeTexture?.() as Texture | null) ??
                    null,
                  setMaterialColor,
                },
                syncAlphaMultiplier,
              ),
            syncShapeOutline: (
              object,
              nextShape,
              syncAlphaMultiplier,
              opacity,
            ) =>
              syncShapeOutlineHelper(
                object,
                nextShape,
                this.behavior,
                {
                  getUnitPolygonOutlineGeometry,
                  getUnitPolygonClosedLineGeometry,
                  setMaterialColor,
                },
                syncAlphaMultiplier,
                opacity,
              ),
            getUnitPolygonFillGeometry,
          },
          nextAlphaMultiplier,
        );
        synced.renderOrder = getMilkdropPassRenderOrder(target, shape.additive);
        if (shape.blendMode) {
          applyBlendModeToGroup(synced, shape.blendMode);
        }
        return synced;
      },
    });
  }

  private renderBorderGroup(
    target: 'borders' | 'blend-borders',
    group: Group,
    borders: MilkdropBorderVisual[],
    alphaMultiplier = 1,
  ) {
    return renderBorderGroupHelper({
      target,
      group,
      borders,
      alphaMultiplier,
      batcher: this.batcher,
      clearGroup,
      trimGroupChildren,
      disposeObject,
      syncBorderObject: (existing, border, nextAlphaMultiplier) =>
        syncBorderObjectHelper(
          existing,
          border,
          this.behavior,
          {
            disposeObject,
            createBorderObject: (nextBorder, createAlphaMultiplier) =>
              createBorderObjectHelper(
                nextBorder,
                this.behavior,
                {
                  ensureGeometryPositions,
                  getBorderLinePositions,
                  markAlwaysOnscreen,
                  setMaterialColor,
                },
                createAlphaMultiplier,
              ),
            updateBorderFill: (object, nextBorder, syncAlphaMultiplier) =>
              updateBorderFillHelper(
                object,
                nextBorder,
                {
                  setMaterialColor,
                },
                syncAlphaMultiplier,
              ),
            updateBorderLine: (object, nextBorder, syncAlphaMultiplier) =>
              updateBorderLineHelper(
                object,
                nextBorder,
                this.behavior,
                {
                  ensureGeometryPositions,
                  getBorderLinePositions,
                  setMaterialColor,
                },
                syncAlphaMultiplier,
              ),
          },
          nextAlphaMultiplier,
        ),
    });
  }

  private renderInterpolatedShapeGroup(
    group: Group,
    previousShapes: MilkdropShapeVisual[],
    currentShapes: MilkdropShapeVisual[],
    mix: number,
    alphaMultiplier = 1,
  ) {
    const interpolatedShapes = reusableInterpolatedShapes;
    interpolatedShapes.length = previousShapes.length;
    for (let i = 0; i < previousShapes.length; i++) {
      const previousShape = previousShapes[i];
      const currentShape = currentShapes[i];
      interpolatedShapes[i] = currentShape
        ? interpolateShapeVisual(previousShape, currentShape, mix)
        : previousShape;
    }
    this.renderShapeGroup(
      'blend-shapes',
      group,
      interpolatedShapes,
      alphaMultiplier,
    );
  }

  private renderLineVisualGroup(
    target: 'trails' | 'motion-vectors' | 'blend-motion-vectors',
    group: Group,
    lines: Array<{
      positions: number[];
      color: MilkdropColor;
      alpha: number;
      additive?: boolean;
    }>,
    alphaMultiplier = 1,
  ) {
    return renderLineVisualGroupHelper({
      target,
      group,
      lines,
      alphaMultiplier,
      batcher: this.batcher,
      clearGroup,
      trimGroupChildren,
      syncLineObject: (existing, line, nextAlphaMultiplier) => {
        const synced = syncLineObjectHelper(
          existing,
          line,
          nextAlphaMultiplier,
          {
            disposeObject,
            ensureGeometryPositions,
            markAlwaysOnscreen,
            setMaterialColor,
          },
        );
        if (!synced) {
          return null;
        }
        synced.renderOrder = getMilkdropPassRenderOrder(target, line.additive);
        return synced;
      },
    });
  }

  private renderMesh(
    mesh: MilkdropRenderPayload['frameState']['mesh'],
    gpuGeometry: MilkdropGpuGeometryHints,
    signals: MilkdropRenderPayload['frameState']['signals'],
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    return renderMeshHelper({
      backend: this.backend,
      meshLines: this.meshLines,
      mesh,
      gpuGeometry,
      signals,
      webgpuDescriptorPlan: this.webgpuDescriptorPlan,
      interaction,
      disposeMaterial,
      ensureGeometryPositions,
      setMaterialColor,
    });
  }

  private renderMotionVectors(
    payload: MilkdropRenderPayload['frameState'],
    alphaMultiplier = 1,
    previousFrame?: MilkdropRenderPayload['frameState'] | null,
    blendMix = 1,
    cpuGroup: Group = this.motionVectorCpuGroup,
    proceduralObject: LineSegments<
      BufferGeometry,
      LineBasicMaterial | ShaderMaterial
    > = this.proceduralMotionVectors,
  ) {
    return renderMotionVectorsHelper({
      backend: this.backend,
      webgpuDescriptorPlanProceduralMotionVectors:
        this.webgpuDescriptorPlan?.proceduralMotionVectors ?? null,
      payload,
      alphaMultiplier,
      previousFrame,
      blendMix,
      cpuGroup,
      proceduralObject,
      clearGroup,
      renderLineVisualGroup: (target, group, lines, nextAlphaMultiplier) =>
        this.renderLineVisualGroup(target, group, lines, nextAlphaMultiplier),
    });
  }

  private buildFeedbackCompositeState(
    frameState: MilkdropRenderPayload['frameState'],
  ): MilkdropFeedbackCompositeState {
    return buildFeedbackCompositeStateHelper({
      frameState,
      backend: this.backend,
      directFeedbackShaders: this.webgpuOptimizationFlags.directFeedbackShaders,
      webgpuFeedbackPlanShaderExecution:
        this.webgpuDescriptorPlan?.feedback?.shaderExecution,
      getShaderTextureSourceId,
      getShaderTextureBlendModeId,
      getShaderSampleDimensionId,
    });
  }

  private renderFrameVisuals(
    frameState: MilkdropRenderPayload['frameState'],
    mainWaveGroup: Group,
    customWaveGroup: Group,
    trailGroup: Group,
    particleFieldGroup: Group,
    shapesGroup: Group,
    borderGroup: Group,
    motionVectorGroup: Group,
    proceduralMotionVectors: LineSegments<
      BufferGeometry,
      LineBasicMaterial | ShaderMaterial
    >,
    alphaMultiplier = 1,
    blend?: {
      previousFrame?: MilkdropRenderPayload['frameState'];
      blendMix?: number;
    } | null,
  ) {
    const {
      gpuGeometry: gpu,
      interaction,
      signals,
      mainWave,
      customWaves,
      trails,
      mesh,
      shapes,
      borders,
    } = frameState;
    const plans = this.webgpuDescriptorPlan?.proceduralWaves ?? [];
    const canProcedural = (target: string) =>
      this.backend === 'webgpu' && plans.some((p) => p.target === target);
    const canProceduralMain =
      canProcedural('main-wave') && gpu?.mainWave != null;
    const canProceduralCustom =
      canProcedural('custom-wave') && (gpu?.customWaves?.length ?? 0) > 0;

    if (canProceduralMain && gpu.mainWave) {
      this.renderProceduralWaveGroup('main-wave', mainWaveGroup, [
        gpu.mainWave,
      ]);
    } else {
      this.renderWaveGroup(
        'main-wave',
        mainWaveGroup,
        [mainWave],
        alphaMultiplier,
      );
    }
    if (canProceduralCustom && gpu.customWaves.length > 0) {
      this.renderProceduralCustomWaveGroup(
        customWaveGroup,
        gpu.customWaves,
        interaction?.waves,
      );
    } else {
      this.renderWaveGroup(
        'custom-wave',
        customWaveGroup,
        customWaves,
        alphaMultiplier,
      );
    }
    if (canProcedural('trail-waves') && (gpu?.trailWaves?.length ?? 0) > 0) {
      this.renderProceduralWaveGroup(
        'trail-waves',
        trailGroup,
        gpu.trailWaves,
        interaction?.waves,
      );
    } else {
      this.renderLineVisualGroup('trails', trailGroup, trails, alphaMultiplier);
    }
    renderParticleFieldGroupHelper({
      target: 'particle-field',
      group: particleFieldGroup,
      particleField:
        (gpu as { particleField?: MilkdropParticleFieldVisual | null })
          ?.particleField ?? null,
      mesh,
      meshPositions: mesh.positions,
      signals,
      trimGroupChildren,
      alphaMultiplier,
    });
    this.renderShapeGroup('shapes', shapesGroup, shapes, alphaMultiplier);
    this.renderBorderGroup('borders', borderGroup, borders, alphaMultiplier);
    this.renderMotionVectors(
      frameState,
      alphaMultiplier,
      blend?.previousFrame ?? null,
      blend?.blendMix ?? 1,
      motionVectorGroup,
      proceduralMotionVectors,
    );
  }

  private renderBlendVisuals(
    payload: MilkdropRenderPayload,
    blend: NonNullable<MilkdropRenderPayload['blendState']>,
  ) {
    if (blend.mode === 'gpu') {
      const prev = blend.previousFrame;
      const blendMix = 1 - blend.alpha;
      const plans = this.webgpuDescriptorPlan?.proceduralWaves ?? [];
      const canProcedural = (target: string) =>
        this.backend === 'webgpu' && plans.some((p) => p.target === target);

      if (
        canProcedural('main-wave') &&
        prev.gpuGeometry.mainWave &&
        payload.frameState.gpuGeometry.mainWave
      ) {
        const interaction = (
          t: 'offsetX' | 'offsetY' | 'rotation' | 'scale' | 'alphaMultiplier',
          def: number,
        ) =>
          lerpNumber(
            prev.interaction?.waves[t] ?? def,
            payload.frameState.interaction?.waves[t] ?? def,
            blendMix,
          );
        this.renderInterpolatedProceduralWaveGroup(
          this.blendWaveGroup,
          [
            {
              previous: prev.gpuGeometry.mainWave,
              current: payload.frameState.gpuGeometry.mainWave,
            },
          ],
          blendMix,
          blend.alpha,
          {
            offsetX: interaction('offsetX', 0),
            offsetY: interaction('offsetY', 0),
            rotation: interaction('rotation', 0),
            scale: interaction('scale', 1),
            alphaMultiplier: interaction('alphaMultiplier', 1),
          },
        );
      } else {
        this.renderWaveGroup(
          'blend-main-wave',
          this.blendWaveGroup,
          [prev.mainWave],
          blend.alpha,
        );
      }
      if (
        canProcedural('custom-wave') &&
        prev.gpuGeometry.customWaves.length > 0
      ) {
        const interpolated = reusableInterpolatedCustomWaves;
        interpolated.length = prev.gpuGeometry.customWaves.length;
        for (let i = 0; i < prev.gpuGeometry.customWaves.length; i++) {
          const wave = prev.gpuGeometry.customWaves[i];
          interpolated[i] = {
            previous: wave,
            current: payload.frameState.gpuGeometry.customWaves[i] ?? wave,
          };
        }
        const interp = (
          t: 'offsetX' | 'offsetY' | 'rotation' | 'scale' | 'alphaMultiplier',
          def: number,
        ) =>
          lerpNumber(
            prev.interaction?.waves[t] ?? def,
            payload.frameState.interaction?.waves[t] ?? def,
            blendMix,
          );
        this.renderInterpolatedProceduralCustomWaveGroup(
          this.blendCustomWaveGroup,
          interpolated,
          blendMix,
          blend.alpha,
          {
            offsetX: interp('offsetX', 0),
            offsetY: interp('offsetY', 0),
            rotation: interp('rotation', 0),
            scale: interp('scale', 1),
            alphaMultiplier: interp('alphaMultiplier', 1),
          },
        );
      } else {
        this.renderWaveGroup(
          'blend-custom-wave',
          this.blendCustomWaveGroup,
          prev.customWaves,
          blend.alpha,
        );
      }
      renderParticleFieldGroupHelper({
        target: 'blend-particle-field',
        group: this.blendParticleFieldGroup,
        particleField:
          (
            prev.gpuGeometry as {
              particleField?: MilkdropParticleFieldVisual | null;
            }
          ).particleField ?? null,
        mesh: prev.mesh,
        meshPositions: prev.mesh.positions,
        signals: prev.signals,
        alphaMultiplier: blend.alpha,
        trimGroupChildren,
      });
      this.renderInterpolatedShapeGroup(
        this.blendShapeGroup,
        prev.shapes,
        payload.frameState.shapes,
        blendMix,
        blend.alpha,
      );
      this.renderBorderGroup(
        'blend-borders',
        this.blendBorderGroup,
        prev.borders,
        blend.alpha,
      );
      this.renderMotionVectors(
        payload.frameState,
        blend.alpha,
        prev,
        blendMix,
        this.blendMotionVectorCpuGroup,
        this.blendProceduralMotionVectors,
      );
      if (
        !this.blendProceduralMotionVectors.visible &&
        prev.motionVectors.length === 0
      ) {
        clearGroup(this.blendMotionVectorCpuGroup);
      }
    } else {
      const alpha = blend.alpha ?? 0;
      this.renderWaveGroup(
        'blend-main-wave',
        this.blendWaveGroup,
        blend.mode === 'cpu' ? [blend.mainWave] : [],
        alpha,
      );
      this.renderWaveGroup(
        'blend-custom-wave',
        this.blendCustomWaveGroup,
        blend.mode === 'cpu' ? blend.customWaves : [],
        alpha,
      );
      renderParticleFieldGroupHelper({
        target: 'blend-particle-field',
        group: this.blendParticleFieldGroup,
        particleField: null,
        mesh: payload.frameState.mesh,
        meshPositions: payload.frameState.mesh.positions,
        signals: payload.frameState.signals,
        alphaMultiplier: alpha,
        trimGroupChildren,
      });
      this.renderShapeGroup(
        'blend-shapes',
        this.blendShapeGroup,
        blend.mode === 'cpu' ? blend.shapes : [],
        alpha,
      );
      this.renderBorderGroup(
        'blend-borders',
        this.blendBorderGroup,
        blend.mode === 'cpu' ? blend.borders : [],
        alpha,
      );
      this.blendProceduralMotionVectors.visible = false;
      this.renderLineVisualGroup(
        'blend-motion-vectors',
        this.blendMotionVectorCpuGroup,
        blend.mode === 'cpu' ? blend.motionVectors : [],
        alpha,
      );
    }
  }

  render(payload: MilkdropRenderPayload) {
    const backgroundMaterial = this.background.material as MeshBasicMaterial;
    setMaterialColor(backgroundMaterial, payload.frameState.background, 1);

    this.renderMesh(
      payload.frameState.mesh,
      payload.frameState.gpuGeometry,
      payload.frameState.signals,
      payload.frameState.interaction?.mesh,
    );
    this.renderFrameVisuals(
      payload.frameState,
      this.mainWaveGroup,
      this.customWaveGroup,
      this.trailGroup,
      this.particleFieldGroup,
      this.shapesGroup,
      this.borderGroup,
      this.motionVectorCpuGroup,
      this.proceduralMotionVectors,
    );

    const blend = payload.blendState;
    if (blend) {
      this.renderBlendVisuals(payload, blend);
    }

    if (
      !isFeedbackCapableRenderer(this.renderer) ||
      !this.feedback ||
      !payload.frameState.post.shaderEnabled
    ) {
      return false;
    }
    this.feedback.applyCompositeState(
      this.buildFeedbackCompositeState(payload.frameState),
    );
    return this.feedback.render(this.renderer, this.scene, this.camera);
  }

  dispose() {
    clearGroup(this.mainWaveGroup);
    clearGroup(this.customWaveGroup);
    clearGroup(this.trailGroup);
    clearGroup(this.particleFieldGroup);
    clearGroup(this.shapesGroup);
    clearGroup(this.borderGroup);
    clearGroup(this.motionVectorGroup);
    clearGroup(this.blendWaveGroup);
    clearGroup(this.blendCustomWaveGroup);
    clearGroup(this.blendParticleFieldGroup);
    clearGroup(this.blendShapeGroup);
    clearGroup(this.blendBorderGroup);
    clearGroup(this.blendMotionVectorGroup);
    if (!isSharedGeometry(this.background.geometry)) {
      disposeGeometry(this.background.geometry);
    }
    disposeMaterial(this.background.material);
    if (!isSharedGeometry(this.meshLines.geometry)) {
      disposeGeometry(this.meshLines.geometry);
    }
    disposeMaterial(this.meshLines.material);
    this.batcher?.dispose();
    this.feedback?.dispose();
    this.scene.remove(this.root);
    this.sceneOwner?.dispose();
  }
}

export function createMilkdropRendererAdapterCore({
  scene,
  camera,
  renderer,
  backend,
  preset,
  behavior,
  createFeedbackManager,
  batcher,
  webgpuOptimizationFlags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
}: MilkdropRendererAdapterConfig) {
  const adapter = new ThreeMilkdropAdapter({
    scene,
    camera,
    renderer: renderer ?? null,
    backend,
    behavior:
      behavior ??
      (backend === 'webgpu'
        ? WEBGPU_MILKDROP_BACKEND_BEHAVIOR
        : WEBGL_MILKDROP_BACKEND_BEHAVIOR),
    createFeedbackManager: createFeedbackManager ?? null,
    batcher: batcher ?? null,
    webgpuOptimizationFlags,
  });
  if (preset) {
    adapter.setPreset(preset);
  }
  return adapter;
}

export const createMilkdropRendererAdapter = createMilkdropRendererAdapterCore;

export const __milkdropRendererAdapterTestUtils = {
  syncInterpolatedProceduralWaveObject,
  syncInterpolatedProceduralCustomWaveObject,
};
