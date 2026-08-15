import { afterEach, describe, expect, test } from 'bun:test';
import {
  clearCompiledPresetCache,
  compileMilkdropPresetSource,
  getCompiledPresetCacheSize,
  warmupCompiledPresetCache,
} from '../../src/js/milkdrop/compiler.ts';

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

    for (const preset of presets.slice(5).reverse()) {
      expect(compileMilkdropPresetSource(preset.source.raw)).toBe(preset);
    }

    expect(compileMilkdropPresetSource(presets[4].source.raw)).not.toBe(
      presets[4],
    );
    expect(getCompiledPresetCacheSize()).toBe(50);
  });
});
