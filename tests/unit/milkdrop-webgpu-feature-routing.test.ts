import { afterEach, describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { OrthographicCamera, Scene, type Vector2 } from 'three';
import { createMilkdropRendererAdapter } from '../../src/js/milkdrop/renderer-adapter-factory.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
} from '../../src/js/milkdrop/types.ts';
import { defaultSignalEnv } from '../../src/js/milkdrop/vm/frame-generation.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';
import {
  resolveMilkdropWebGpuOptimizationFlags,
  resolveMilkdropWebGpuOptimizationFlagsForBackend,
} from '../../src/js/milkdrop/webgpu-optimization-flags.ts';
import {
  resolveMilkdropWebGpuFeatureRouting,
  setWebGpuForceMode,
  shouldEnableNativeMilkdropWebGpuFeedback,
} from '../../src/js/milkdrop/webgpu-query-override.ts';
import { replaceProperty } from '../test-helpers.ts';

describe('MilkDrop WebGPU feature routing', () => {
  afterEach(() => {
    setWebGpuForceMode('auto');
  });

  test('disables feature-level routes in safe mode instead of using one opaque switch', () => {
    setWebGpuForceMode('safe');

    const routing = resolveMilkdropWebGpuFeatureRouting({ search: '' });

    expect(routing.proceduralMainWave).toMatchObject({ enabled: false });
    expect(routing.directFeedbackShaders.reason).toContain('safe path');
    expect(routing.renderBundles.enabled).toBe(false);
  });

  test('keeps render bundles opt-in even when full WebGPU is forced by URL', () => {
    const routing = resolveMilkdropWebGpuFeatureRouting({
      search: '?renderer=webgpu&corpus=certification',
    });

    expect(routing.proceduralMesh.enabled).toBe(true);
    expect(routing.directFeedbackShaders).toMatchObject({
      enabled: true,
      reason: null,
    });
    expect(routing.renderBundles).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('render bundles remain opt-in'),
    });
  });

  test('enables render bundles only through the render-bundles rollout flag', () => {
    const routing = resolveMilkdropWebGpuFeatureRouting({
      search: '?renderer=webgpu&milkdrop-webgpu-render-bundles=1',
    });

    expect(routing.renderBundles).toEqual({
      enabled: true,
      reason: null,
    });
  });

  test('keeps URL opt-ins when the runtime routes flags for WebGPU', () => {
    const restoreLocation = replaceProperty(
      globalThis,
      'location',
      new URL(
        'http://localhost/?renderer=webgpu&milkdrop-webgpu-compute-vm=1&milkdrop-webgpu-render-bundles=1',
      ),
    );
    try {
      // The live path: no location argument anywhere, as in
      // experience-attachment.ts and renderer-adapter-webgpu.ts.
      const flags = resolveMilkdropWebGpuOptimizationFlagsForBackend(
        resolveMilkdropWebGpuOptimizationFlags(),
        'webgpu',
      );

      expect(flags.gpuComputeVM).toBe(true);
      expect(flags.renderBundles).toBe(true);
    } finally {
      restoreLocation();
    }
  });

  test('enables native feedback on the full WebGPU path', () => {
    const routing = resolveMilkdropWebGpuFeatureRouting({
      search: '?renderer=webgpu',
    });

    expect(routing.directFeedbackShaders).toEqual({
      enabled: true,
      reason: null,
    });
  });

  test('enables native feedback for full-path sessions but not the safe path', () => {
    setWebGpuForceMode('full');
    expect(
      shouldEnableNativeMilkdropWebGpuFeedback({
        search: '?renderer=webgpu&corpus=certification',
      }),
    ).toBe(true);
    expect(shouldEnableNativeMilkdropWebGpuFeedback({ search: '' })).toBe(true);

    setWebGpuForceMode('safe');
    expect(
      shouldEnableNativeMilkdropWebGpuFeedback({ search: '?renderer=webgpu' }),
    ).toBe(false);
  });

  test('keeps WebGPU sessions off the preemptive WebGL fallback by default', () => {
    expect(
      resolveMilkdropWebGpuOptimizationFlags({
        location: { search: '?renderer=webgpu&corpus=certification' },
        storage: { getItem: () => null },
      }).descriptorFallbackToWebgl,
    ).toBe(false);
    expect(
      resolveMilkdropWebGpuOptimizationFlags({
        location: { search: '?renderer=webgpu' },
        storage: { getItem: () => null },
      }).descriptorFallbackToWebgl,
    ).toBe(false);
    // An explicit opt-in still routes feedback presets to WebGL.
    expect(
      resolveMilkdropWebGpuOptimizationFlags({
        location: { search: '?milkdrop-webgpu-fallback=1' },
        storage: { getItem: () => null },
      }).descriptorFallbackToWebgl,
    ).toBe(true);
  });
});

describe('native WebGPU feedback flag override', () => {
  // Run alone (-t), the first test pays the cold three/webgpu import behind
  // the native adapter, which outlasts bun's 5 s default on a loaded host.
  const NATIVE_ADAPTER_TIMEOUT_MS = 30_000;

  // A comp shader the WebGPU executor runs as authored, with no video echo or
  // feedback texture that would hold the plan on the controls approximation.
  const directCompSource = `
title=Native Feedback Override
fShader=1
comp_shader=ret = tex2D(sampler_main, uv).rgb * 1.2;
  `.trim();

  async function renderNativeFeedbackState(search: string) {
    const restoreLocation = replaceProperty(
      globalThis,
      'location',
      new URL(`http://localhost/${search}`),
    );
    setWebGpuForceMode('full');
    try {
      const preset = compileMilkdropPresetSource(directCompSource, {
        id: 'native-feedback-override',
      });
      // The flags the runtime builds: URL/storage first, then routed for the
      // backend the renderer came up on (experience-attachment.ts).
      const flags = resolveMilkdropWebGpuOptimizationFlagsForBackend(
        resolveMilkdropWebGpuOptimizationFlags(),
        'webgpu',
      );
      const adapter = await createMilkdropRendererAdapter({
        scene: new Scene(),
        camera: new OrthographicCamera(-1, 1, 1, -1, 0, 10),
        renderer: {
          isWebGPURenderer: true,
          depth: true,
          getSize: (target: Vector2) => target.set(320, 180),
          setRenderTarget() {},
          render() {},
        },
        backend: 'webgpu',
        preset,
        webgpuOptimizationFlags: flags,
      });
      const feedback = (
        adapter as unknown as { feedback: MilkdropFeedbackManager | null }
      ).feedback;
      if (!feedback) {
        throw new Error('native WebGPU adapter built no feedback manager');
      }
      const applied: MilkdropFeedbackCompositeState[] = [];
      const applyCompositeState = feedback.applyCompositeState.bind(feedback);
      feedback.applyCompositeState = (state) => {
        applied.push(state);
        applyCompositeState(state);
      };

      adapter.attach();
      adapter.render({
        frameState: createMilkdropVM(preset).step(defaultSignalEnv()),
        blendState: null,
      });
      adapter.dispose();
      return applied.at(-1) ?? null;
    } finally {
      setWebGpuForceMode('auto');
      restoreLocation();
    }
  }

  test(
    'runs the comp shader directly by default on the full path',
    async () => {
      const state = await renderNativeFeedbackState('?renderer=webgpu');

      expect(state?.shaderExecution).toBe('direct');
      expect(state?.shaderPrograms.comp).not.toBeNull();
    },
    NATIVE_ADAPTER_TIMEOUT_MS,
  );

  test(
    '?milkdrop-webgpu-feedback=0 drops direct shader execution but keeps the feedback loop',
    async () => {
      const state = await renderNativeFeedbackState(
        '?renderer=webgpu&milkdrop-webgpu-feedback=0',
      );

      // A composite state still reaches the native feedback manager, so the
      // loop runs; only the authored comp body is replaced by the controls
      // approximation.
      expect(state).not.toBeNull();
      expect(state?.shaderExecution).toBe('controls');
      expect(state?.shaderPrograms.comp).toBeNull();
    },
    NATIVE_ADAPTER_TIMEOUT_MS,
  );
});
