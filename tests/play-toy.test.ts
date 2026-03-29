import { expect, test } from 'bun:test';
import {
  buildPlayToyArtifactStem,
  buildPlayToyUrl,
} from '../scripts/play-toy.ts';

test('buildPlayToyUrl includes the requested preset for milkdrop captures', () => {
  expect(
    buildPlayToyUrl({
      port: 4173,
      slug: 'milkdrop',
      presetId: 'eos-glowsticks-v2-03-music',
    }),
  ).toBe(
    'http://127.0.0.1:4173/milkdrop/?experience=milkdrop&agent=true&audio=demo&preset=eos-glowsticks-v2-03-music',
  );
});

test('buildPlayToyUrl omits the preset when none is provided', () => {
  expect(
    buildPlayToyUrl({
      port: 5173,
      slug: 'milkdrop',
    }),
  ).toBe(
    'http://127.0.0.1:5173/milkdrop/?experience=milkdrop&agent=true&audio=demo',
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
