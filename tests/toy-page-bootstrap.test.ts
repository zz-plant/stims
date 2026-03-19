import { describe, expect, test } from 'bun:test';
import {
  isPresetFirstToySession,
  shouldOpenPreflightModal,
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
    expect(isPresetFirstToySession('holy')).toBe(false);
  });

  test('keeps the preflight modal closed for preset-first milkdrop sessions', () => {
    expect(
      shouldOpenPreflightModal({
        toySlug: 'milkdrop',
        dismissedForSession: false,
      }),
    ).toBe(false);
  });

  test('still opens the preflight modal for non-milkdrop toys on a fresh session', () => {
    expect(
      shouldOpenPreflightModal({
        toySlug: 'holy',
        dismissedForSession: false,
      }),
    ).toBe(true);
  });
});
