import {
  HalfFloatType,
  LinearFilter,
  type RenderTarget,
  type RenderTargetOptions,
  WebGLRenderTarget,
} from 'three';
import { RenderTarget as WebGPURenderTarget } from 'three/webgpu';

export type FeedbackRenderTargetBackend = 'webgl' | 'webgpu';

export type FeedbackRenderTargetOptions = {
  resolutionScale: number;
  useHalfFloatFeedback: boolean;
  samples: number;
};

export function createWebGLFeedbackRenderTarget(
  width: number,
  height: number,
  options: FeedbackRenderTargetOptions,
): WebGLRenderTarget {
  return createFeedbackRenderTarget(
    'webgl',
    width,
    height,
    options,
  ) as WebGLRenderTarget;
}

export function createFeedbackRenderTarget(
  backend: FeedbackRenderTargetBackend,
  width: number,
  height: number,
  {
    resolutionScale,
    useHalfFloatFeedback,
    samples,
  }: FeedbackRenderTargetOptions,
): RenderTarget {
  const scaledWidth = Math.max(1, Math.round(width * resolutionScale));
  const scaledHeight = Math.max(1, Math.round(height * resolutionScale));
  const options: RenderTargetOptions = {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    anisotropy: 4,
    ...(useHalfFloatFeedback
      ? {
          type: HalfFloatType,
        }
      : {}),
  };

  if (backend === 'webgpu') {
    const target = new WebGPURenderTarget(scaledWidth, scaledHeight, options);
    target.samples = samples;
    return target;
  }

  const target = new WebGLRenderTarget(scaledWidth, scaledHeight, options);
  target.samples = samples;
  return target;
}
