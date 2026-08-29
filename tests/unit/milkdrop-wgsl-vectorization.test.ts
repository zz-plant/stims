import { describe, expect, test } from 'bun:test';
import {
  emitWgslVectorAssignment,
  fuseAdjacentWgslScalars,
} from '../../src/js/milkdrop/wgsl-vectorization.ts';

describe('WGSL vectorization helpers', () => {
  test('emits vector constructors for related scalar components', () => {
    expect(
      emitWgslVectorAssignment({
        target: 'uv',
        components: ['x + dx', 'y + dy'],
      }),
    ).toBe('uv = vec2f(x + dx, y + dy);');
  });

  test('fuses adjacent x/y assignments into a vec2 expression', () => {
    expect(
      fuseAdjacentWgslScalars([
        { target: 'warpUv.x', expression: 'x + ox' },
        { target: 'warpUv.y', expression: 'y + oy' },
        { target: 'zoom', expression: '1.0' },
      ]),
    ).toEqual([
      { target: 'warpUv', expression: 'vec2f(x + ox, y + oy)' },
      { target: 'zoom', expression: '1.0' },
    ]);
  });

  test('fuses adjacent color channels into vec3 and vec4 expressions', () => {
    expect(
      fuseAdjacentWgslScalars([
        { target: 'color.r', expression: '0.8' },
        { target: 'color.g', expression: '0.2' },
        { target: 'color.b', expression: '0.5' },
        { target: 'color.a', expression: '1.0' },
      ]),
    ).toEqual([{ target: 'color', expression: 'vec4f(0.8, 0.2, 0.5, 1.0)' }]);

    expect(
      fuseAdjacentWgslScalars([
        { target: 'light.x', expression: '1.0' },
        { target: 'light.y', expression: '2.0' },
        { target: 'light.z', expression: '3.0' },
      ]),
    ).toEqual([{ target: 'light', expression: 'vec3f(1.0, 2.0, 3.0)' }]);
  });
});
