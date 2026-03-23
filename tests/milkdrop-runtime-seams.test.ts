import { describe, expect, mock, test } from 'bun:test';
import { createMilkdropBackendFailover } from '../assets/js/milkdrop/runtime/backend-fallback.ts';
import {
  buildBlendStateForRender,
  buildRenderFrameState,
  shouldAutoAdvancePreset,
} from '../assets/js/milkdrop/runtime/lifecycle.ts';
import { resolveStartupPresetId } from '../assets/js/milkdrop/runtime/startup.ts';
import type {
  MilkdropBlendState,
  MilkdropFrameState,
} from '../assets/js/milkdrop/types.ts';

const gpuBlendState: MilkdropBlendState = {
  mode: 'gpu',
  previousFrame: { presetId: 'prev' } as MilkdropFrameState,
  alpha: 1,
};

describe('milkdrop runtime startup seams', () => {
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
  });
});

describe('milkdrop backend failover seams', () => {
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
