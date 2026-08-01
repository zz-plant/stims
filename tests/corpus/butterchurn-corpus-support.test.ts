import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';

const BUTTERCHURN_DIR = join(
  process.cwd(),
  'public',
  'milkdrop-presets',
  'butterchurn',
);

function loadButterchurnCorpus() {
  return readdirSync(BUTTERCHURN_DIR)
    .filter((file) => file.endsWith('.milk'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(BUTTERCHURN_DIR, file), 'latin1');
      return {
        file,
        compiled: compileMilkdropPresetSource(raw, {
          id: file.replace(/\.milk$/u, ''),
          origin: 'bundled',
        }),
      };
    });
}

describe('butterchurn preset corpus support', () => {
  test('all butterchurn presets are supported on both backends', () => {
    const corpus = loadButterchurnCorpus();

    expect(corpus.length).toBeGreaterThan(1700);

    const unsupported = corpus.filter(
      ({ compiled }) =>
        compiled.ir.compatibility.backends.webgl.status !== 'supported' ||
        compiled.ir.compatibility.backends.webgpu.status !== 'supported',
    );

    expect(unsupported.map(({ file }) => file)).toEqual([]);
  });
});
