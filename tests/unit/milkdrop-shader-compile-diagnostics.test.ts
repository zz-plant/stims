/**
 * Structured shader compile diagnostics — the engine-side record of a GPU
 * program that failed to build, with the backend, the MilkDrop program
 * label, the failing stage, and the driver message.
 *
 * bun's test environment has no WebGL context, so the WebGL path is driven
 * exactly the way three drives it: a deliberately broken shader program is
 * assembled with the real feedback-manager assembler, handed to the
 * installed onShaderError hook with a fake GL that reports the driver's
 * answer (compile status + info log + shader source), and the recorded
 * diagnostic is asserted through the real renderer adapter. The WebGPU
 * path cannot be exercised here for real — observing a WGSL pipeline
 * failure needs a live GPUDevice — so its recording helper and the
 * warm-up's per-material attribution are covered by the shared helpers and
 * documented in shader-compile-diagnostics.ts.
 */
import { describe, expect, test } from 'bun:test';
import { OrthographicCamera, Scene, type Vector2 } from 'three';
import { assembleMilkdropDirectFragmentShaders } from '../../src/js/milkdrop/feedback-manager-shared.ts';
import { createMilkdropRendererAdapterCore } from '../../src/js/milkdrop/renderer-adapter.ts';
import {
  clearMilkdropShaderCompileDiagnostics,
  describeMilkdropShaderProgramFromFragmentGlsl,
  getMilkdropShaderCompileDiagnostics,
  installMilkdropWebglShaderErrorTracking,
  MAX_SHADER_COMPILE_DIAGNOSTICS,
  type MilkdropWebglShaderErrorContext,
  recordMilkdropWebgpuPipelineError,
} from '../../src/js/milkdrop/shader-compile-diagnostics.ts';
import type { MilkdropFeedbackManager } from '../../src/js/milkdrop/types.ts';

/**
 * A fake GL standing in for the driver: three's onShaderError hook is
 * called with the GL context and the program/shader handles; a real driver
 * answers getShaderParameter / getShaderInfoLog / getShaderSource from
 * them, and this fake reports a compile answer the test chooses. Shader
 * handles are tagged strings so the fake can tell them apart.
 */
function createFakeGl({
  fragmentSource,
  fragmentLog = '',
  vertexLog = '',
  programLog = '',
  fragmentCompiles = false,
  vertexCompiles = true,
}: {
  fragmentSource: string;
  fragmentLog?: string;
  vertexLog?: string;
  programLog?: string;
  fragmentCompiles?: boolean;
  vertexCompiles?: boolean;
}): MilkdropWebglShaderErrorContext {
  const COMPILE_STATUS = 35714;
  const isFragment = (shader: unknown) => shader === 'fragment';
  return {
    COMPILE_STATUS,
    getShaderInfoLog: (shader: unknown) =>
      (isFragment(shader) ? fragmentLog : vertexLog) ?? '',
    getProgramInfoLog: () => programLog ?? '',
    getShaderParameter: (shader: unknown) =>
      isFragment(shader) ? fragmentCompiles : vertexCompiles,
    getShaderSource: (shader: unknown) =>
      isFragment(shader) ? fragmentSource : '',
  };
}

function fireShaderError(
  renderer: { debug: { onShaderError?: unknown } },
  gl: MilkdropWebglShaderErrorContext,
) {
  (
    renderer.debug.onShaderError as (
      gl: never,
      program: never,
      vs: never,
      fs: never,
    ) => void
  )(gl as never, 'program' as never, 'vertex' as never, 'fragment' as never);
}

/** A renderer whose debug surface matches three's WebGLRenderer shape. */
function createTrackedRenderer(previous?: (...args: unknown[]) => void) {
  const renderer = {
    debug: {
      onShaderError: previous
        ? (gl: unknown, program: unknown, vs: unknown, fs: unknown) =>
            previous(gl, program, vs, fs)
        : undefined,
    },
  };
  installMilkdropWebglShaderErrorTracking(renderer);
  return renderer;
}

describe('shader compile diagnostics: WebGL recording', () => {
  test('a broken warp fragment records with the warp program label', () => {
    clearMilkdropShaderCompileDiagnostics();
    const { warp: brokenWarpFragment } = assembleMilkdropDirectFragmentShaders(
      'ret = this_identifier_does_not_exist;',
      null,
    );
    const previousCalls: unknown[][] = [];
    const renderer = createTrackedRenderer((...args) =>
      previousCalls.push(args),
    );

    fireShaderError(
      renderer,
      createFakeGl({
        fragmentSource: brokenWarpFragment,
        fragmentLog:
          "ERROR: 0:1: 'this_identifier_does_not_exist' : undeclared identifier",
        fragmentCompiles: false,
      }),
    );

    const [recorded] = getMilkdropShaderCompileDiagnostics('webgl');
    expect(recorded).toBeDefined();
    expect(recorded?.backend).toBe('webgl');
    expect(recorded?.program).toBe('warp');
    expect(recorded?.stage).toBe('fragment');
    expect(recorded?.message).toContain('undeclared identifier');

    // The hook composes: core's console.error listener still runs.
    expect(previousCalls.length).toBe(1);
  });

  test('a broken comp fragment records with the comp program label', () => {
    clearMilkdropShaderCompileDiagnostics();
    const { composite: brokenCompFragment } =
      assembleMilkdropDirectFragmentShaders(
        null,
        'ret = also_not_declared_anywhere(uv);',
      );
    const renderer = createTrackedRenderer();

    fireShaderError(
      renderer,
      createFakeGl({
        fragmentSource: brokenCompFragment,
        fragmentLog: 'ERROR: 0:1: called function is not defined',
        fragmentCompiles: false,
      }),
    );

    const [recorded] = getMilkdropShaderCompileDiagnostics('webgl');
    expect(recorded?.program).toBe('comp');
    expect(recorded?.stage).toBe('fragment');
  });

  test('a link failure with clean stages records the program stage', () => {
    clearMilkdropShaderCompileDiagnostics();
    const { warp: warpFragment } = assembleMilkdropDirectFragmentShaders(
      'ret = uv;',
      null,
    );
    const renderer = createTrackedRenderer();

    fireShaderError(
      renderer,
      createFakeGl({
        fragmentSource: warpFragment,
        fragmentCompiles: true,
        programLog: 'Fragment shader(s) failed to link.',
      }),
    );

    const [recorded] = getMilkdropShaderCompileDiagnostics('webgl');
    expect(recorded?.program).toBe('warp');
    expect(recorded?.stage).toBe('program');
    expect(recorded?.message).toBe('Fragment shader(s) failed to link.');
  });

  test('a failing shader outside the feedback chain records as unknown', () => {
    clearMilkdropShaderCompileDiagnostics();
    const renderer = createTrackedRenderer();
    fireShaderError(
      renderer,
      createFakeGl({
        fragmentSource: 'void main() { gl_FragColor = vec4(0.0); }',
        fragmentLog: 'some other material failure',
        fragmentCompiles: false,
      }),
    );
    const [recorded] = getMilkdropShaderCompileDiagnostics('webgl');
    expect(recorded?.program).toBe('unknown');
  });

  test('installing twice on the same renderer does not double-fire the chain', () => {
    clearMilkdropShaderCompileDiagnostics();
    const previousCalls: unknown[][] = [];
    const renderer = {
      debug: {
        onShaderError: (...args: unknown[]) => {
          previousCalls.push(args);
        },
      },
    };
    installMilkdropWebglShaderErrorTracking(renderer);
    installMilkdropWebglShaderErrorTracking(renderer);

    const { warp: warpFragment } = assembleMilkdropDirectFragmentShaders(
      'ret = uv;',
      null,
    );
    fireShaderError(
      renderer as { debug: { onShaderError?: unknown } },
      createFakeGl({ fragmentSource: warpFragment, fragmentCompiles: true }),
    );

    expect(previousCalls.length).toBe(1);
    expect(getMilkdropShaderCompileDiagnostics('webgl')).toHaveLength(1);
  });

  test('an identical failure repeated back-to-back records once', () => {
    clearMilkdropShaderCompileDiagnostics();
    const { warp: warpFragment } = assembleMilkdropDirectFragmentShaders(
      'ret = still_not_declared;',
      null,
    );
    const renderer = createTrackedRenderer();
    const gl = createFakeGl({
      fragmentSource: warpFragment,
      fragmentLog: 'same failure',
      fragmentCompiles: false,
    });
    fireShaderError(renderer, gl);
    fireShaderError(renderer, gl);
    expect(getMilkdropShaderCompileDiagnostics('webgl')).toHaveLength(1);
  });

  test('the registry keeps only the most recent records', () => {
    clearMilkdropShaderCompileDiagnostics();
    for (let i = 0; i < MAX_SHADER_COMPILE_DIAGNOSTICS + 5; i += 1) {
      fireShaderError(
        createTrackedRenderer(),
        createFakeGl({
          fragmentSource: `void main() { /* variant ${i} */ }`,
          fragmentLog: `failure ${i}`,
          fragmentCompiles: false,
        }),
      );
    }
    const recorded = getMilkdropShaderCompileDiagnostics('webgl');
    expect(recorded).toHaveLength(MAX_SHADER_COMPILE_DIAGNOSTICS);
    expect(recorded.at(-1)?.message).toBe(
      `failure ${MAX_SHADER_COMPILE_DIAGNOSTICS + 4}`,
    );
  });
});

describe('shader compile diagnostics: program attribution', () => {
  test('the stage templates attribute to warp and comp respectively', () => {
    const { warp, composite } = assembleMilkdropDirectFragmentShaders(
      'ret = uv;',
      'ret = uv;',
    );
    expect(describeMilkdropShaderProgramFromFragmentGlsl(warp)).toBe('warp');
    expect(describeMilkdropShaderProgramFromFragmentGlsl(composite)).toBe(
      'comp',
    );
    expect(
      describeMilkdropShaderProgramFromFragmentGlsl('uniform float x;'),
    ).toBe('unknown');
  });
});

describe('shader compile diagnostics: WebGPU recording', () => {
  test('a pipeline warm-up rejection records its program', () => {
    clearMilkdropShaderCompileDiagnostics();
    recordMilkdropWebgpuPipelineError(
      'warp',
      new Error('pipeline build failed'),
    );
    recordMilkdropWebgpuPipelineError('comp', 'wgsl validation error');
    const recorded = getMilkdropShaderCompileDiagnostics('webgpu');
    expect(recorded).toEqual([
      expect.objectContaining({
        backend: 'webgpu',
        program: 'warp',
        stage: 'pipeline',
        message: 'pipeline build failed',
      }),
      expect.objectContaining({
        backend: 'webgpu',
        program: 'comp',
        stage: 'pipeline',
        message: 'wgsl validation error',
      }),
    ]);
  });
});

describe('shader compile diagnostics: adapter exposure', () => {
  test('the WebGL adapter surfaces webgl records only', () => {
    clearMilkdropShaderCompileDiagnostics();
    const adapter = createMilkdropRendererAdapterCore({
      scene: new Scene(),
      camera: new OrthographicCamera(-1, 1, 1, -1, 0, 10),
      renderer: {
        getSize: (target: Vector2) => target.set(320, 180),
        render() {},
        setRenderTarget() {},
      },
      backend: 'webgl',
      createFeedbackManager: () =>
        ({
          swap() {},
          resize() {},
          dispose() {},
        }) as unknown as MilkdropFeedbackManager,
    });

    expect(adapter.getShaderCompileDiagnostics?.()).toEqual([]);
    recordMilkdropWebgpuPipelineError('comp', 'gpu side failure');
    expect(adapter.getShaderCompileDiagnostics?.()).toEqual([]);

    const { warp: brokenWarpFragment } = assembleMilkdropDirectFragmentShaders(
      'ret = nope;',
      null,
    );
    fireShaderError(
      createTrackedRenderer(),
      createFakeGl({
        fragmentSource: brokenWarpFragment,
        fragmentLog: 'warp broke',
        fragmentCompiles: false,
      }),
    );

    const exposed = adapter.getShaderCompileDiagnostics?.() ?? [];
    expect(exposed).toHaveLength(1);
    expect(exposed[0]).toEqual(
      expect.objectContaining({
        backend: 'webgl',
        program: 'warp',
        stage: 'fragment',
        message: 'warp broke',
      }),
    );
    adapter.dispose();
  });
});
