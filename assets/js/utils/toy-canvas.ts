import {
  type CanvasResizeOptions,
  setupCanvasResize,
} from './canvas-resize.ts';
import { clearError, showError } from './error-display.ts';

export type WebGLContextId = 'webgl' | 'webgl2' | 'experimental-webgl';

export interface ToyCanvasOptions extends CanvasResizeOptions {
  contextTypes?: WebGLContextId[];
  contextAttributes?: WebGLContextAttributes;
  errorElementId?: string;
  onError?: (message: string) => void;
}

export function createToyCanvas(
  canvasId: string,
  {
    contextTypes = ['webgl', 'experimental-webgl'],
    contextAttributes,
    errorElementId,
    onError,
    maxPixelRatio,
    onResize,
  }: ToyCanvasOptions = {},
) {
  const canvas = document.getElementById(canvasId);

  const reportError = (message: string) => {
    if (onError) {
      onError(message);
      return;
    }

    if (errorElementId) {
      showError(errorElementId, message);
    }
  };

  if (!(canvas instanceof HTMLCanvasElement)) {
    reportError('Canvas element is missing.');
    throw new Error(`Canvas element not found: ${canvasId}`);
  }

  const gl = contextTypes.reduce<
    WebGLRenderingContext | WebGL2RenderingContext | null
  >((context, type) => {
    if (context) return context;
    return canvas.getContext(type, contextAttributes) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
  }, null);

  if (!gl) {
    reportError('Unable to initialize WebGL. Your browser may not support it.');
    throw new Error('WebGL not supported');
  }

  if (errorElementId && !onError) {
    clearError(errorElementId);
  }

  const disposeResize = setupCanvasResize(canvas, gl, {
    maxPixelRatio,
    onResize,
  });

  return { canvas, gl, disposeResize };
}
