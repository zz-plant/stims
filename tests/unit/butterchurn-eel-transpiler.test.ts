import { describe, expect, test } from 'bun:test';
import {
  transpileButterchurnEquations,
  transpileButterchurnPreset,
} from '../../scripts/butterchurn-eel-transpiler.ts';

function statements(source: string) {
  const result = transpileButterchurnEquations(source);
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.reason}`);
  }
  return result.statements;
}

describe('butterchurn equation transpiler', () => {
  test('converts scope assignments into EEL statements', () => {
    expect(statements('a.zoom=1.5;')).toEqual(['zoom = 1.5;']);
  });

  test('expands compound assignment', () => {
    expect(statements('a.zoom+=.1*a.rad;')).toEqual([
      'zoom = zoom + 0.1 * rad;',
    ]);
  });

  test('keeps parentheses only where precedence requires them', () => {
    expect(statements('a.x=(a.b+a.c)*a.d;')).toEqual(['x = (b + c) * d;']);
    expect(statements('a.y=a.b-(a.c-a.d);')).toEqual(['y = b - (c - d);']);
    expect(statements('a.z=a.b*a.c+a.d;')).toEqual(['z = b * c + d;']);
    expect(statements('a.w=a.b-a.c*a.d;')).toEqual(['w = b - c * d;']);
  });

  test('splits comma sequences into separate statements', () => {
    expect(statements('a.x=1,a.y=2;')).toEqual(['x = 1;', 'y = 2;']);
  });

  test('splits chained assignment into separate statements', () => {
    expect(statements('a.x=a.y=5;')).toEqual(['y = 5;', 'x = y;']);
  });

  test('maps Math calls and intrinsic helpers', () => {
    expect(statements('a.q1=Math.sin(a.time)+Math.abs(a.bass);')).toEqual([
      'q1 = sin(time) + abs(bass);',
    ]);
    expect(statements('a.q2=above(a.bass,0.5)+bnot(a.treb);')).toEqual([
      'q2 = above(bass, 0.5) + bnot(treb);',
    ]);
  });

  test('rewrites the guarded division helper as EEL division', () => {
    expect(statements('a.q1=div(a.bass,a.fps);')).toEqual(['q1 = bass / fps;']);
  });

  test('rewrites ternaries as if()', () => {
    expect(statements('a.q1=a.bass>0.5?1:0;')).toEqual([
      'q1 = if(bass > 0.5, 1, 0);',
    ]);
  });

  test('reads quoted scope properties that collide with JS keywords', () => {
    expect(statements('a["const"]=a["const"]+1;')).toEqual([
      'const = const + 1;',
    ]);
  });

  test('translates megabuf reads and writes', () => {
    expect(statements('a.megabuf[3]=a.megabuf[2]+1;')).toEqual([
      'megabuf(3) = megabuf(2) + 1;',
    ]);
  });

  test('normalises exponent literals into plain decimals', () => {
    expect(statements('a.q1=1E4;')).toEqual(['q1 = 10000;']);
  });

  test('reports loops as unsupported instead of mistranslating them', () => {
    const result = transpileButterchurnEquations('for(var b=0;3>b;b++)a.n+=1;');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('for');
    }
  });

  test('reports unknown functions as unsupported', () => {
    const result = transpileButterchurnEquations('a.q1=mystery(a.bass);');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('mystery');
    }
  });

  test('converts every equation block of a preset payload', () => {
    const converted = transpileButterchurnPreset({
      init_eqs_str: 'a.q1=0;',
      frame_eqs_str: 'a.q1=a.q1+1;',
      pixel_eqs_str: 'a.zoom=1+.1*a.rad;',
      waves: [{ point_eqs_str: 'a.x=a.sample;', frame_eqs_str: 'a.t1=a.q1;' }],
      shapes: [{ frame_eqs_str: 'a.rad=.1;' }],
    });

    expect(converted.init).toEqual(['q1 = 0;']);
    expect(converted.perFrame).toEqual(['q1 = q1 + 1;']);
    expect(converted.perPixel).toEqual(['zoom = 1 + 0.1 * rad;']);
    expect(converted.waves[0]?.perPoint).toEqual(['x = sample;']);
    expect(converted.waves[0]?.perFrame).toEqual(['t1 = q1;']);
    expect(converted.shapes[0]?.perFrame).toEqual(['rad = 0.1;']);
    expect(converted.unsupported).toEqual([]);
  });

  test('keeps translating other blocks when one block is unsupported', () => {
    const converted = transpileButterchurnPreset({
      frame_eqs_str: 'for(var b=0;3>b;b++)a.n+=1;',
      pixel_eqs_str: 'a.zoom=1;',
    });

    expect(converted.perFrame).toEqual([]);
    expect(converted.perPixel).toEqual(['zoom = 1;']);
    expect(converted.unsupported).toHaveLength(1);
    expect(converted.unsupported[0]?.scope).toBe('preset.per_frame');
  });
});
