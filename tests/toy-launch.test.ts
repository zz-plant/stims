import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  normalizeToyLaunchResult,
  resolveLegacyToyAudioStarter,
} from '../assets/js/core/toy-launch.ts';
import { createToyLifecycle } from '../assets/js/core/toy-lifecycle.ts';
import type { ToyEntry } from '../assets/js/data/toy-schema.ts';
import { createToyLaunchController } from '../assets/js/loader/toy-launch-controller.ts';

function createManifestClient(modulePath: string) {
  return {
    resolveModulePath: async () => modulePath,
    fetchManifest: async () => null,
    getManifestPaths: () => [],
    getBaseUrl: () => null,
    reset: () => {},
  };
}

function createToy(module: string, slug = 'test-toy'): ToyEntry {
  return {
    slug,
    title: 'Test Toy',
    description: 'Test toy description',
    module,
    type: 'module',
    capabilities: {
      microphone: true,
      demoAudio: true,
      motion: false,
    },
  };
}

describe('toy launch audio normalization', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.startAudio = undefined;
    window.startAudioFallback = undefined;
  });

  test('maps microphone, demo, tab, and youtube requests through the legacy starter adapter', async () => {
    const startAudio = mock(async () => {});
    const startAudioFallback = mock(async () => {});
    const win = {
      startAudio,
      startAudioFallback,
    } as unknown as Window & typeof globalThis;

    const controller = await resolveLegacyToyAudioStarter(win);

    expect(controller.audioStarterAvailable).toBe(true);
    expect(controller.supportedSources).toEqual([
      'microphone',
      'demo',
      'tab',
      'youtube',
    ]);

    await controller.startAudio?.({ source: 'microphone' });
    await controller.startAudio?.({ source: 'demo' });
    await controller.startAudio?.({
      source: 'tab',
      stream: { id: 'tab-stream' } as MediaStream,
    });
    await controller.startAudio?.({
      source: 'youtube',
      stream: { id: 'youtube-stream' } as MediaStream,
    });

    expect(startAudio).toHaveBeenCalledWith('microphone');
    expect(startAudioFallback).toHaveBeenCalledTimes(1);
    expect(startAudio).toHaveBeenCalledWith({ stream: { id: 'tab-stream' } });
    expect(startAudio).toHaveBeenCalledWith({
      stream: { id: 'youtube-stream' },
    });
  });

  test('returns a launch result without audio controls when starters are missing', async () => {
    const launchResult = await normalizeToyLaunchResult(
      { dispose() {} },
      { windowRef: window, waitForAudioStarter: false },
    );

    expect(launchResult.audioStarterAvailable).toBe(false);
    expect(launchResult.supportedSources).toEqual([]);
    expect(launchResult.startAudio).toBeUndefined();
  });
});

describe('toy launch controller module normalization', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('loads a module with a named start export', async () => {
    const lifecycle = createToyLifecycle();
    const controller = createToyLaunchController({
      lifecycle,
      toys: [],
      manifestClient: createManifestClient('./__mocks__/fake-module.js'),
    });

    const result = await controller.launchToy({
      toy: createToy('./__mocks__/fake-module.js', 'named-start'),
      request: {
        slug: 'named-start',
        container: document.body,
        audioPreference: 'none',
      },
    });

    expect(result.ok).toBe(true);
    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
  });

  test('loads a module with a default start export', async () => {
    const lifecycle = createToyLifecycle();
    const controller = createToyLaunchController({
      lifecycle,
      toys: [],
      manifestClient: createManifestClient(
        './__mocks__/fake-default-module.js',
      ),
    });

    const result = await controller.launchToy({
      toy: createToy('./__mocks__/fake-default-module.js', 'default-start'),
      request: {
        slug: 'default-start',
        container: document.body,
        audioPreference: 'none',
      },
    });

    expect(result.ok).toBe(true);
    expect(document.querySelector('[data-fake-default-toy]')).not.toBeNull();
  });

  test('returns an error when a module does not export start', async () => {
    const lifecycle = createToyLifecycle();
    const controller = createToyLaunchController({
      lifecycle,
      toys: [],
      manifestClient: createManifestClient('./__mocks__/fake-missing-start.js'),
    });

    const result = await controller.launchToy({
      toy: createToy('./__mocks__/fake-missing-start.js', 'missing-start'),
      request: {
        slug: 'missing-start',
        container: document.body,
        audioPreference: 'none',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('start function');
    }
  });
});
