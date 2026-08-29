import { describe, expect, test } from 'bun:test';
import { HalfFloatType, LinearFilter, UnsignedByteType } from 'three';
import {
  createFeedbackRenderTarget,
  createWebGLFeedbackRenderTarget,
} from '../../src/js/milkdrop/feedback-render-targets.ts';

describe('milkdrop feedback render targets', () => {
  test('scales webgl feedback targets and applies texture precision settings', () => {
    const target = createWebGLFeedbackRenderTarget(13, 7, {
      resolutionScale: 0.5,
      useHalfFloatFeedback: true,
      samples: 4,
    });

    expect(target.width).toBe(7);
    expect(target.height).toBe(4);
    expect(target.samples).toBe(4);
    expect(target.texture.minFilter).toBe(LinearFilter);
    expect(target.texture.magFilter).toBe(LinearFilter);
    expect(target.texture.type).toBe(HalfFloatType);

    target.dispose();
  });

  test('keeps byte precision as the default webgl feedback texture type', () => {
    const target = createWebGLFeedbackRenderTarget(2, 2, {
      resolutionScale: 1,
      useHalfFloatFeedback: false,
      samples: 0,
    });

    expect(target.texture.type).toBe(UnsignedByteType);

    target.dispose();
  });

  test('createFeedbackRenderTarget instantiates backend-aware targets', () => {
    const webglTarget = createFeedbackRenderTarget('webgl', 100, 50, {
      resolutionScale: 1,
      useHalfFloatFeedback: false,
      samples: 2,
    });
    expect(webglTarget.width).toBe(100);
    expect(webglTarget.height).toBe(50);
    expect(webglTarget.samples).toBe(2);
    webglTarget.dispose();

    const webgpuTarget = createFeedbackRenderTarget('webgpu', 100, 50, {
      resolutionScale: 0.5,
      useHalfFloatFeedback: true,
      samples: 0,
    });
    expect(webgpuTarget.width).toBe(50);
    expect(webgpuTarget.height).toBe(25);
    webgpuTarget.dispose();
  });
});
