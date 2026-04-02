import { describe, expect, test } from 'bun:test';
import type { WebGLRenderer } from 'three';
import {
  resolveWebGLRenderer,
  shouldEnableMilkdropPostprocessingProfile,
  shouldRenderMilkdropPostprocessing,
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

  test('gates profile-driven postprocessing on backend and profile state', () => {
    expect(
      shouldEnableMilkdropPostprocessingProfile({ enabled: true } as never),
    ).toBe(true);
    expect(
      shouldEnableMilkdropPostprocessingProfile({ enabled: false } as never),
    ).toBe(false);

    const fakeWebGLRenderer = {
      capabilities: {},
      extensions: {},
    } as unknown as WebGLRenderer;

    expect(
      shouldRenderMilkdropPostprocessing({
        backend: 'webgl',
        renderer: fakeWebGLRenderer,
        profile: { enabled: true } as never,
      }),
    ).toBe(true);
    expect(
      shouldRenderMilkdropPostprocessing({
        backend: 'webgpu',
        renderer: fakeWebGLRenderer,
        profile: { enabled: true } as never,
      }),
    ).toBe(false);
    expect(
      shouldRenderMilkdropPostprocessing({
        backend: 'webgl',
        renderer: { capabilities: {} },
        profile: { enabled: true } as never,
      }),
    ).toBe(false);
    expect(
      shouldRenderMilkdropPostprocessing({
        backend: 'webgl',
        renderer: fakeWebGLRenderer,
        profile: { enabled: false } as never,
      }),
    ).toBe(false);
  });
});
