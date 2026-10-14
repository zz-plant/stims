import { afterEach, describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { resolveShaderExecutionMode } from 'milkdrop-toolchain/src/shader-execution-mode.ts';
import { OrthographicCamera, Scene, type Vector2 } from 'three';
import { createMilkdropRendererAdapterCore } from '../../src/js/milkdrop/renderer-adapter.ts';
import { createMilkdropRendererAdapter } from '../../src/js/milkdrop/renderer-adapter-factory.ts';
import type { MilkdropFeedbackManager } from '../../src/js/milkdrop/types.ts';
import { defaultSignalEnv } from '../../src/js/milkdrop/vm/frame-generation.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';
import {
  resolveMilkdropWebGpuOptimizationFlags,
  resolveMilkdropWebGpuOptimizationFlagsForBackend,
} from '../../src/js/milkdrop/webgpu-optimization-flags.ts';
import {
  setWebGpuForceMode,
  type WebGpuForceMode,
} from '../../src/js/milkdrop/webgpu-query-override.ts';
import { replaceProperty } from '../test-helpers.ts';

// The compiler marks this comp shader 'direct' on WebGPU: no video echo or
// feedback texture holds the plan on the controls approximation.
const DIRECT_COMP_SOURCE = `
title=Applied Shader Execution
fShader=1
comp_shader=ret = tex2D(sampler_main, uv).rgb * 1.2;
`.trim();

const compileDirectPreset = (id: string) =>
  compileMilkdropPresetSource(DIRECT_COMP_SOURCE, { id });

const fakeRenderer = () => ({
  isWebGPURenderer: true,
  depth: true,
  getSize: (target: Vector2) => target.set(320, 180),
  setRenderTarget() {},
  render() {},
});

describe('applied shader execution on the native WebGPU adapter', () => {
  // The first test pays the cold three/webgpu import behind the native
  // adapter, which can outlast bun's 5 s default on a loaded host.
  const NATIVE_ADAPTER_TIMEOUT_MS = 30_000;

  afterEach(() => {
    setWebGpuForceMode('auto');
  });

  /** One frame through the adapter the runtime would build for this URL. */
  async function renderOneFrame(search: string, forceMode: WebGpuForceMode) {
    const restoreLocation = replaceProperty(
      globalThis,
      'location',
      new URL(`http://localhost/${search}`),
    );
    setWebGpuForceMode(forceMode);
    try {
      const preset = compileDirectPreset(`applied-${forceMode}`);
      const adapter = await createMilkdropRendererAdapter({
        scene: new Scene(),
        camera: new OrthographicCamera(-1, 1, 1, -1, 0, 10),
        renderer: fakeRenderer(),
        backend: 'webgpu',
        preset,
        webgpuOptimizationFlags:
          resolveMilkdropWebGpuOptimizationFlagsForBackend(
            resolveMilkdropWebGpuOptimizationFlags(),
            'webgpu',
          ),
      });
      adapter.attach();
      const beforeFrame = adapter.getAppliedShaderExecution?.();
      adapter.render({
        frameState: createMilkdropVM(preset).step(defaultSignalEnv()),
        blendState: null,
      });
      const afterFrame = adapter.getAppliedShaderExecution?.();
      adapter.dispose();
      return {
        verdict: resolveShaderExecutionMode(preset, 'webgpu'),
        beforeFrame,
        afterFrame,
      };
    } finally {
      restoreLocation();
    }
  }

  test(
    'reports direct when the authored shader runs',
    async () => {
      const result = await renderOneFrame('?renderer=webgpu', 'full');

      expect(result.verdict).toBe('direct');
      expect(result.beforeFrame).toBeNull();
      expect(result.afterFrame).toBe('direct');
    },
    NATIVE_ADAPTER_TIMEOUT_MS,
  );

  test(
    'reports the controls approximation that ?milkdrop-webgpu-feedback=0 substitutes',
    async () => {
      const result = await renderOneFrame(
        '?renderer=webgpu&milkdrop-webgpu-feedback=0',
        'full',
      );

      // The compiler's verdict cannot see the flag; the applied mode can.
      expect(result.verdict).toBe('direct');
      expect(result.afterFrame).toBe('controls');
    },
    NATIVE_ADAPTER_TIMEOUT_MS,
  );

  test(
    'reports off on the safe path, which runs no feedback pass',
    async () => {
      const result = await renderOneFrame('?renderer=webgpu', 'safe');

      expect(result.verdict).toBe('direct');
      expect(result.afterFrame).toBe('off');
    },
    NATIVE_ADAPTER_TIMEOUT_MS,
  );
});

describe('applied shader execution across a preset change', () => {
  function createAdapterWithFeedback(swap: { pending: boolean }) {
    const feedback = {
      applyCompositeState() {},
      render: () => true,
      swap() {},
      resize() {},
      dispose() {},
      isDirectShaderSwapPending: () => swap.pending,
    } as MilkdropFeedbackManager;
    return createMilkdropRendererAdapterCore({
      scene: new Scene(),
      camera: new OrthographicCamera(-1, 1, 1, -1, 0, 10),
      renderer: fakeRenderer(),
      backend: 'webgl',
      createFeedbackManager: () => feedback,
    });
  }

  const renderFrame = (
    adapter: ReturnType<typeof createAdapterWithFeedback>,
    preset: ReturnType<typeof compileDirectPreset>,
  ) =>
    adapter.render({
      frameState: createMilkdropVM(preset).step(defaultSignalEnv()),
      blendState: null,
    });

  test('forgets the outgoing preset until the incoming one presents a frame', () => {
    const adapter = createAdapterWithFeedback({ pending: false });
    const first = compileDirectPreset('applied-first');
    adapter.setPreset(first);
    renderFrame(adapter, first);
    expect(adapter.getAppliedShaderExecution()).toBe('direct');

    // No shader text, but fShader keeps the feedback pass running.
    const second = compileMilkdropPresetSource(
      'title=No Shader Text\nfShader=1',
      { id: 'applied-second' },
    );
    adapter.setPreset(second);
    expect(adapter.getAppliedShaderExecution()).toBeNull();

    renderFrame(adapter, second);
    expect(adapter.getAppliedShaderExecution()).toBe('controls');
  });

  test("reports nothing while the preset's own programs are still compiling", () => {
    const swap = { pending: true };
    const adapter = createAdapterWithFeedback(swap);
    const preset = compileDirectPreset('applied-pending');
    adapter.setPreset(preset);
    renderFrame(adapter, preset);

    // The frame went out on the pass-through pair, not the comp shader.
    expect(adapter.getAppliedShaderExecution()).toBeNull();

    swap.pending = false;
    expect(adapter.getAppliedShaderExecution()).toBe('direct');
  });
});
