import {
  HalfFloatType,
  LinearFilter,
  type RenderTargetOptions,
  WebGLRenderTarget,
} from 'three';

export type WebGLFeedbackRenderTargetOptions = {
  resolutionScale: number;
  useHalfFloatFeedback: boolean;
  samples: number;
};

export function createWebGLFeedbackRenderTarget(
  width: number,
  height: number,
  {
    resolutionScale,
    useHalfFloatFeedback,
    samples,
  }: WebGLFeedbackRenderTargetOptions,
) {
  const scaledWidth = Math.max(1, Math.round(width * resolutionScale));
  const scaledHeight = Math.max(1, Math.round(height * resolutionScale));
  const options: RenderTargetOptions = {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    ...(useHalfFloatFeedback
      ? {
          type: HalfFloatType,
        }
      : {}),
  };
  const target = new WebGLRenderTarget(scaledWidth, scaledHeight, options);
  target.samples = samples;
  return target;
}
