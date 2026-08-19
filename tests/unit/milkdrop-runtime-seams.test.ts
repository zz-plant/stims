import { describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import {
  createMilkdropBackendFailover,
  shouldPresetFallbackToWebgl,
} from '../../src/js/milkdrop/runtime/backend-fallback.ts';
import { applyMilkdropCapturedVideoFrameState } from '../../src/js/milkdrop/runtime/captured-video-frame.ts';
import { createMilkdropCapturedVideoReactivityTracker } from '../../src/js/milkdrop/runtime/captured-video-reactivity.ts';
import {
  buildRenderFrameState,
  shouldAutoAdvancePreset,
  shouldPrepareNextPreset,
} from '../../src/js/milkdrop/runtime/lifecycle.ts';
import { createMilkdropRuntimeLifetime } from '../../src/js/milkdrop/runtime/lifetime.ts';
import {
  resolveStartupPresetChoice,
  resolveStartupPresetId,
  shouldDeferStartupPresetFallback,
} from '../../src/js/milkdrop/runtime/startup.ts';
import type { MilkdropFrameState } from '../../src/js/milkdrop/types.ts';
import { DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS } from '../../src/js/milkdrop/webgpu-optimization-flags.ts';

function resolveCapturedVideoReactivity({
  weightedEnergy,
  beatPulse,
  time,
  bass,
  bassAtt,
  mid,
  midAtt,
  midsAtt,
  treble,
  trebleAtt,
}: {
  weightedEnergy: number;
  beatPulse: number;
  time: number;
  bass: number;
  bassAtt: number;
  mid: number;
  midAtt: number;
  midsAtt: number;
  treble: number;
  trebleAtt: number;
}) {
  return createMilkdropCapturedVideoReactivityTracker().update({
    signals: {
      weightedEnergy,
      beatPulse,
      time,
      deltaMs: 1000 / 60,
      bass,
      bassAtt,
      mid,
      midAtt,
      midsAtt,
      treble,
      trebleAtt,
    },
  });
}

describe('milkdrop runtime startup seams', () => {
  test('defers fallback from the placeholder preset while an explicit startup preset is pending', () => {
    expect(
      shouldDeferStartupPresetFallback({
        pendingPresetId: '100-square',
        activePresetId: 'signal-bloom',
      }),
    ).toBe(true);
    expect(
      shouldDeferStartupPresetFallback({
        pendingPresetId: '100-square',
        activePresetId: '100-square',
      }),
    ).toBe(false);
  });

  test('falls back to the first selectable preset when nothing was explicitly requested', () => {
    // This used to return null, which is why a first-time visitor with no
    // deep link, history or collection got a mounted engine drawing nothing.
    // "Nothing was requested" is the most common arrival, not an edge case, so
    // it resolves to the deliberate first-run pick.
    const startupId = resolveStartupPresetId({
      requestedPresetId: null,
      preferredStartupPresetId: null,
      collectionEntryId: null,
      isBackendSelectable: () => true,
      getFirstSelectablePresetId: () => 'fallback',
      activeBackend: 'webgpu',
    });

    expect(startupId).toBe('fallback');
  });

  test('prefers an explicitly requested preset when the backend can run it', () => {
    const startupId = resolveStartupPresetId({
      requestedPresetId: 'requested',
      preferredStartupPresetId: 'preferred',
      collectionEntryId: 'collection',
      isBackendSelectable: (presetId) => presetId !== 'blocked',
      getFirstSelectablePresetId: () => 'fallback',
      activeBackend: 'webgpu',
    });

    expect(startupId).toBe('requested');
  });

  test('falls back to the first selectable preset when the preferred choice is unsupported', () => {
    const startupId = resolveStartupPresetId({
      requestedPresetId: null,
      preferredStartupPresetId: 'blocked',
      collectionEntryId: 'collection',
      isBackendSelectable: (presetId) => presetId === 'collection',
      getFirstSelectablePresetId: () => 'fallback',
      activeBackend: 'webgpu',
    });

    expect(startupId).toBe('fallback');
  });

  // Provenance: the id alone cannot tell you why a preset is on screen, which
  // is what made "why is it showing this preset?" a code-reading exercise.
  test('reports which branch chose the startup preset', () => {
    const choose = (
      over: Partial<Parameters<typeof resolveStartupPresetChoice>[0]>,
    ) =>
      resolveStartupPresetChoice({
        requestedPresetId: null,
        preferredStartupPresetId: null,
        collectionEntryId: null,
        isBackendSelectable: () => true,
        getFirstSelectablePresetId: () => 'fallback',
        activeBackend: 'webgpu',
        ...over,
      });

    expect(choose({ requestedPresetId: 'deep' })).toEqual({
      presetId: 'deep',
      reason: 'deep-link',
    });
    expect(choose({ preferredStartupPresetId: 'stored' })).toEqual({
      presetId: 'stored',
      reason: 'remembered',
    });
    expect(choose({ collectionEntryId: 'coll' })).toEqual({
      presetId: 'coll',
      reason: 'collection',
    });
    expect(choose({})).toEqual({
      presetId: 'fallback',
      reason: 'first-selectable',
    });
    // An unsupported preferred pick falls through to the fallback, and the
    // reason must fall through with it rather than still claiming 'remembered'.
    expect(
      choose({
        preferredStartupPresetId: 'blocked',
        isBackendSelectable: (id) => id !== 'blocked',
      }),
    ).toEqual({ presetId: 'fallback', reason: 'first-selectable' });
  });

  test('resolveStartupPresetId stays in agreement with the reported choice', () => {
    const args = {
      requestedPresetId: null,
      preferredStartupPresetId: 'stored',
      collectionEntryId: 'coll',
      isBackendSelectable: () => true,
      getFirstSelectablePresetId: () => 'fallback',
      activeBackend: 'webgpu' as const,
    };
    expect(resolveStartupPresetId(args)).toBe(
      resolveStartupPresetChoice(args).presetId,
    );
  });
});

describe('milkdrop runtime lifetime seams', () => {
  test('invalidates stale attachment work and blocks new work after dispose', () => {
    const lifetime = createMilkdropRuntimeLifetime();

    const firstAttachment = lifetime.beginAttachment();
    expect(lifetime.isCurrentAttachment(firstAttachment)).toBe(true);

    const secondAttachment = lifetime.beginAttachment();
    expect(lifetime.isCurrentAttachment(firstAttachment)).toBe(false);
    expect(lifetime.isCurrentAttachment(secondAttachment)).toBe(true);

    lifetime.dispose();

    expect(lifetime.isActive()).toBe(false);
    expect(lifetime.isCurrentAttachment(secondAttachment)).toBe(false);
  });
});

describe('milkdrop runtime lifecycle seams', () => {
  test('only auto-advances after autoplay thresholds are met', () => {
    // The dwell floor is max(30s, blend + 6s), so a 2s blend still waits 30s.
    expect(
      shouldAutoAdvancePreset({
        autoplay: true,
        catalogSize: 3,
        now: 31_500,
        lastPresetSwitchAt: 1_000,
        blendDuration: 2,
      }),
    ).toBe(true);

    expect(
      shouldAutoAdvancePreset({
        autoplay: true,
        catalogSize: 3,
        now: 29_000,
        lastPresetSwitchAt: 1_000,
        blendDuration: 2,
      }),
    ).toBe(false);

    expect(
      shouldAutoAdvancePreset({
        autoplay: false,
        catalogSize: 3,
        now: 31_500,
        lastPresetSwitchAt: 1_000,
        blendDuration: 2,
      }),
    ).toBe(false);
  });

  test('asks to prepare the next pick a lead window before the advance', () => {
    const base = {
      autoplay: true,
      catalogSize: 3,
      lastPresetSwitchAt: 1_000,
      blendDuration: 2,
    };
    // Advance fires at 31s; preparation must lead it, not trail it.
    expect(shouldPrepareNextPreset({ ...base, now: 24_000 })).toBe(true);
    expect(shouldPrepareNextPreset({ ...base, now: 20_000 })).toBe(false);
    // Same gates as the advance itself: no autoplay → no preparation.
    expect(
      shouldPrepareNextPreset({ ...base, autoplay: false, now: 24_000 }),
    ).toBe(false);
  });

  // Blend-alpha behavior moved to runtime/transition-controller.ts; see
  // tests/unit/milkdrop-transition-controller.test.ts.

  test('disables heavy post effects for low shader quality frames', () => {
    const frameState = {
      post: {
        shaderEnabled: true,
        videoEchoEnabled: true,
        postprocessingProfile: {
          enabled: true,
        },
      },
      gpuGeometry: {
        particleField: {
          enabled: true,
          instanceCount: 96,
        },
      },
    } as MilkdropFrameState;

    const downgraded = buildRenderFrameState({
      frameState,
      shaderQuality: 'low',
      lowQualityPostOverride: {
        shaderEnabled: false,
        videoEchoEnabled: false,
      },
    });

    expect(downgraded).not.toBe(frameState);
    expect(downgraded.post.shaderEnabled).toBe(false);
    expect(downgraded.post.videoEchoEnabled).toBe(false);
    expect(downgraded.post.postprocessingProfile?.enabled).toBe(false);
    expect(downgraded.gpuGeometry.particleField?.enabled).toBe(false);
  });

  test('keeps the shader stage at low quality when it is the preset painter', () => {
    // Direct warp/comp programs paint the frame; stripping them at the low
    // step turned those presets into a black screen with a bare wave line.
    const frameState = {
      post: {
        shaderEnabled: true,
        videoEchoEnabled: true,
        shaderPrograms: { warp: null, comp: { rawGlsl: 'ret = float3(1);' } },
        postprocessingProfile: {
          enabled: true,
        },
      },
      gpuGeometry: {
        particleField: {
          enabled: true,
          instanceCount: 96,
        },
      },
    } as unknown as MilkdropFrameState;

    const downgraded = buildRenderFrameState({
      frameState,
      shaderQuality: 'low',
      lowQualityPostOverride: {
        shaderEnabled: false,
        videoEchoEnabled: false,
      },
    });

    expect(downgraded.post.shaderEnabled).toBe(true);
    expect(downgraded.post.videoEchoEnabled).toBe(false);
    expect(downgraded.post.postprocessingProfile?.enabled).toBe(false);
    expect(downgraded.gpuGeometry.particleField?.enabled).toBe(false);
  });

  test('injects the captured video texture when shader texture slots are available', () => {
    const frameState = {
      post: {
        shaderEnabled: false,
        shaderControls: {
          mixAlpha: 0,
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
      },
      signals: {
        weightedEnergy: 0.6,
        beatPulse: 0.4,
        time: 12,
      },
    } as MilkdropFrameState;

    const upgraded = applyMilkdropCapturedVideoFrameState({
      frameState,
      capturedVideoReady: true,
      reactivity: resolveCapturedVideoReactivity({
        weightedEnergy: 0.6,
        beatPulse: 0.4,
        time: 12,
        bass: 0.7,
        bassAtt: 0.8,
        mid: 0.3,
        midAtt: 0.35,
        midsAtt: 0.35,
        treble: 0.45,
        trebleAtt: 0.5,
      }),
    });

    expect(upgraded).not.toBe(frameState);
    expect(upgraded.post.shaderEnabled).toBe(true);
    expect(upgraded.post.shaderControls.textureLayer.source).toBe('video');
    expect(upgraded.post.shaderControls.textureLayer.mode).toBe('mix');
    expect(upgraded.post.shaderControls.warpTexture.source).toBe('video');
    expect(upgraded.post.shaderControls.mixAlpha).toBeGreaterThan(0);
    expect(upgraded.post.shaderControls.textureLayer.scaleX).toBeGreaterThan(1);
    expect(upgraded.post.shaderControls.warpTexture.amount).toBeGreaterThan(
      0.028,
    );
  });

  test('preserves preset-defined texture slots when captured video is active', () => {
    const frameState = {
      post: {
        shaderEnabled: true,
        shaderControls: {
          mixAlpha: 0.2,
          textureLayer: {
            source: 'aura',
            mode: 'add',
            sampleDimension: '2d',
            inverted: false,
            amount: 0.4,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
            volumeSliceZ: null,
          },
          warpTexture: {
            source: 'fractal',
            sampleDimension: '2d',
            amount: 0.08,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
            volumeSliceZ: null,
          },
        },
      },
      signals: {
        weightedEnergy: 0.2,
        beatPulse: 0.1,
        time: 4,
      },
    } as MilkdropFrameState;

    expect(
      applyMilkdropCapturedVideoFrameState({
        frameState,
        capturedVideoReady: true,
        reactivity: resolveCapturedVideoReactivity({
          weightedEnergy: 0.2,
          beatPulse: 0.1,
          time: 4,
          bass: 0.2,
          bassAtt: 0.22,
          mid: 0.15,
          midAtt: 0.16,
          midsAtt: 0.16,
          treble: 0.1,
          trebleAtt: 0.12,
        }),
      }),
    ).toBe(frameState);
  });
});

describe('milkdrop backend failover seams', () => {
  test('keeps echo presets native by default and falls them back only on explicit opt-in', () => {
    const videoEchoPreset = compileMilkdropPresetSource(
      `
title=Video Echo Orientation Gap
video_echo=1
video_echo_orientation=3
      `.trim(),
      { id: 'video-echo-orientation-gap' },
    );
    const customShapePreset = compileMilkdropPresetSource(
      `
title=Custom Shape Gap
shapecode_0_enabled=1
shapecode_0_sides=5
      `.trim(),
      { id: 'custom-shape-gap' },
    );
    const stablePreset = compileMilkdropPresetSource(
      `
title=Stable WebGPU Preset
zoom=1.02
warp=0.08
      `.trim(),
      { id: 'stable-webgpu-preset' },
    );

    // Video echo (including orientation flips) is implemented by the native
    // TSL feedback manager, so echo presets no longer reload into WebGL by
    // default…
    expect(
      shouldPresetFallbackToWebgl({
        compiled: videoEchoPreset,
        activeBackend: 'webgpu',
        webgpuOptimizationFlags: DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
      }),
    ).toBe(false);
    // …but the explicit rollout opt-in still routes them to WebGL.
    expect(
      shouldPresetFallbackToWebgl({
        compiled: videoEchoPreset,
        activeBackend: 'webgpu',
        webgpuOptimizationFlags: {
          ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
          descriptorFallbackToWebgl: true,
        },
      }),
    ).toBe(true);
    expect(
      shouldPresetFallbackToWebgl({
        compiled: customShapePreset,
        activeBackend: 'webgpu',
        webgpuOptimizationFlags: DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
      }),
    ).toBe(false);
    expect(
      shouldPresetFallbackToWebgl({
        compiled: stablePreset,
        activeBackend: 'webgpu',
        webgpuOptimizationFlags: DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
      }),
    ).toBe(false);
  });

  test('records fallback metadata and reloads once for webgpu failures', () => {
    const recordFallback = mock(() => {});
    const reload = mock(() => {});
    const failover = createMilkdropBackendFailover({
      preferences: { recordFallback },
      reload,
    });

    expect(
      failover.trigger({
        presetId: 'preset-a',
        reason: 'Unsupported feature',
        activeBackend: 'webgpu',
      }),
    ).toBe(true);
    expect(recordFallback).toHaveBeenCalledWith({
      presetId: 'preset-a',
      reason: 'Unsupported feature',
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(
      failover.trigger({
        presetId: 'preset-a',
        reason: 'Unsupported feature',
        activeBackend: 'webgpu',
      }),
    ).toBe(false);
  });
});
