import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { buildPresetOutline } from '../../src/js/milkdrop/preset-outline.ts';

const byLabel = (source: string) =>
  Object.fromEntries(buildPresetOutline(source).map((e) => [e.label, e]));

describe('preset outline', () => {
  test('splits a buffer into its editable parts with line ranges', () => {
    const outline = byLabel(
      [
        '[preset00]',
        'zoom=1.01',
        'rot=0.1',
        'wavecode_0_enabled=1',
        'per_frame_init_1=flip=1',
        'per_frame_1=zoom = zoom + 0.01;',
        'per_frame_2=rot = rot + 0.01;',
        'per_pixel_1=rot = rot + rad;',
        'wave_0_per_point1=x = sample;',
        'shapecode_1_sides=4',
        'shape_1_per_frame1=rad = 0.5;',
      ].join('\n'),
    );
    expect(outline.Settings).toMatchObject({
      firstLine: 2,
      lastLine: 3,
      lines: 2,
    });
    expect(outline['Init (per_frame_init)']?.firstLine).toBe(5);
    expect(outline['Per-frame equations']).toMatchObject({
      firstLine: 6,
      lastLine: 7,
      lines: 2,
    });
    expect(outline['Per-pixel equations']?.firstLine).toBe(8);
    expect(outline['wave_0 settings']?.firstLine).toBe(4);
    expect(outline['wave_0 per-point']?.firstLine).toBe(9);
    expect(outline['shape_1 settings']?.firstLine).toBe(10);
    expect(outline['shape_1 per-frame']?.firstLine).toBe(11);
  });

  test('parts come back in the order they appear in the buffer', () => {
    const lines = buildPresetOutline(
      'per_pixel_1=a=1;\nzoom=1\nper_frame_1=b=2;',
    ).map((entry) => entry.firstLine);
    expect(lines).toEqual([1, 2, 3]);
  });

  test('a shader section owns every line under its header, even ones starting #', () => {
    const outline = byLabel(
      [
        'zoom=1',
        '[comp_shader]',
        '#define sat saturate',
        'shader_body {',
        '}',
      ].join('\n'),
    );
    expect(outline['Composite shader']).toMatchObject({
      firstLine: 2,
      lastLine: 5,
      lines: 4,
    });
  });

  test('backtick-style comp_N and warp_N lines are the shaders too', () => {
    const outline = byLabel('warp_1=`shader_body\ncomp_1=`shader_body\n');
    expect(outline['Warp shader']?.firstLine).toBe(1);
    expect(outline['Composite shader']?.firstLine).toBe(2);
  });

  test('comments and blank lines belong to nothing', () => {
    expect(buildPresetOutline('// hi\n\n; note\n')).toEqual([]);
  });

  test('every line the compiler reads as an assignment lands in some part', () => {
    const source = readFileSync(
      'public/milkdrop-presets/krash-rovastar-cerebral-demons-stars.milk',
      'utf8',
    );
    expect(() =>
      compileMilkdropPresetSource(source, { id: 'outline' }),
    ).not.toThrow();
    const outline = buildPresetOutline(source);
    const labels = outline.map((entry) => entry.label);
    expect(labels).toContain('Per-frame equations');
    expect(labels).toContain('Per-pixel equations');
    expect(labels).toContain('wave_0 per-point');
    expect(labels).toContain('shape_0 per-frame');
    // Ranges never overlap backwards: firstLine <= lastLine, and lines fit.
    for (const entry of outline) {
      expect(entry.lastLine).toBeGreaterThanOrEqual(entry.firstLine);
      expect(entry.lines).toBeLessThanOrEqual(
        entry.lastLine - entry.firstLine + 1,
      );
    }
  });

  test('init_N lines (the older Stims spelling) are the init part', () => {
    expect(buildPresetOutline('init_1=a=1;')[0]?.kind).toBe('init');
  });
});
