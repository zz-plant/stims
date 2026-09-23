import { describe, expect, test } from 'bun:test';
import { assembleMilkdropDirectFragmentShaders } from '../../src/js/milkdrop/feedback-manager-shared.ts';

/**
 * Names a direct shader body assigns without declaring are hoisted to
 * globals, sized from how they are first assigned. Only a swizzle at the top
 * level of the right-hand side is a size signal: one nested inside a call is
 * an argument, and the call's result decides the width.
 */
describe('direct-shader scratch hoisting', () => {
  const declarationOf = (body: string, name: string) =>
    assembleMilkdropDirectFragmentShaders(null, body).composite.match(
      new RegExp(`^\\s*(?:uniform\\s+)?(\\w+)\\s+${name};`, 'mu'),
    )?.[1];

  test('a swizzle inside a call does not size the result', () => {
    const body =
      'l2 = lum((texture2D(blur1Tex, sampleUv(vUv, textureWrap)).xyz * scale1 + bias1));\nret = vec3(l2);';
    expect(declarationOf(body, 'l2')).toBe('float');
  });

  test('a top-level swizzle still sizes it', () => {
    const body = 'd = vec4(1.0 / texelSize, texelSize).zw;\nret = vec3(d.x);';
    expect(declarationOf(body, 'd')).toBe('vec2');
  });

  test('a bare vector on the right-hand side sizes the scratch variable', () => {
    expect(declarationOf('d_uv = uv;\nret = vec3(d_uv, 0.0);', 'd_uv')).toBe(
      'vec2',
    );
    expect(
      declarationOf('uv1 = uv - vec2(0.5, q5);\nret = vec3(uv1, 0.0);', 'uv1'),
    ).toBe('vec2');
  });

  test('a copy of another scratch variable takes its width', () => {
    const body =
      'product = uv * 2.0;\ndenominator = product;\nret = vec3(denominator, 0.0);';
    expect(declarationOf(body, 'denominator')).toBe('vec2');
  });

  test('width-preserving calls and compound writes size the variable', () => {
    expect(
      declarationOf(
        'uvn = uv;\nrs = clamp(tan(z) * uvn, -5.0, 5.0);\nret = vec3(rs, 0.0);',
        'rs',
      ),
    ).toBe('vec2');
    expect(
      declarationOf(
        'mus = 1.0;\nmus *= vec3(1.1, 1.0, 0.95);\nret = mus;',
        'mus',
      ),
    ).toBe('vec3');
  });
});
