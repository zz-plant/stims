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
    // One definition + four call sites (quick fix, variation, blend, refine).
    expect(panelSource.split('proposeAssistedEdit').length - 1).toBe(5);
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

    const verified = probePresetReactivity(compiled, { verify: true });
    expect(verified.verdict).toBe('reactive');
    expect(verified.respondingVariables).toContain('zoom');
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

  test('the Generate panel labels static presets instead of blocking them', () => {
    const panelSource = readFileSync(
      path.join(root, 'src/js/frontend/SynthesizePanel.tsx'),
      'utf8',
    );
    expect(panelSource).toContain('probePresetReactivity');
    expect(panelSource).toContain('barely respond to audio');
  });
});
