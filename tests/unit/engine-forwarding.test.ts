import { describe, expect, mock, test } from 'bun:test';
import {
  createForwardedEngineActions,
  FORWARDED_ENGINE_ACTION_NAMES,
} from '../../src/js/frontend/engine/engine-forwarding.ts';
import type { MilkdropEngineAdapter } from '../../src/js/frontend/engine/milkdrop-engine-adapter.ts';

/**
 * Pure engine forwards are generated from one list. Each must behave like
 * the hand-written wrapper it replaced: pass arguments through, answer with
 * the action's own fallback while no engine is mounted, and read the engine
 * at call time so the object can stay stable across renders.
 */
describe('forwarded engine actions', () => {
  test('answer with each action’s fallback before the engine mounts', async () => {
    const actions = createForwardedEngineActions(() => null);
    expect(actions.getCrossfade()).toBeNull();
    expect(actions.stepPlaybackFrame()).toBe(false);
    expect(actions.exportPreset()).toBeUndefined();
    expect(await actions.exportUserPresets()).toBe(0);
    expect(await actions.applyEditorSourceAwaited('zoom=1')).toBeNull();
  });

  test('pass arguments through and return the engine’s answer', async () => {
    const setCrossfade = mock((_position: number) => {});
    const engine = {
      setCrossfade,
      getCrossfade: () => 0.25,
      exportUserPresets: async () => 3,
    } as unknown as MilkdropEngineAdapter;
    const actions = createForwardedEngineActions(() => engine);
    actions.setCrossfade(0.7);
    expect(setCrossfade).toHaveBeenCalledWith(0.7);
    expect(actions.getCrossfade()).toBe(0.25);
    expect(await actions.exportUserPresets()).toBe(3);
  });

  test('read the engine at call time, so one object serves the whole session', () => {
    let engine: MilkdropEngineAdapter | null = null;
    const actions = createForwardedEngineActions(() => engine);
    expect(actions.getCrossfade()).toBeNull();
    engine = { getCrossfade: () => 0.5 } as unknown as MilkdropEngineAdapter;
    expect(actions.getCrossfade()).toBe(0.5);
  });

  test('async actions stay async and sync ones stay sync', () => {
    const actions = createForwardedEngineActions(() => null);
    expect(actions.duplicatePreset()).toBeInstanceOf(Promise);
    expect(actions.exportPreset()).toBeUndefined();
    expect(FORWARDED_ENGINE_ACTION_NAMES).toContain('exportUserPresets');
  });
});
