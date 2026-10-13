/**
 * Pre-fade pipeline warm-up for the WebGPU feedback manager.
 *
 * `warmupPresetPipelines` is the scheduling half of killing the
 * transition-start spike: it builds the incoming preset's warp/comp node
 * graphs and compiles their (and the per-preset field materials') pipelines
 * BEFORE the fade begins, so the first blended frame installs a cache hit
 * instead of compiling synchronously mid-blend. These tests pin the contract
 * the runtime's warm-up gate depends on:
 *
 * - a warm-up stashes its graphs, and the first applyCompositeState with a
 *   matching identity installs them without compiling anything;
 * - a state that does not match the stash falls back to the in-blend
 *   rebuild path (today's behavior) and discards the stash;
 * - a superseding warm-up (rapid double switch) wins the stash slot and the
 *   superseded one cleans up after itself;
 * - a manager with no renderer yet reports that it could not warm.
 *
 * bun has no GPUDevice, so the renderer is a fake with the surface the
 * manager drives (`setRenderTarget`/`render`/`compileAsync`); the node
 * graphs, materials and render targets are the real ones.
 */
import { describe, expect, test } from 'bun:test';
import { PerspectiveCamera, Scene } from 'three';
import { createMilkdropWebGPUFeedbackManager } from '../../src/js/milkdrop/feedback-manager-webgpu.ts';
// Registers the WebGPU helper-material toolkit at module scope, the same way
// the WebGPU adapter graph does, so the warm-up can build real field
// materials for the per-preset field programs.
import '../../src/js/milkdrop/renderer-backends/webgpu-procedural-materials';
import { buildFeedbackCompositeState } from '../../src/js/milkdrop/renderer-helpers/feedback-composite.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropGpuFieldProgramDescriptor,
  MilkdropPresetPipelineWarmupRequest,
  MilkdropRenderPayload,
  MilkdropShaderProgramPayload,
} from '../../src/js/milkdrop/types.ts';

type CompileCount = { count: number };

function createFakeRenderer() {
  const compiles: CompileCount = { count: 0 };
  const setRenderTargetCalls: unknown[] = [];
  const renderer = {
    setRenderTarget: (target: unknown) => {
      setRenderTargetCalls.push(target);
    },
    getRenderTarget: () => null,
    render: () => {},
    compileAsync: async () => {
      compiles.count += 1;
    },
  };
  return {
    renderer,
    compiles,
    setRenderTargetCalls,
  };
}

/** A minimal direct-execution shader program payload, as the compiler emits
 * for a warp shader body. Identity is by reference, so the same instance
 * must reach both the warm-up request and the applied composite state. */
function createShaderProgram(
  stage: 'warp' | 'comp',
  offset: number,
): MilkdropShaderProgramPayload {
  return {
    stage,
    source: `ret = ret + float3(${offset})`,
    normalizedLines: [`ret = ret + float3(${offset})`],
    statements: [
      {
        target: 'ret',
        operator: '=',
        rawValue: `ret + float3(${offset})`,
        expression: {
          type: 'binary',
          operator: '+',
          left: { type: 'identifier', name: 'ret' },
          right: {
            type: 'call',
            name: 'float3',
            args: [
              { type: 'literal', value: offset },
              { type: 'literal', value: 0 },
              { type: 'literal', value: 0 },
            ],
          },
        },
        source: `ret = ret + float3(${offset})`,
      },
    ],
    execution: {
      kind: 'direct-feedback-program',
      stage,
      entryTarget: 'ret',
      supportedBackends: ['webgpu'],
      requiresControlFallback: true,
      statementTargets: ['ret'],
    },
  } as unknown as MilkdropShaderProgramPayload;
}

function createFieldProgram(
  signature: string,
): MilkdropGpuFieldProgramDescriptor {
  return {
    kind: 'gpu-field-program',
    statements: [],
    temporaries: [],
    registerInputs: [],
    signature,
  };
}

function createWarmupRequest({
  warp,
  comp,
  meshProgram,
}: {
  warp: MilkdropShaderProgramPayload | null;
  comp: MilkdropShaderProgramPayload | null;
  meshProgram?: MilkdropGpuFieldProgramDescriptor | null;
}): MilkdropPresetPipelineWarmupRequest {
  return {
    shaderPlan: {
      shaderExecution: 'direct',
      shaderPrograms: { warp, comp },
      perPixelPrograms: null,
    },
    fieldPrograms: {
      mesh: meshProgram ?? null,
      motionVectors: null,
      customWaves: [],
    },
  };
}

function createCompositeState(
  warp: MilkdropShaderProgramPayload | null,
  comp: MilkdropShaderProgramPayload | null,
): MilkdropFeedbackCompositeState {
  const frameState = {
    post: {
      shaderEnabled: true,
      shaderControls: {
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
          volumeSliceZ: 0,
        },
      },
      shaderPrograms: { warp, comp },
      videoEchoEnabled: false,
      videoEchoAlpha: 0,
      videoEchoZoom: 1,
      videoEchoOrientation: 0,
      brighten: false,
      darken: false,
      darkenCenter: false,
      solarize: false,
      invert: false,
      gammaAdj: 1,
      textureWrap: false,
      feedbackTexture: false,
      warp: 0,
      decay: 0.97,
    },
    variables: {},
    signals: {
      bass: 0.2,
      beat: 0,
      beatPulse: 0,
      frame: 1,
      fps: 60,
      mid: 0.2,
      mids: 0.2,
      rms: 0.2,
      treble: 0.2,
      bassAtt: 0.2,
      midAtt: 0.2,
      midsAtt: 0.2,
      trebleAtt: 0.2,
      vol: 0.2,
      music: 0.2,
      weightedEnergy: 0.2,
      time: 1,
    },
  } as unknown as MilkdropRenderPayload['frameState'];

  return buildFeedbackCompositeState({
    frameState,
    backend: 'webgpu',
    directFeedbackShaders: true,
    webgpuFeedbackPlanShaderExecution: 'direct',
    getShaderTextureSourceId: () => 0,
    getShaderTextureBlendModeId: () => 0,
    getShaderSampleDimensionId: () => 0,
  });
}

/** Lets pending warm-up promise chains (the void-kicked in-blend rebuild,
 * deferred macrotask kicks) run to completion. */
const drainAsyncWork = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

async function createRenderedManager() {
  const manager = createMilkdropWebGPUFeedbackManager(64, 64);
  const fake = createFakeRenderer();
  // One real render pass registers the renderer (and source camera) the
  // warm-up compiles through, exactly as a live frame does.
  manager.render(fake.renderer, new Scene(), new PerspectiveCamera());
  return { manager, fake };
}

describe('webgpu feedback manager: pre-fade pipeline warm-up', () => {
  test('a manager without a renderer yet cannot warm and says so', async () => {
    const manager = createMilkdropWebGPUFeedbackManager(64, 64);
    const result = await manager.warmupPresetPipelines(
      createWarmupRequest({ warp: null, comp: null }),
    );
    expect(result).toBe(false);
    manager.dispose();
  });

  test('stashed graphs install on a matching apply without compiling', async () => {
    const { manager, fake } = await createRenderedManager();
    try {
      const warp = createShaderProgram('warp', 0.1);
      const comp = createShaderProgram('comp', 0.2);
      const warmed = await manager.warmupPresetPipelines(
        createWarmupRequest({ warp, comp }),
      );
      expect(warmed).toBe(true);
      expect(fake.compiles.count).toBeGreaterThan(0);

      // The stash is consumed by the first apply whose identity matches:
      // installing pre-built graphs must not schedule any compilation.
      fake.compiles.count = 0;
      const state = createCompositeState(warp, comp);
      manager.applyCompositeState(state);
      await drainAsyncWork();
      expect(fake.compiles.count).toBe(0);
    } finally {
      manager.dispose();
    }
  });

  test('a non-matching apply falls back to the in-blend rebuild and drops the stash', async () => {
    const { manager, fake } = await createRenderedManager();
    try {
      const warpA = createShaderProgram('warp', 0.1);
      const compA = createShaderProgram('comp', 0.1);
      await manager.warmupPresetPipelines(
        createWarmupRequest({ warp: warpA, comp: compA }),
      );

      // A different preset lands (deadline expiry, double switch): its
      // state does not match the stash, so the apply takes today's path —
      // rebuild, then the void-kicked async warm-up.
      const warpB = createShaderProgram('warp', 0.3);
      const compB = createShaderProgram('comp', 0.4);
      fake.compiles.count = 0;
      manager.applyCompositeState(createCompositeState(warpB, compB));
      await drainAsyncWork();
      expect(fake.compiles.count).toBeGreaterThan(0);

      // The stale stash is gone: even A's identity now rebuilds.
      fake.compiles.count = 0;
      manager.applyCompositeState(createCompositeState(warpA, compA));
      await drainAsyncWork();
      expect(fake.compiles.count).toBeGreaterThan(0);
    } finally {
      manager.dispose();
    }
  });

  test('a superseding warm-up wins the stash and the loser cleans up', async () => {
    const { manager, fake } = await createRenderedManager();
    try {
      const warpA = createShaderProgram('warp', 0.1);
      const compA = createShaderProgram('comp', 0.1);
      const warpB = createShaderProgram('warp', 0.5);
      const compB = createShaderProgram('comp', 0.6);

      // Warm-up A is still compiling when warm-up B starts (a rapid second
      // switch during the first one's window).
      let releaseA: () => void = () => {};
      const gateA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      const originalCompile = fake.renderer.compileAsync;
      fake.renderer.compileAsync = async () => {
        await gateA;
        fake.compiles.count += 1;
      };
      const warmA = manager.warmupPresetPipelines(
        createWarmupRequest({ warp: warpA, comp: compA }),
      );
      await drainAsyncWork();
      fake.renderer.compileAsync = originalCompile;

      const warmedB = await manager.warmupPresetPipelines(
        createWarmupRequest({ warp: warpB, comp: compB }),
      );
      releaseA();
      expect(await warmA).toBe(false);
      expect(warmedB).toBe(true);

      // B owns the transition: its apply installs from the stash; A's
      // identity rebuilds because A's stash was discarded.
      fake.compiles.count = 0;
      manager.applyCompositeState(createCompositeState(warpB, compB));
      await drainAsyncWork();
      expect(fake.compiles.count).toBe(0);

      fake.compiles.count = 0;
      manager.applyCompositeState(createCompositeState(warpA, compA));
      await drainAsyncWork();
      expect(fake.compiles.count).toBeGreaterThan(0);
    } finally {
      manager.dispose();
    }
  });

  test('field-material warm objects are compiled and released with the manager', async () => {
    const { manager, fake } = await createRenderedManager();
    try {
      const meshProgram = createFieldProgram('prewarm-test-mesh');
      const beforeCompiles = fake.compiles.count;
      const warmed = await manager.warmupPresetPipelines(
        createWarmupRequest({
          warp: null,
          comp: null,
          meshProgram,
        }),
      );
      expect(warmed).toBe(true);
      // Two composite-material compiles plus the field-material scene.
      expect(fake.compiles.count - beforeCompiles).toBe(3);
    } finally {
      manager.dispose();
    }
  });

  test('a stash install supersedes an older in-flight in-blend swap', async () => {
    const { manager, fake } = await createRenderedManager();
    try {
      // Per-call compileAsync control: the first call (the in-blend swap of
      // a previous switch) is held; later calls (this switch's pre-warm)
      // resolve.
      const held: Array<() => void> = [];
      let compileIndex = 0;
      let warmupStart = Number.POSITIVE_INFINITY;
      fake.renderer.compileAsync = async () =>
        new Promise<void>((resolve) => {
          compileIndex += 1;
          if (compileIndex <= warmupStart) {
            held.push(resolve);
          } else {
            resolve();
          }
        });

      // A previous preset's apply kicks the in-blend async swap, which
      // parks on its first compileAsync.
      const warpOld = createShaderProgram('warp', 0.9);
      const compOld = createShaderProgram('comp', 0.9);
      manager.applyCompositeState(createCompositeState(warpOld, compOld));
      await drainAsyncWork();
      expect(held.length).toBeGreaterThan(0);
      // Everything from here on resolves immediately (the pre-warm's
      // compiles), and the held swap's turn comes last.
      warmupStart = compileIndex;

      // The next switch pre-warms its own shaders and installs from the
      // stash while the old swap is still parked.
      const warpNext = createShaderProgram('warp', 0.1);
      const compNext = createShaderProgram('comp', 0.2);
      await manager.warmupPresetPipelines(
        createWarmupRequest({ warp: warpNext, comp: compNext }),
      );
      manager.applyCompositeState(createCompositeState(warpNext, compNext));
      const installedNode = manager.feedbackBlendMaterial.outputNode;

      // The parked swap from the previous preset finishes: it must find
      // itself superseded and leave the stash's graphs alone.
      for (const release of held) {
        release();
      }
      await drainAsyncWork();
      expect(manager.feedbackBlendMaterial.outputNode).toBe(installedNode);
    } finally {
      manager.dispose();
    }
  });
});
