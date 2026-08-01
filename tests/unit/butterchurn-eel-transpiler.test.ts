import { describe, expect, test } from 'bun:test';
import { transpileButterchurnEquations } from '../../scripts/butterchurn-eel-transpiler';

describe('Butterchurn EEL Transpiler Loop & Control Flow Support', () => {
  test('transpiles JS for loops into EEL loop/while statements', () => {
    const js = 'for (var b = 0; b < 100; b++) { a.zoom += 0.01; }';
    const result = transpileButterchurnEquations(js);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.statements.join(' ')).toContain('loop(100,');
      expect(result.statements.join(' ')).toContain('zoom = zoom + 0.01;');
    }
  });

  test('transpiles JS while loops into EEL while statements', () => {
    const js = 'while (a.i < 10) { a.i += 1; }';
    const result = transpileButterchurnEquations(js);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.statements.join(' ')).toContain('while(');
      expect(result.statements.join(' ')).toContain('i = i + 1;');
    }
  });

  test('transpiles prefix and postfix increment operators', () => {
    const js = 'a.index++; ++a.count;';
    const result = transpileButterchurnEquations(js);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.statements[0]).toBe('index = index + 1;');
      expect(result.statements[1]).toBe('count = count + 1;');
    }
  });

  test('transpiles comma sequence calls in value position into exec2', () => {
    const js = 'a.x = (a.y = 2, a.z = 3);';
    const result = transpileButterchurnEquations(js);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.statements[0]).toContain('exec2(');
    }
  });

  test('transpiles do-while into an inline body plus a while loop', () => {
    const js =
      'var d = 0; do { d += 1; a.x = d; } while (0.00001 < Math.abs(c) && 1024 > d); a.y = 1;';
    const result = transpileButterchurnEquations(js);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const text = result.statements.join(' ');
      // Body runs once inline before the while loop repeats it.
      expect(text).toContain('d = d + 1; x = d;');
      expect(text).toContain(
        'while(0.00001 < abs(c) && 1024 > d, d = d + 1; x = d;);',
      );
      expect(text).toContain('y = 1;');
    }
  });

  test('drops butterchurn rkeys render-hint initialisers', () => {
    const empty = 'a.q1 = 1; a.rkeys = []; a.q2 = 2;';
    const split = 'a.q1 = 1; a.rkeys = "x1 y2 x3".split(" "); a.q2 = 2;';
    for (const js of [empty, split]) {
      const result = transpileButterchurnEquations(js);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const text = result.statements.join(' ');
        expect(text).not.toContain('rkeys');
        expect(text).toBe('q1 = 1; q2 = 2;');
      }
    }
  });
});
