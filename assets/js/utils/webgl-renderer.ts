import { WebGLRenderer } from 'three';

export type WebGLRendererConfig = {
  canvas?: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
  powerPreference?: WebGLPowerPreference;
  failIfMajorPerformanceCaveat?: boolean;
  stencil?: boolean;
  preserveDrawingBuffer?: boolean;
};

export function createWebGLRenderer({
  canvas,
  antialias = true,
  alpha = false,
  powerPreference = 'default',
  failIfMajorPerformanceCaveat = false,
  stencil = true,
  preserveDrawingBuffer = false,
}: WebGLRendererConfig = {}) {
  return new WebGLRenderer({
    canvas,
    antialias,
    alpha,
    powerPreference,
    failIfMajorPerformanceCaveat,
    stencil,
    preserveDrawingBuffer,
  });
}
