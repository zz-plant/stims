/**
 * The arrival URL must be frozen at document load, not at the moment a lazy
 * chunk happens to evaluate.
 *
 * The regression: `NewHomePage` read `location.search` at its own module
 * scope. It is a lazy chunk, so on a cold cache it could evaluate *after* the
 * app had already rewritten the address bar, read the app's own
 * `?preset=` back, and auto-start a session on a bare "/" arrival.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installDomEnvironment,
  resetDomEnvironment,
} from '../environment/dom.ts';
import { importFresh } from '../test-helpers.ts';

type ArrivalModule = typeof import('../../src/js/frontend/arrival-url.ts');

const load = (search: string) => {
  const domWindow = installDomEnvironment();
  domWindow.happyDOM.setURL(`https://toil.fyi/${search}`);
  return importFresh<ArrivalModule>('../../src/js/frontend/arrival-url.ts');
};

afterEach(() => {
  resetDomEnvironment();
});

describe('arrival URL snapshot', () => {
  test('reports the preset a deep link asked for', async () => {
    const arrival = await load('?preset=aderrasi-potion-of-spirits');
    expect(arrival.getArrivalPresetId()).toBe('aderrasi-potion-of-spirits');
  });

  test('reports no preset for a bare arrival', async () => {
    const arrival = await load('');
    expect(arrival.getArrivalPresetId()).toBeNull();
  });

  test('ignores a preset the app writes into the URL after load', async () => {
    const arrival = await load('');
    window.history.replaceState(null, '', '?preset=written-by-attract-mode');

    expect(window.location.search).toBe('?preset=written-by-attract-mode');
    expect(arrival.getArrivalPresetId()).toBeNull();
  });

  test('keeps reporting the visitor’s preset after the app rewrites the URL', async () => {
    const arrival = await load('?preset=from-a-social-card');
    window.history.replaceState(null, '', '?preset=autoplay-moved-on');

    expect(arrival.getArrivalPresetId()).toBe('from-a-social-card');
  });

  test('reads other arrival parameters from the same snapshot', async () => {
    const arrival = await load('?preset=one&collection=hall-of-fame');
    expect(arrival.getArrivalParam('collection')).toBe('hall-of-fame');
    expect(arrival.getArrivalParam('absent')).toBeNull();
    expect(arrival.getArrivalSearch()).toBe(
      '?preset=one&collection=hall-of-fame',
    );
  });
});

describe('arrival URL snapshot wiring', () => {
  test('the entry module imports it eagerly, which is what pins it to document load', () => {
    const entry = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'app.ts'),
      'utf8',
    );

    expect(entry).toMatch(/import '\.\/frontend\/arrival-url\.ts';/u);
  });

  test('the launch page reads the snapshot instead of live location', () => {
    const homePage = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'NewHomePage.tsx',
      ),
      'utf8',
    );

    expect(homePage).toContain('getArrivalPresetId');
    expect(homePage).not.toContain('window.location.search');
  });
});
