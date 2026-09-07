/**
 * The compiled-preset cache hands back a SHARED object.
 *
 * `compileMilkdropPresetSource` memoises on raw source, so two calls with the
 * same text return the same `MilkdropCompiledPreset` — including the same
 * `ir.numericFields`. Any tool that pokes a field to see what changes is
 * therefore editing every later caller's preset too.
 *
 * That is not hypothetical. The first version of `lab:sensitivity` perturbed
 * fields this way and reported an identical non-zero sensitivity for 1579
 * unrelated parameters: each run inherited every prior perturbation, so the
 * number it printed was the accumulated leak rather than the parameter under
 * test. The tell was that unrelated fields agreed to four significant figures.
 *
 * These tests pin the sharing (so nobody "fixes" it by accident and slows the
 * hot path) and pin the escape hatch that makes differential probes valid.
 */
import { describe, expect, test } from 'bun:test';
import {
  clearCompiledPresetCache,
  compileMilkdropPresetSource,
} from '../../src/js/milkdrop/compiler.ts';

const SOURCE = ['title=cache probe', 'per_frame_1=zoom=zoom+0;'].join('\n');

describe('compiled preset cache mutation', () => {
  test('two compiles of identical source share one IR object', () => {
    clearCompiledPresetCache();
    const a = compileMilkdropPresetSource(SOURCE, { id: 'probe' });
    const b = compileMilkdropPresetSource(SOURCE, { id: 'probe' });
    expect(b).toBe(a);
    expect(b.ir.numericFields).toBe(a.ir.numericFields);
  });

  test('mutating a returned IR leaks into the next compile', () => {
    clearCompiledPresetCache();
    const first = compileMilkdropPresetSource(SOURCE, { id: 'probe' });
    const original = first.ir.numericFields.zoom as number;
    first.ir.numericFields.zoom = original + 7;

    const second = compileMilkdropPresetSource(SOURCE, { id: 'probe' });
    // This is the trap, asserted so it stays visible rather than surprising
    // the next person who writes a differential probe.
    expect(second.ir.numericFields.zoom).toBe(original + 7);
  });

  test('clearing the cache isolates successive probes', () => {
    clearCompiledPresetCache();
    const first = compileMilkdropPresetSource(SOURCE, { id: 'probe' });
    const original = first.ir.numericFields.zoom as number;
    first.ir.numericFields.zoom = original + 7;

    clearCompiledPresetCache();
    const fresh = compileMilkdropPresetSource(SOURCE, { id: 'probe' });
    expect(fresh.ir.numericFields.zoom).toBe(original);
  });
});
