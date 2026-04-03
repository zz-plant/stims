import { expect, test } from 'bun:test';
import {
  buildPlayToyArtifactStem,
  buildPlayToyUrl,
  resolveChromiumRendererArgs,
} from '../scripts/play-toy.ts';

test('buildPlayToyUrl includes the requested preset for milkdrop captures', () => {
  expect(
    buildPlayToyUrl({
      port: 4173,
      slug: 'milkdrop',
      presetId: 'eos-glowsticks-v2-03-music',
    }),
  ).toBe(
    'http://127.0.0.1:4173/?agent=true&audio=demo&preset=eos-glowsticks-v2-03-music',
  );
});

test('buildPlayToyUrl omits the preset when none is provided', () => {
  expect(
    buildPlayToyUrl({
      port: 5173,
      slug: 'milkdrop',
    }),
  ).toBe('http://127.0.0.1:5173/?agent=true&audio=demo');
});

test('buildPlayToyUrl can force the certification corpus and webgpu runtime', () => {
  expect(
    buildPlayToyUrl({
      port: 4175,
      slug: 'milkdrop',
      presetId: '100-square',
      rendererProfile: 'webgpu',
      catalogMode: 'certification',
    }),
  ).toBe(
    'http://127.0.0.1:4175/?agent=true&audio=demo&preset=100-square&renderer=webgpu&corpus=certification',
  );
});

test('buildPlayToyArtifactStem normalizes slug and preset ids for saved artifacts', () => {
  expect(
    buildPlayToyArtifactStem({
      slug: 'MilkDrop',
      presetId: 'Rovastar / Parallel Universe',
    }),
  ).toBe('milkdrop--preset-rovastar-parallel-universe');
});

test('resolveChromiumRendererArgs keeps compatibility and webgpu launch profiles separate', () => {
  expect(resolveChromiumRendererArgs('compatibility')).toContain(
    '--enable-unsafe-swiftshader',
  );
  expect(resolveChromiumRendererArgs('compatibility')).not.toContain(
    '--enable-unsafe-webgpu',
  );
  expect(resolveChromiumRendererArgs('webgpu')).toContain(
    '--enable-unsafe-webgpu',
  );
  expect(resolveChromiumRendererArgs('webgpu')).not.toContain(
    '--enable-unsafe-swiftshader',
  );
});
