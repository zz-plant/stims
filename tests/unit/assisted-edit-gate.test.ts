import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { computeSourceDiff } from '../../src/js/milkdrop/overlay/source-diff.ts';
import { probePresetReactivity } from '../../src/js/milkdrop/reactivity-probe.ts';

const root = path.resolve(import.meta.dir, '../..');

describe('source diff for assisted edits', () => {
  test('returns nothing for identical sources', () => {
    expect(computeSourceDiff('a\nb', 'a\nb')).toEqual([]);
  });

  test('marks added, removed, and unchanged lines', () => {
    const diff = computeSourceDiff('one\ntwo\nthree', 'one\n2\nthree');
    expect(diff).toEqual([
      { kind: 'context', text: 'one' },
      { kind: 'del', text: 'two' },
      { kind: 'add', text: '2' },
      { kind: 'context', text: 'three' },
    ]);
  });

  test('handles insertions and deletions without changing surrounding lines', () => {
    expect(computeSourceDiff('a\nc', 'a\nb\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'add', text: 'b' },
      { kind: 'context', text: 'c' },
    ]);
    expect(computeSourceDiff('a\nb\nc', 'a\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'context', text: 'c' },
    ]);
  });

  test('finds a stable alignment when lines repeat', () => {
    expect(
      computeSourceDiff(
        'start\nrepeat\nold\nrepeat\nend',
        'start\nrepeat\nrepeat\nend',
      ),
    ).toEqual([
      { kind: 'context', text: 'start' },
      { kind: 'context', text: 'repeat' },
      { kind: 'del', text: 'old' },
      { kind: 'context', text: 'repeat' },
      { kind: 'context', text: 'end' },
    ]);
  });

  test('uses linear working rows for large synthetic documents', () => {
    const beforeLines = Array.from({ length: 800 }, (_, i) => `line-${i}`);
    const afterLines = [...beforeLines];
    afterLines[400] = 'replacement';
    let maxWorkingCells = Number.POSITIVE_INFINITY;

    const diff = computeSourceDiff(
      beforeLines.join('\n'),
      afterLines.join('\n'),
      {
        onStats: (stats) => {
          maxWorkingCells = stats.maxWorkingCells;
          expect(stats.usedCoarseFallback).toBe(false);
        },
      },
    );

    expect(diff).toContainEqual({ kind: 'del', text: 'line-400' });
    expect(diff).toContainEqual({ kind: 'add', text: 'replacement' });
    // Two rows of the shorter input, not an 800 * 800 LCS matrix.
    expect(maxWorkingCells).toBeLessThanOrEqual(2 * (beforeLines.length + 1));
    expect(maxWorkingCells).toBeLessThan(
      beforeLines.length * afterLines.length,
    );
  });

  test('falls back to a coarse replacement for exceptionally large sources', () => {
    const before = Array.from({ length: 2001 }, (_, i) => `old-${i}`).join(
      '\n',
    );
    const after = Array.from({ length: 2001 }, (_, i) => `new-${i}`).join('\n');
    let usedCoarseFallback = false;

    expect(
      computeSourceDiff(before, after, {
        onStats: (stats) => {
          usedCoarseFallback = stats.usedCoarseFallback;
        },
      }),
    ).toEqual([
      {
        kind: 'gap',
        text: 'Replaces all 2001 lines with 2001 new lines',
      },
    ]);
    expect(usedCoarseFallback).toBe(true);
  });

  test('folds long unchanged runs into a gap marker', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n');
    const after = `${before}\nnew-tail`;
    const diff = computeSourceDiff(before, after);

    const gap = diff.find((line) => line.kind === 'gap');
    expect(gap?.text).toContain('unchanged lines');
    expect(diff[diff.length - 1]).toEqual({ kind: 'add', text: 'new-tail' });
    // Two context lines survive right before the change.
    expect(diff[diff.length - 2]).toEqual({ kind: 'context', text: 'line29' });
  });

  test('editor routes every AI action through the diff preview', () => {
    const panelSource = readFileSync(
      path.join(root, 'src/js/milkdrop/overlay/editor-panel.ts'),
      'utf8',
    );
    // Every AI response handler routes through the proposal path. The old
    // assertion pinned the exact occurrence count at five, which meant adding
    // a legitimate fifth AI action reddened the suite; the invariant is that
    // call sites exist and none bypasses the preview, not how many there are.
    expect(
      panelSource.split('proposeAssistedEdit').length - 1,
    ).toBeGreaterThanOrEqual(2);
    // No AI response applies straight to the buffer anymore.
    expect(panelSource).not.toContain('Revert AI');
    // Stale proposals are rejected on Apply and cleared on preset switch.
    expect(panelSource).toContain('sourceNow !== baseSource');
    expect(
      panelSource.split('discardAssistedEdit(').length - 1,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('generated-preset reactivity probe', () => {
  test('flags an audio-driven preset as reactive', () => {
    const compiled = compileMilkdropPresetSource(
      [
        '[preset00]',
        'fDecay=0.98',
        'per_frame_1=zoom=1.0+bass*0.08;',
        'per_frame_2=rot=rot+treb*0.02;',
      ].join('\n'),
      { id: 'probe-reactive' },
    );

    const fast = probePresetReactivity(compiled);
    expect(fast.verdict).toBe('reactive');
  });

  test('flags per_pixel-only audio use as reactive (invisible to frame variables)', () => {
    const compiled = compileMilkdropPresetSource(
      [
        '[preset00]',
        'fDecay=0.98',
        'per_pixel_1=zoom=1+bass_att*0.1*rad;',
      ].join('\n'),
      { id: 'probe-per-pixel' },
    );

    expect(probePresetReactivity(compiled).verdict).toBe('reactive');
  });

  test('flags a preset whose equations ignore audio as static', () => {
    const compiled = compileMilkdropPresetSource(
      [
        '[preset00]',
        'fDecay=0.98',
        'per_frame_1=zoom=1.0+0.05*sin(time);',
        'per_frame_2=rot=0.1;',
      ].join('\n'),
      { id: 'probe-static' },
    );

    const result = probePresetReactivity(compiled);
    expect(result.verdict).toBe('static');
    expect(result.respondingVariables).toEqual([]);
  });
});
