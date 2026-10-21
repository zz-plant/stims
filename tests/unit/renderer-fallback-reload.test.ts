/**
 * When a preset cannot run on WebGPU, Stims reloads the page into WebGL. That
 * reload used to be indistinguishable from anything else: the arriving page
 * read the session's own `?preset=&audio=` as a link someone had shared, and
 * an editor holding broken text raised the browser's leave-page prompt over
 * a reload the visitor never asked for.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  consumeRendererFallbackReload,
  isRendererFallbackReloadInFlight,
  reloadForRendererFallback,
} from '../../src/js/core/state/renderer-fallback-reload.ts';
import { installUnsavedEditsGuard } from '../../src/js/frontend/unsaved-edits-guard.ts';
import {
  installDomEnvironment,
  resetDomEnvironment,
} from '../environment/dom.ts';

function fakeLocation(href: string) {
  const replaced: string[] = [];
  let reloads = 0;
  return {
    href,
    replace: (url: string | URL) => {
      replaced.push(String(url));
    },
    reload: () => {
      reloads += 1;
    },
    replaced,
    reloads: () => reloads,
  };
}

function leavePrompted() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  installDomEnvironment();
});

afterEach(() => {
  resetDomEnvironment();
});

describe('the WebGL fallback reload', () => {
  // One test, in this order, because "in flight" is page state: once the
  // reload starts nothing un-starts it (the page is going away).
  test('the leave-page prompt guards broken edits, but not the fallback’s own reload', () => {
    const removeGuard = installUnsavedEditsGuard(window as unknown as Window);
    try {
      expect(isRendererFallbackReloadInFlight()).toBe(false);
      expect(leavePrompted()).toBe(true);

      reloadForRendererFallback(
        'martin-witchcraft',
        fakeLocation('https://toil.fyi/?audio=microphone'),
      );

      expect(isRendererFallbackReloadInFlight()).toBe(true);
      expect(leavePrompted()).toBe(false);
    } finally {
      removeGuard();
    }
  });

  test('reloads the session’s own URL with the preset pinned, keeping the editor hash', () => {
    const location = fakeLocation(
      'https://toil.fyi/?audio=microphone#code=draft',
    );
    reloadForRendererFallback('martin-witchcraft', location);

    expect(location.replaced).toEqual([
      'https://toil.fyi/?audio=microphone&preset=martin-witchcraft#code=draft',
    ]);
  });

  test('a URL that already names the preset reloads instead of navigating to its own #code= fragment', () => {
    // Replacing a URL with itself when it carries a fragment is a same-page
    // fragment navigation in browsers: nothing reloads, and the preset stays
    // on WebGPU.
    const location = fakeLocation(
      'https://toil.fyi/?preset=martin-witchcraft&audio=demo#code=draft',
    );
    reloadForRendererFallback('martin-witchcraft', location);

    expect(location.replaced).toEqual([]);
    expect(location.reloads()).toBe(1);
  });

  test('the next load knows the reload was ours, once', () => {
    reloadForRendererFallback(
      'martin-witchcraft',
      fakeLocation('https://toil.fyi/'),
    );

    expect(consumeRendererFallbackReload('martin-witchcraft')).toBe(true);
    // A reload the visitor makes afterwards is theirs.
    expect(consumeRendererFallbackReload('martin-witchcraft')).toBe(false);
  });

  test('a marker naming another preset is not this arrival, and is dropped', () => {
    reloadForRendererFallback(
      'martin-witchcraft',
      fakeLocation('https://toil.fyi/'),
    );

    expect(consumeRendererFallbackReload('geiss-casino')).toBe(false);
    expect(consumeRendererFallbackReload('martin-witchcraft')).toBe(false);
  });

  test('a load with no marker, or no preset, is not a fallback reload', () => {
    expect(consumeRendererFallbackReload('martin-witchcraft')).toBe(false);
    reloadForRendererFallback(
      'martin-witchcraft',
      fakeLocation('https://toil.fyi/'),
    );
    expect(consumeRendererFallbackReload(null)).toBe(false);
  });
});
