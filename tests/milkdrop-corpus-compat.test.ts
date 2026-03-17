import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';

function loadBundledPresetCorpus() {
  const dir = join(process.cwd(), 'public', 'milkdrop-presets');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.milk'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), 'utf8');
      return {
        file,
        compiled: compileMilkdropPresetSource(raw, {
          id: basename(file, '.milk'),
          title: file,
          origin: 'bundled',
        }),
      };
    });
}

describe('milkdrop bundled preset corpus', () => {
  test('keeps the bundled preset corpus fully supported on both backends', () => {
    const corpus = loadBundledPresetCorpus();

    expect(corpus.length).toBe(30);

    const unsupported = corpus.filter(({ compiled }) => {
      return (
        compiled.ir.compatibility.backends.webgl.status !== 'supported' ||
        compiled.ir.compatibility.backends.webgpu.status !== 'supported'
      );
    });

    expect(unsupported).toEqual([]);
  });

  test('keeps the feedback-heavy curated presets in the supported bucket', () => {
    const corpus = loadBundledPresetCorpus();
    const targets = [
      'aurora-feedback-core.milk',
      'kinetic-grid-pulse.milk',
      'low-motion-halo-drift.milk',
      'prism-drum-tunnel.milk',
    ];

    const selected = corpus.filter(({ file }) => targets.includes(file));
    expect(selected).toHaveLength(targets.length);

    selected.forEach(({ compiled }) => {
      expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
      expect(compiled.ir.compatibility.backends.webgpu.status).toBe(
        'supported',
      );
      expect(compiled.ir.compatibility.unsupportedKeys).toEqual([]);
      expect(compiled.ir.compatibility.blockingReasons).toEqual([]);
    });
  });
});
