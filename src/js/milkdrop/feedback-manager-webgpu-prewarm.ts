/**
 * Pre-fade pipeline warm-up for the WebGPU feedback manager.
 *
 * A preset switch's first blended frames used to pay the incoming preset's
 * first-draw compilation synchronously — on a 120Hz hardware tab that
 * measured as 258–433ms single frames at blend start while the steady blend
 * cadence stayed at baseline. This controller moves that compilation before
 * the fade: the runtime's switch gate (runtime/preset-switch-warmup.ts)
 * calls `warmup` while the outgoing preset still renders undisturbed, and
 * the manager's first `applyCompositeState` for the incoming preset consumes
 * the pre-built node graphs through `consumeFor` as a pipeline cache hit.
 *
 * The controller owns three things the manager should not have to think
 * about mid-frame:
 *
 * - the single stash slot and its generation counter, so a superseding
 *   switch (rapid next-preset during warm-up) discards the loser cleanly;
 * - throwaway draw objects whose pipelines are byte-identical to the ones
 *   the live path will submit — same material factories, object kinds,
 *   shared geometries and render targets, because three's pipeline cache
 *   key covers topology, attribute layout, formats and sample count;
 * - retirement bookkeeping: warm materials outlive the swap into the live
 *   materials (the renderer's program refcounts), and field warm objects
 *   outlive the next warm-up.
 *
 * Best-effort by contract: `warmup` resolves `false` — never rejects — when
 * this manager cannot warm (no renderer yet, no compileAsync, superseded),
 * and the switch proceeds exactly as it would have without a warm-up.
 */
import {
  type Camera,
  type Line,
  LineSegments,
  type Material,
  Mesh,
  PlaneGeometry,
  Scene,
} from 'three';
import { NodeMaterial, type RenderTarget } from 'three/webgpu';
import { disposeGeometry, disposeMaterial } from '../utils/three/three-dispose';
import { isSharedGeometry } from './renderer-adapter-shared';
import { getProceduralMeshGeometry } from './renderer-helpers/mesh-renderer';
import { getProceduralMotionVectorGeometry } from './renderer-helpers/motion-vector-renderer';
import { syncProceduralCustomWaveObject } from './renderer-helpers/procedural-wave-renderer';
import { getWebGpuHelperMaterialsSync } from './renderer-helpers/webgpu-materials-loader';
import { recordMilkdropWebgpuPipelineError } from './shader-compile-diagnostics';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropPresetPipelineWarmupRequest,
  MilkdropProceduralCustomWaveVisual,
} from './types';

/** Fullscreen quad for the throwaway composite-material compiles. Same
 * construction as the manager's own quad: the pipeline cache key includes
 * the geometry's attribute layout, so a lookalike would warm a different
 * pipeline than the one the live pass submits. */
const FULLSCREEN_QUAD_GEOMETRY = new PlaneGeometry(2, 2);

/** The renderer surface the warm-up drives. */
export type MilkdropPrewarmRenderer = {
  setRenderTarget: (target: RenderTarget | null) => void;
  getRenderTarget?: () => RenderTarget | null;
  compileAsync: (scene: Scene, camera: Camera) => Promise<unknown>;
};

/** Identity snapshot of the composite-state inputs that force a node-graph
 * rebuild — see the matching comparison in feedback-manager-webgpu-tsl.ts.
 * The program payloads and statement arrays are stable per compiled preset,
 * so reference equality is an exact change signal. */
export type MilkdropWebgpuCompositeIdentity = {
  shaderExecution: MilkdropFeedbackCompositeState['shaderExecution'];
  warp: unknown;
  comp: unknown;
  perPixelStatements: unknown;
};

/** Whether a pre-warmed stash was built for exactly the composite state now
 * arriving — the same identity inputs the manager compares on apply,
 * matched in the consuming direction so a stash can only be installed by
 * the state it was warmed for. */
function compositeIdentityMatches(
  identity: MilkdropWebgpuCompositeIdentity,
  state: MilkdropFeedbackCompositeState,
) {
  return (
    identity.shaderExecution === state.shaderExecution &&
    identity.warp === state.shaderPrograms.warp &&
    identity.comp === state.shaderPrograms.comp &&
    identity.perPixelStatements === (state.perPixelPrograms?.statements ?? null)
  );
}

/**
 * How many custom-wave field programs one warm-up will compile pipelines
 * for. The authoring format caps a preset's custom waves at sixteen, so the
 * container of warm objects stays bounded by the format itself; the cap is
 * enforced here rather than trusted, because the request is fed from a
 * compiled descriptor plan, not a validated schema.
 */
const MAX_PREWARM_CUSTOM_WAVE_PROGRAMS = 16;

/** Smallest procedural mesh density: the warm object needs the geometry's
 * attribute layout, not its vertex count, and a 2×2 grid is the cheapest
 * geometry with that layout. */
const MIN_PREWARM_MESH_DENSITY = 2;

/**
 * What the controller needs from its host manager: the render targets the
 * live passes draw into, the camera the source scene last rendered with,
 * and the warp/comp node factories bound to the manager's own uniforms —
 * nodes built against another manager's uniforms would bind its textures,
 * which is corruption, not warm-up.
 */
export type MilkdropWebgpuPrewarmHost = {
  getRenderer(): MilkdropPrewarmRenderer | null;
  getCamera(): Camera;
  getSourceCamera(): Camera | null;
  getWriteTarget(): RenderTarget;
  getSceneTarget(): RenderTarget;
  buildFeedbackBlendNode(
    shaderPlan: MilkdropPresetPipelineWarmupRequest['shaderPlan'],
  ): unknown;
  buildCompositeNode(
    shaderPlan: MilkdropPresetPipelineWarmupRequest['shaderPlan'],
  ): unknown;
};

/** A consumed stash: the graphs to install and the throwaway materials that
 * hold their pipelines' refcounts until the live materials first render. */
export type MilkdropWebgpuConsumedPrewarm = {
  feedbackBlendNode: unknown;
  compositeNode: unknown;
  warmMaterials: NodeMaterial[];
};

export class MilkdropWebgpuPrewarmController {
  /**
   * Pre-warmed swap for the next preset: the incoming warp/comp node graphs
   * plus the throwaway materials whose compileAsync created their pipelines.
   * Single slot by design — a newer warm-up supersedes it, and the manager
   * consumes it on an identity match or discards it.
   */
  private pendingPrewarmSwap: {
    identity: MilkdropWebgpuCompositeIdentity;
    feedbackBlendNode: unknown;
    compositeNode: unknown;
    warmMaterials: NodeMaterial[];
  } | null = null;
  /**
   * Field-material warm objects (procedural mesh, motion vectors, custom
   * waves) from the newest pre-warm, kept alive until the next warm-up or
   * discard: disposing them first would drop the renderer's program
   * refcounts and evict the pipelines they just compiled before the live
   * materials pick them up. Bounded: one object per field program, and the
   * custom-wave programs are capped at MAX_PREWARM_CUSTOM_WAVE_PROGRAMS.
   */
  private prewarmFieldObjects: (Line | LineSegments | Mesh)[] = [];
  /**
   * Generation counter: bumped when a newer warm-up starts, when the manager
   * rebuilds the node graphs itself (a pending stash is then stale), and on
   * discard. A warm-up completing under an old generation discards its own
   * materials instead of stashing them.
   */
  private prewarmGeneration = 0;

  constructor(private readonly host: MilkdropWebgpuPrewarmHost) {}

  /**
   * Pre-warms an incoming preset: builds its warp/comp node graphs through
   * the host's factories, compiles throwaway materials carrying them — plus
   * the per-preset field-material draw objects — through compileAsync
   * against the real feedback render targets, and stashes the built graphs
   * for the manager's first matching applyCompositeState.
   */
  async warmup(request: MilkdropPresetPipelineWarmupRequest): Promise<boolean> {
    const renderer = this.host.getRenderer();
    if (!renderer) {
      return false;
    }
    // Whatever the previous warm-up stashed is moot: the newest switch owns
    // the next transition. This also invalidates any still-compiling older
    // warm-up via the generation bump, so the capture below must come after.
    this.discardPending();
    const generation = this.prewarmGeneration;

    // Deferred a macrotask for the same reason the WebGL manager's warm-up
    // kick is (feedback-manager-shared.ts): this can be reached while a
    // render is still unwinding, and compileAsync's first step compiles the
    // warm scene synchronously, which corrupts in-flight render state.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    if (generation !== this.prewarmGeneration) {
      return false;
    }

    const { shaderPlan, fieldPrograms } = request;
    const identity: MilkdropWebgpuCompositeIdentity = {
      shaderExecution: shaderPlan.shaderExecution,
      warp: shaderPlan.shaderPrograms.warp,
      comp: shaderPlan.shaderPrograms.comp,
      perPixelStatements: shaderPlan.perPixelPrograms?.statements ?? null,
    };

    let feedbackBlendNode: unknown;
    let compositeNode: unknown;
    try {
      feedbackBlendNode = this.host.buildFeedbackBlendNode(shaderPlan);
      compositeNode = this.host.buildCompositeNode(shaderPlan);
    } catch {
      // A program the node builder cannot lower will fail the same way (with
      // real diagnostics) when the apply path builds it; a warm-up failure
      // must not pre-empt that.
      return false;
    }

    const warmBlend = new NodeMaterial();
    warmBlend.outputNode = feedbackBlendNode as typeof warmBlend.outputNode;
    warmBlend.needsUpdate = true;
    const warmComposite = new NodeMaterial();
    warmComposite.outputNode = compositeNode as typeof warmComposite.outputNode;
    warmComposite.needsUpdate = true;

    const fieldObjects = buildPrewarmFieldObjects(fieldPrograms);
    const warmSceneFor = (material: NodeMaterial) => {
      const scene = new Scene();
      scene.matrixAutoUpdate = false;
      scene.add(new Mesh(FULLSCREEN_QUAD_GEOMETRY, material));
      return scene;
    };

    // Compile against the targets the live passes render into: the pipeline
    // cache key covers color format, sample count and depth, so warming
    // against the canvas would compile pipelines the blend never submits.
    // Each feedback material warms on its own scene so a rejection names
    // its program, exactly like the manager's in-blend warm-up.
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    try {
      renderer.setRenderTarget(this.host.getWriteTarget());
      for (const [material, program] of [
        [warmBlend, 'warp'],
        [warmComposite, 'comp'],
      ] as const) {
        try {
          await renderer.compileAsync(
            warmSceneFor(material),
            this.host.getCamera(),
          );
        } catch (error) {
          // Same contract as the in-blend warm-up: record and continue —
          // the stash still installs, and a cold first frame is today's
          // behavior, not a new failure.
          recordMilkdropWebgpuPipelineError(program, error);
        }
      }
      if (fieldObjects.length > 0) {
        renderer.setRenderTarget(this.host.getSceneTarget());
        const warmFieldScene = new Scene();
        warmFieldScene.matrixAutoUpdate = false;
        for (const object of fieldObjects) {
          warmFieldScene.add(object);
        }
        try {
          await renderer.compileAsync(
            warmFieldScene,
            this.host.getSourceCamera() ?? this.host.getCamera(),
          );
        } catch (error) {
          recordMilkdropWebgpuPipelineError('comp', error);
        }
      }
    } finally {
      try {
        renderer.setRenderTarget(previousTarget);
      } catch {
        // The renderer may have been disposed mid-warm-up.
      }
    }

    if (generation !== this.prewarmGeneration) {
      // Superseded while compiling — by a newer switch's warm-up, by the
      // manager rebuilding for another state, or by a discard.
      for (const object of fieldObjects) {
        disposePrewarmFieldObject(object);
      }
      disposeMaterial(warmBlend);
      disposeMaterial(warmComposite);
      return false;
    }

    this.prewarmFieldObjects = fieldObjects;
    this.pendingPrewarmSwap = {
      identity,
      feedbackBlendNode,
      compositeNode,
      warmMaterials: [warmBlend, warmComposite],
    };
    return true;
  }

  /**
   * Takes the stash if it was warmed for exactly this composite state, null
   * otherwise (the caller then rebuilds as it always did, and should
   * `discardPending` so a still-compiling warm-up for another state cannot
   * land a graph nobody will consume).
   */
  consumeFor(
    state: MilkdropFeedbackCompositeState,
  ): MilkdropWebgpuConsumedPrewarm | null {
    const pending = this.pendingPrewarmSwap;
    if (!pending || !compositeIdentityMatches(pending.identity, state)) {
      return null;
    }
    this.pendingPrewarmSwap = null;
    return {
      feedbackBlendNode: pending.feedbackBlendNode,
      compositeNode: pending.compositeNode,
      warmMaterials: pending.warmMaterials,
    };
  }

  /** Drops any pending pre-warm and invalidates in-flight ones. */
  discardPending() {
    this.prewarmGeneration += 1;
    const pending = this.pendingPrewarmSwap;
    this.pendingPrewarmSwap = null;
    if (pending) {
      for (const material of pending.warmMaterials) {
        disposeMaterial(material);
      }
    }
    for (const object of this.prewarmFieldObjects) {
      disposePrewarmFieldObject(object);
    }
    this.prewarmFieldObjects = [];
  }
}

/**
 * Builds throwaway draw objects whose pipelines are byte-identical to the
 * ones the incoming preset's first live frame submits: the same material
 * factories, the same object kinds (three's pipeline cache key includes
 * primitive topology and the geometry's attribute layout) and the same
 * shared geometries the live draw path uses, reached through the very
 * helpers that build the live objects so the two cannot drift apart.
 */
function buildPrewarmFieldObjects(
  fieldPrograms: MilkdropPresetPipelineWarmupRequest['fieldPrograms'],
): (Line | LineSegments | Mesh)[] {
  const objects: (Line | LineSegments | Mesh)[] = [];
  try {
    const helpers = getWebGpuHelperMaterialsSync();
    if (fieldPrograms.mesh) {
      objects.push(
        new LineSegments(
          getProceduralMeshGeometry(MIN_PREWARM_MESH_DENSITY),
          helpers.createProceduralMeshMaterial(fieldPrograms.mesh),
        ),
      );
    }
    if (fieldPrograms.motionVectors) {
      objects.push(
        new LineSegments(
          getProceduralMotionVectorGeometry(1, 1),
          helpers.createProceduralMotionVectorMaterial(
            fieldPrograms.motionVectors,
          ),
        ),
      );
    }
    const wavePrograms = fieldPrograms.customWaves.slice(
      0,
      MAX_PREWARM_CUSTOM_WAVE_PROGRAMS,
    );
    for (const program of wavePrograms) {
      // The synthetic visual carries no frame data — uniform values do not
      // enter the pipeline cache key, only the generated code does, and that
      // comes from the field program. `additive: false` matches the material
      // factory's default blending; a first frame that draws an additive
      // custom wave compiles that one permutation cold, as today.
      const wave: MilkdropProceduralCustomWaveVisual = {
        samples: [0, 0],
        spectrum: false,
        centerX: 0,
        centerY: 0,
        scaling: 1,
        mystery: 0,
        time: 0,
        color: { r: 1, g: 1, b: 1 },
        alpha: 1,
        additive: false,
        thickness: 1,
        fieldProgram: program,
      };
      objects.push(syncProceduralCustomWaveObject(undefined, wave));
    }
  } catch {
    // The WebGPU helper toolkit is registered by the WebGPU adapter graph
    // before any adapter exists to warm through; reaching here without it
    // means this warm-up runs in a bare harness — composite-only is fine.
    return objects;
  }
  return objects;
}

/**
 * Releases one warm field object. The procedural mesh and motion-vector
 * geometries are shared per-density instances (the live path reuses them
 * too, so they must not be disposed); custom-wave objects clone their
 * geometry through the same sync helper the live path uses, so only that
 * one is the object's own to release.
 */
function disposePrewarmFieldObject(object: Line | LineSegments | Mesh) {
  object.removeFromParent();
  if (!isSharedGeometry(object.geometry)) {
    disposeGeometry(object.geometry);
  }
  disposeMaterial(object.material as Material);
}
