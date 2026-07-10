import { describe, expect, test } from 'bun:test';
import {
  emitWgslVectorAssignment,
  fuseAdjacentWgslScalars,
} from '../assets/js/milkdrop/wgsl-vectorization.ts';

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
});
