import { afterEach, describe, expect, test } from 'bun:test';
import {
  clearCompiledPresetCache,
  compileMilkdropPresetSource,
  getCompiledPresetCacheSize,
  warmupCompiledPresetCache,
} from '../src/compiler.ts';

describe('milkdrop compiled preset cache', () => {
  afterEach(() => {
    clearCompiledPresetCache();
  });

  test('warm-up retains only the 50 most recent unique presets', () => {
    const presets = Array.from({ length: 55 }, (_, index) => {
      const raw = `title=Cache Preset ${index}\nwave_r=${index}`;
      return compileMilkdropPresetSource(raw, {
        id: `cache-preset-${index}`,
        title: `Cache Preset ${index}`,
      });
    });

    warmupCompiledPresetCache(presets);

    expect(getCompiledPresetCacheSize()).toBe(50);

    const lookup = (preset: (typeof presets)[number]) =>
      compileMilkdropPresetSource(preset.source.raw, { id: preset.source.id });
    for (const preset of presets.slice(5).reverse()) {
      expect(lookup(preset)).toBe(preset);
    }

    expect(lookup(presets[4] as (typeof presets)[number])).not.toBe(presets[4]);
    expect(getCompiledPresetCacheSize()).toBe(50);
  });

  test('two presets with the same text keep their own ids', () => {
    const raw = 'title=Twin\nzoom=1.01\n';
    const a = compileMilkdropPresetSource(raw, { id: 'twin-a' });
    const b = compileMilkdropPresetSource(raw, { id: 'twin-b' });
    expect(a.source.id).toBe('twin-a');
    expect(b.source.id).toBe('twin-b');
    // Same id and text is still a cache hit.
    expect(compileMilkdropPresetSource(raw, { id: 'twin-a' })).toBe(a);
  });
});
