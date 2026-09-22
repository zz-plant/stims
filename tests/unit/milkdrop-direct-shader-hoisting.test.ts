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
});
