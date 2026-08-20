import { describe, expect, test } from 'bun:test';
import { shouldEnableDebugHud } from '../../src/js/frontend/HudOverlay.tsx';

describe('debug HUD gating', () => {
  test('enables the HUD for the primary ?debug=hud spelling', () => {
    expect(shouldEnableDebugHud({ search: '?debug=hud' })).toBe(true);
  });

  test('enables the HUD for the legacy ?stats=1 alias', () => {
    expect(shouldEnableDebugHud({ search: '?stats=1' })).toBe(true);
  });

  test('?stats=0 forces the HUD off even with a persisted opt-in', () => {
    expect(
      shouldEnableDebugHud({ search: '?stats=0', storageValue: '1' }),
    ).toBe(false);
  });

  test('falls back to the persisted debug flag', () => {
    expect(shouldEnableDebugHud({ storageValue: '1' })).toBe(true);
    expect(shouldEnableDebugHud({ storageValue: null })).toBe(false);
  });

  test('stays off with no flags at all', () => {
    expect(shouldEnableDebugHud({ search: '' })).toBe(false);
  });
});
