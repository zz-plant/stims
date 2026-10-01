/**
 * three.js caches an instanced geometry's instance cap the first time it
 * binds it and clamps every later draw to it. A segment batch that outgrew its
 * first buffer kept drawing only that many segments, so a denser wave after a
 * sparse one was cut off part-way; growing the buffer has to clear the cache.
 */
import { describe, expect, test } from 'bun:test';
import { InstancedBufferGeometry } from 'three';
import { ensureInstancedAttribute } from '../../src/js/milkdrop/renderer-adapter-shared.ts';

type Cached = InstancedBufferGeometry & { _maxInstanceCount?: number };

describe('ensureInstancedAttribute', () => {
  test('growing past the buffer clears the cached instance cap', () => {
    const geometry = new InstancedBufferGeometry() as Cached;
    ensureInstancedAttribute(geometry, 'instanceLine', 4, 100);
    // what WebGLBindingStates records on the first draw
    geometry._maxInstanceCount = 128;

    ensureInstancedAttribute(geometry, 'instanceLine', 4, 100);
    expect(geometry._maxInstanceCount).toBe(128);

    const grown = ensureInstancedAttribute(geometry, 'instanceLine', 4, 2000);
    expect(grown.count).toBeGreaterThanOrEqual(2000);
    expect(geometry._maxInstanceCount).toBeUndefined();
  });
});
