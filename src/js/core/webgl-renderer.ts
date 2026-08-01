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
  const renderer = new WebGLRenderer({
    canvas,
    antialias,
    alpha,
    powerPreference,
    failIfMajorPerformanceCaveat,
    stencil,
    preserveDrawingBuffer,
  });
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const vsLog = gl.getShaderInfoLog(vs);
    const fsLog = gl.getShaderInfoLog(fs);
    const programLog = gl.getProgramInfoLog(program);
    console.error('[stims] Shader compile error', {
      vertexShader: vsLog,
      fragmentShader: fsLog,
      program: programLog,
    });
  };
  return renderer;
}
