export type CanvasContext =
  | CanvasRenderingContext2D
  | WebGLRenderingContext
  | WebGL2RenderingContext;

export interface CanvasResizeOptions {
  maxPixelRatio?: number;
  onResize?: (dimensions: {
    width: number;
    height: number;
    cssWidth: number;
    cssHeight: number;
    pixelRatio: number;
  }) => void;
}

export function setupCanvasResize(
  canvas: HTMLCanvasElement,
  context: CanvasContext,
  { maxPixelRatio, onResize }: CanvasResizeOptions = {}
) {
  const resize = () => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio ?? window.devicePixelRatio || 1);
    const cssWidth = window.innerWidth;
    const cssHeight = window.innerHeight;
    const width = Math.max(1, Math.floor(cssWidth * pixelRatio));
    const height = Math.max(1, Math.floor(cssHeight * pixelRatio));

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    if ('viewport' in context && typeof context.viewport === 'function') {
      const viewportWidth =
        'drawingBufferWidth' in context && typeof context.drawingBufferWidth === 'number'
          ? context.drawingBufferWidth
          : width;
      const viewportHeight =
        'drawingBufferHeight' in context && typeof context.drawingBufferHeight === 'number'
          ? context.drawingBufferHeight
          : height;

      context.viewport(0, 0, viewportWidth, viewportHeight);
    } else {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    onResize?.({ width, height, cssWidth, cssHeight, pixelRatio });
  };

  resize();
  window.addEventListener('resize', resize);

  return () => window.removeEventListener('resize', resize);
}
