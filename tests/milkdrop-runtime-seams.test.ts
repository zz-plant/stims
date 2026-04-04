import { describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import {
  createMilkdropBackendFailover,
  shouldPresetFallbackToWebgl,
} from '../assets/js/milkdrop/runtime/backend-fallback.ts';
import { applyMilkdropCapturedVideoFrameState } from '../assets/js/milkdrop/runtime/captured-video-frame.ts';
import { createMilkdropCapturedVideoReactivityTracker } from '../assets/js/milkdrop/runtime/captured-video-reactivity.ts';
import {
  buildBlendStateForRender,
  buildRenderFrameState,
  shouldAutoAdvancePreset,
} from '../assets/js/milkdrop/runtime/lifecycle.ts';
import { createMilkdropRuntimeLifetime } from '../assets/js/milkdrop/runtime/lifetime.ts';
import { resolveStartupPresetId } from '../assets/js/milkdrop/runtime/startup.ts';
import type {
  MilkdropBlendState,
  MilkdropFrameState,
} from '../assets/js/milkdrop/types.ts';
import { DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS } from '../assets/js/milkdrop/webgpu-optimization-flags.ts';

const gpuBlendState: MilkdropBlendState = {
  mode: 'gpu',
  previousFrame: { presetId: 'prev' } as MilkdropFrameState,
  alpha: 1,
};

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
  test('does not auto-select a preset when nothing was explicitly requested', () => {
    const startupId = resolveStartupPresetId({
      requestedPresetId: null,
      preferredStartupPresetId: null,
      collectionEntryId: null,
      isBackendSelectable: () => true,
      getFirstSelectablePresetId: () => 'fallback',
      activeBackend: 'webgpu',
    });

    expect(startupId).toBeNull();
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
    expect(
      shouldAutoAdvancePreset({
        autoplay: true,
        catalogSize: 3,
        now: 19_000,
        lastPresetSwitchAt: 1_000,
        blendDuration: 2,
      }),
    ).toBe(true);

    expect(
      shouldAutoAdvancePreset({
        autoplay: false,
        catalogSize: 3,
        now: 19_000,
        lastPresetSwitchAt: 1_000,
        blendDuration: 2,
      }),
    ).toBe(false);
  });

  test('builds blend payloads only while an active blend is still valid', () => {
    const blend = buildBlendStateForRender({
      transitionMode: 'blend',
      shaderQuality: 'balanced',
      canBlendCurrentFrame: true,
      blendState: gpuBlendState,
      now: 3_000,
      blendEndAtMs: 4_000,
      blendDuration: 2,
    });

    expect(blend?.mode).toBe('gpu');
    expect(blend?.alpha).toBeCloseTo(0.5, 6);

    expect(
      buildBlendStateForRender({
        transitionMode: 'cut',
        shaderQuality: 'balanced',
        canBlendCurrentFrame: true,
        blendState: gpuBlendState,
        now: 3_000,
        blendEndAtMs: 4_000,
        blendDuration: 2,
      }),
    ).toBeNull();
  });

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
  test('keeps orientation-only echo and custom-shape presets on webgpu when descriptor planning stays native', () => {
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

    expect(
      shouldPresetFallbackToWebgl({
        compiled: videoEchoPreset,
        activeBackend: 'webgpu',
        webgpuOptimizationFlags: DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
      }),
    ).toBe(false);
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
