import { describe, expect, test } from 'bun:test';
import {
  isPresetFirstToySession,
  shouldPreferDemoAudio,
} from '../assets/js/bootstrap/toy-page.ts';

describe('toy page demo-audio preference', () => {
  test('prefers demo audio when the toy metadata recommends it', () => {
    expect(
      shouldPreferDemoAudio({
        forcePreferDemoAudio: false,
        recommendedCapability: 'demoAudio',
      }),
    ).toBe(true);
  });

  test('keeps microphone-first when no inputs request demo audio', () => {
    expect(
      shouldPreferDemoAudio({
        forcePreferDemoAudio: false,
        audioInitPrefersDemoAudio: false,
        recommendedCapability: 'microphone',
      }),
    ).toBe(false);
  });

  test('force flag still wins over toy metadata', () => {
    expect(
      shouldPreferDemoAudio({
        forcePreferDemoAudio: true,
        recommendedCapability: 'microphone',
      }),
    ).toBe(true);
  });

  test('treats milkdrop as a preset-first session', () => {
    expect(isPresetFirstToySession('milkdrop')).toBe(true);
    expect(isPresetFirstToySession(null)).toBe(true);
  });
});
