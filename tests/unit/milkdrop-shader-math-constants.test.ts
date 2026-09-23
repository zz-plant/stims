import { describe, expect, test } from 'bun:test';
import { assembleMilkdropDirectFragmentShaders } from '../../src/js/milkdrop/feedback-manager-shared.ts';
import {
  evaluateMilkdropShaderExpression,
  parseMilkdropShaderStatement,
} from '../../src/js/milkdrop/shader-ast.ts';

/**
 * MilkDrop 2's shader preamble (include.fx) defines M_PI, M_PI_2 and
 * M_INV_PI_2, and presets use them undeclared. M_PI_2 is 2*pi there, not
 * C's pi/2. Missing, the assembler hoisted each as a zero uniform.
 */
describe('MilkDrop shader math constants', () => {
  test('the assembled shader defines them instead of hoisting zero uniforms', () => {
    const { composite } = assembleMilkdropDirectFragmentShaders(
      null,
      'ret = vec3(cos(ang * M_INV_PI_2 * M_PI_2) + M_PI);',
    );
    expect(composite).not.toMatch(/uniform float M_/u);
    expect(composite).toMatch(/#define M_PI_2 6\.28318530718/u);
  });

  test('the scalar evaluator knows them, with M_PI_2 = 2*pi', () => {
    const value = (source: string) => {
      const statement = parseMilkdropShaderStatement(`x = ${source}`);
      if (!statement) throw new Error(source);
      const result = evaluateMilkdropShaderExpression(
        statement.expression,
        {},
        {},
      );
      return result?.kind === 'scalar' ? result.value : Number.NaN;
    };
    expect(value('M_PI')).toBeCloseTo(Math.PI, 9);
    expect(value('M_PI_2')).toBeCloseTo(Math.PI * 2, 9);
    expect(value('M_INV_PI_2 * M_PI_2')).toBeCloseTo(1, 9);
  });
});
