import { describe, expect, test } from 'bun:test';
import {
  createMotionToyCapabilities,
  createToyCapabilities,
  withToyCapabilities,
} from '../assets/js/utils/toy-capabilities.ts';

describe('toy capability helpers', () => {
  test('builds default audio capabilities', () => {
    expect(createToyCapabilities()).toEqual({
      microphone: true,
      demoAudio: true,
      motion: false,
    });
  });

  test('builds motion-enabled capabilities', () => {
    expect(createMotionToyCapabilities()).toEqual({
      microphone: true,
      demoAudio: true,
      motion: true,
    });
  });

  test('withToyCapabilities clones capability objects', () => {
    const capabilities = createToyCapabilities();
    const entry = withToyCapabilities({ slug: 'test' }, capabilities);

    capabilities.motion = true;

    expect(entry.capabilities).toEqual({
      microphone: true,
      demoAudio: true,
      motion: false,
    });
  });
});
