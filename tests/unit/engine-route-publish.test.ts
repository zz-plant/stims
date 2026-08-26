/**
 * Guards the address bar against attract mode.
 *
 * The regression: a bare "/" arrival mounts the engine purely as decoration
 * behind the launch card, the runtime picks a first-run preset, and that pick
 * used to be published into the URL. Reload or Back then landed on
 * `/?preset=<first-run-id>`, which the deep-link path reads as "came to watch
 * this preset" and auto-starts demo audio — so the landing page could never be
 * seen a second time, and its URL was not safe to copy.
 */
import { describe, expect, test } from 'bun:test';
import { decideEngineRoutePublish } from '../../src/js/frontend/engine-route-publish.ts';

const base = {
  runtimeReady: true,
  activePresetId: 'preset-a' as string | null | undefined,
  audioActive: false,
  routePresetId: null as string | null,
};

describe('decideEngineRoutePublish', () => {
  test('keeps the attract-mode preset out of a bare arrival URL', () => {
    expect(
      decideEngineRoutePublish({
        ...base,
        audioActive: false,
        routePresetId: null,
      }),
    ).toBe('attract-only');
  });

  test('publishes once the visitor starts an audio source', () => {
    expect(
      decideEngineRoutePublish({
        ...base,
        audioActive: true,
        routePresetId: null,
      }),
    ).toBe('publish');
  });

  test('publishes when the URL already names a preset, so autoplay keeps the link current', () => {
    expect(
      decideEngineRoutePublish({
        ...base,
        activePresetId: 'preset-b',
        audioActive: false,
        routePresetId: 'preset-a',
      }),
    ).toBe('publish');
  });

  test('still publishes for a deep link whose audio has not started yet', () => {
    expect(
      decideEngineRoutePublish({
        ...base,
        audioActive: false,
        routePresetId: 'preset-a',
      }),
    ).toBe('publish');
  });

  test('waits for the runtime before writing anything', () => {
    expect(
      decideEngineRoutePublish({
        ...base,
        runtimeReady: false,
        audioActive: true,
      }),
    ).toBe('runtime-not-ready');
  });

  test('has nothing to publish before a preset is applied', () => {
    for (const activePresetId of [null, undefined, '']) {
      expect(
        decideEngineRoutePublish({
          ...base,
          activePresetId,
          audioActive: true,
        }),
      ).toBe('no-active-preset');
    }
  });
});
