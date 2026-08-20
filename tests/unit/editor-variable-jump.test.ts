import { describe, expect, test } from 'bun:test';
import {
  filterVariables,
  nextOccurrence,
  scanAssignedVariables,
} from '../../src/js/milkdrop/overlay/editor-variable-jump.ts';

const SOURCE = [
  'per_frame_1=zoom = zoom + 0.01*sin(time);',
  'per_frame_2=warp = 0.5;',
  'per_frame_3=zoom = zoom * decay;',
  'per_pixel_1=rot = rot + q1; // rot = dead comment assignment',
  'wave_0_per_point1=x = x + 0.1;',
  'a=1; b=2;',
  'cx = 0.5;',
].join('\n');

describe('scanAssignedVariables', () => {
  test('indexes assignment targets with line and column', () => {
    const vars = scanAssignedVariables(SOURCE);
    const zoom = vars.find((v) => v.name === 'zoom');
    expect(zoom?.occurrences).toEqual([
      { line: 1, column: 12 },
      { line: 3, column: 12 },
    ]);
  });

  test('most-assigned variables rank first', () => {
    const [first] = scanAssignedVariables(SOURCE);
    expect(first.name).toBe('zoom');
  });

  test('excludes .milk line keys', () => {
    const names = scanAssignedVariables(SOURCE).map((v) => v.name);
    expect(names).not.toContain('per_frame_1');
    expect(names).not.toContain('wave_0_per_point1');
  });

  test('ignores comments and comparisons', () => {
    const vars = scanAssignedVariables(
      'per_frame_1=x = if(equal(y,2), 3, 4); // y = 9\nper_frame_2=z = y == 2;',
    );
    const y = vars.find((v) => v.name === 'y');
    expect(y).toBeUndefined();
  });

  test('finds chained assignments on one line', () => {
    const names = scanAssignedVariables('per_frame_1=a = b = 3;').map(
      (v) => v.name,
    );
    expect(names).toContain('a');
    expect(names).toContain('b');
  });
});

describe('filterVariables', () => {
  const vars = scanAssignedVariables(SOURCE);

  test('empty query returns everything in rank order', () => {
    expect(filterVariables(vars, '')).toEqual(vars);
  });

  test('prefix beats substring beats subsequence', () => {
    const source = 'per_frame_1=wa = 1; swarm = 2; wxarxp = 3;';
    const filtered = filterVariables(scanAssignedVariables(source), 'wa').map(
      (v) => v.name,
    );
    // wa: prefix; swarm: substring ("wa" inside); wxarxp: subsequence (w…a).
    expect(filtered).toEqual(['wa', 'swarm', 'wxarxp']);
  });

  test('non-matching query yields nothing', () => {
    expect(filterVariables(vars, 'nonexistentvariable')).toEqual([]);
  });
});

describe('nextOccurrence', () => {
  const occurrences = [
    { line: 1, column: 12 },
    { line: 3, column: 12 },
  ];

  test('picks the first occurrence after the cursor', () => {
    expect(nextOccurrence(occurrences, 1, 12)).toEqual({
      line: 3,
      column: 12,
    });
  });

  test('wraps past the last occurrence', () => {
    expect(nextOccurrence(occurrences, 3, 12)).toEqual({
      line: 1,
      column: 12,
    });
  });

  test('cursor before everything lands on the first', () => {
    expect(nextOccurrence(occurrences, 1, 0)).toEqual({ line: 1, column: 12 });
  });

  test('empty occurrence list yields null', () => {
    expect(nextOccurrence([], 1, 0)).toBeNull();
  });
});
