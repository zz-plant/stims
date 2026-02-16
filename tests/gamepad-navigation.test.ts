import { describe, expect, test } from 'bun:test';
import {
  shouldDispatchEscapeFallback,
  shouldHandleBackKey,
  shouldHandleEnterLikeKey,
} from '../assets/js/utils/gamepad-navigation.ts';

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

describe('remote key mapping', () => {
  const keyEvent = (key: string, keyCode = 0) =>
    new window.KeyboardEvent('keydown', { key, keyCode });

  test('recognizes modern and legacy back keys', () => {
    expect(shouldHandleBackKey(keyEvent('Backspace'))).toBeTrue();
    expect(shouldHandleBackKey(keyEvent('BrowserBack'))).toBeTrue();
    expect(shouldHandleBackKey(keyEvent('Back'))).toBeTrue();
    expect(shouldHandleBackKey(keyEvent('Exit'))).toBeTrue();
    expect(shouldHandleBackKey(keyEvent('Unidentified', 10009))).toBeTrue();
    expect(shouldHandleBackKey(keyEvent('Unidentified', 461))).toBeTrue();
  });

  test('recognizes modern and legacy enter/ok keys', () => {
    expect(shouldHandleEnterLikeKey(keyEvent('Enter'))).toBeTrue();
    expect(shouldHandleEnterLikeKey(keyEvent('NumpadEnter'))).toBeTrue();
    expect(shouldHandleEnterLikeKey(keyEvent('Select'))).toBeTrue();
    expect(shouldHandleEnterLikeKey(keyEvent('Return'))).toBeTrue();
    expect(shouldHandleEnterLikeKey(keyEvent('Unidentified', 23))).toBeTrue();
  });

  test('ignores unrelated keys', () => {
    expect(shouldHandleBackKey(keyEvent('ArrowLeft'))).toBeFalse();
    expect(shouldHandleEnterLikeKey(keyEvent('ArrowRight'))).toBeFalse();
  });
});
