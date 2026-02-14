import { describe, expect, test } from 'bun:test';
import type { WebGLRenderer } from 'three';
import {
  resolveWebGLRenderer,
  supportsWebGLPostprocessing,
} from '../assets/js/core/postprocessing';

describe('postprocessing renderer selection', () => {
  test('supports postprocessing for webgl backend only', () => {
    expect(supportsWebGLPostprocessing('webgl')).toBe(true);
    expect(supportsWebGLPostprocessing('webgpu')).toBe(false);
    expect(supportsWebGLPostprocessing(null)).toBe(false);
  });

  test('resolves webgl renderer only when backend and renderer are compatible', () => {
    const fakeWebGLRenderer = {
      capabilities: {},
      extensions: {},
    } as unknown as WebGLRenderer;

    expect(resolveWebGLRenderer('webgl', fakeWebGLRenderer)).toBe(
      fakeWebGLRenderer,
    );
    expect(resolveWebGLRenderer('webgpu', fakeWebGLRenderer)).toBeNull();
    expect(resolveWebGLRenderer('webgl', { capabilities: {} })).toBeNull();
  });
});
