import { describe, expect, it } from 'bun:test';
import {
  aliasMap,
  resolveMilkdropIdentifier,
} from '../../src/js/milkdrop/field-normalization.ts';

describe('Stem-Aware Audio Reactivity Engine', () => {
  it('registers stem_bass, stem_drums, stem_vocals, and stem_synths in field alias map', () => {
    expect(aliasMap.stem_bass).toBe('stem_bass');
    expect(aliasMap.stembass).toBe('stem_bass');
    expect(aliasMap.stem_drums).toBe('stem_drums');
    expect(aliasMap.stemdrums).toBe('stem_drums');
    expect(aliasMap.stem_vocals).toBe('stem_vocals');
    expect(aliasMap.stemvocals).toBe('stem_vocals');
    expect(aliasMap.stem_synths).toBe('stem_synths');
    expect(aliasMap.stemsynths).toBe('stem_synths');
  });

  it('resolves stem identifiers correctly from environment dictionary', () => {
    const env = {
      stem_bass: 0.85,
      stem_drums: 0.92,
      stem_vocals: 0.45,
      stem_synths: 0.68,
    };

    expect(resolveMilkdropIdentifier(env, 'stemBass')).toBe(0.85);
    expect(resolveMilkdropIdentifier(env, 'stem_bass')).toBe(0.85);
    expect(resolveMilkdropIdentifier(env, 'stemDrums')).toBe(0.92);
    expect(resolveMilkdropIdentifier(env, 'stem_drums')).toBe(0.92);
    expect(resolveMilkdropIdentifier(env, 'stemVocals')).toBe(0.45);
    expect(resolveMilkdropIdentifier(env, 'stem_vocals')).toBe(0.45);
    expect(resolveMilkdropIdentifier(env, 'stemSynths')).toBe(0.68);
    expect(resolveMilkdropIdentifier(env, 'stem_synths')).toBe(0.68);
  });
});
