/**
 * The program reference analysis against small programs whose reads and
 * writes are known: one IR rule per test — statement targets are writes,
 * expression identifiers are reads, alias spellings normalize, nested
 * assignment lvalues are writes and not reads, loop/while bodies and
 * conditions are walked, and megabuf stores are memory, not variables.
 */
import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../src/compiler.ts';
import { analyzeProgramReferences } from '../src/program-references.ts';

let serial = 0;
function analyze(lines: string[]) {
  const preset = compileMilkdropPresetSource(
    `[preset00]\n${lines.join('\n')}\n`,
    { id: `program-references-${serial++}` },
  );
  const { reads, writes } = analyzeProgramReferences(
    preset.ir.programs.perPixel,
  );
  return {
    reads: [...reads].sort(),
    writes: [...writes].sort(),
  };
}

describe('analyzeProgramReferences', () => {
  test('statement targets are writes, expression identifiers are reads', () => {
    expect(
      analyze(['per_pixel_1=zoom = zoom + 0.02*sin(rad*8 + time);']),
    ).toEqual({
      reads: ['rad', 'time', 'zoom'],
      writes: ['zoom'],
    });
  });

  test('alias spellings normalize to the canonical name', () => {
    expect(analyze(['per_pixel_1=q4 = fzoom + 1;'])).toEqual({
      reads: ['zoom'],
      writes: ['q4'],
    });
  });

  test('an assignment nested in an expression writes its lvalue only', () => {
    expect(analyze(['per_pixel_1=q4 = 1 + (rot = 0.2);'])).toEqual({
      reads: [],
      writes: ['q4', 'rot'],
    });
  });

  test('loop counts, conditions and bodies are all walked', () => {
    const result = analyze([
      'per_pixel_1=loop(3, zoom = zoom + sx);',
      'per_pixel_2=while(q1, dy = q2);',
    ]);
    expect(result.reads).toContain('zoom');
    expect(result.reads).toContain('sx');
    expect(result.reads).toContain('q1');
    expect(result.reads).toContain('q2');
    expect(result.writes).toEqual(['dy', 'zoom']);
  });

  test('megabuf stores are memory: the index is read, no variable written', () => {
    expect(analyze(['per_pixel_1=megabuf(q1) = q2;'])).toEqual({
      reads: ['q1', 'q2'],
      writes: [],
    });
  });

  test('megabuf reads walk the index expression', () => {
    expect(analyze(['per_pixel_1=q3 = megabuf(q1 + 1);'])).toEqual({
      reads: ['q1'],
      writes: ['q3'],
    });
  });

  test('an empty block references nothing', () => {
    expect(analyze(['per_frame_1=zoom = 1.02;'])).toEqual({
      reads: [],
      writes: [],
    });
  });
});
