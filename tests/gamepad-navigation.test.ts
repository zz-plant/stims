import { describe, expect, test } from 'bun:test';
import { shouldDispatchEscapeFallback } from '../assets/js/utils/gamepad-navigation.ts';

describe('gamepad navigation back fallback guard', () => {
  test('does not redispatch when origin key is Escape', () => {
    expect(shouldDispatchEscapeFallback('Escape')).toBeFalse();
  });

  test('redispatches fallback Escape for non-Escape back keys', () => {
    expect(shouldDispatchEscapeFallback('Backspace')).toBeTrue();
    expect(shouldDispatchEscapeFallback('BrowserBack')).toBeTrue();
    expect(shouldDispatchEscapeFallback('GoBack')).toBeTrue();
  });
});
