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
});
