import { Vector2 } from 'three';
import type { CanvasVideoExportRuntime } from '../../utils/media/canvas-video-exporter.ts';

type ExportRenderer = {
  getPixelRatio(): number;
  getSize(target: Vector2): unknown;
  setDrawingBufferSize?(
    width: number,
    height: number,
    pixelRatio: number,
  ): void;
  setPixelRatio(pixelRatio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
};

type ExportCamera = {
  aspect?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  updateProjectionMatrix?: () => void;
};

type ExportToy = {
  canvas: HTMLCanvasElement;
  renderer: ExportRenderer | null;
  rendererBackend: 'webgl' | 'webgpu' | null;
  viewportWidth: number;
  viewportHeight: number;
  camera: object;
  audioStream: MediaStream | null;
  beginNativeRendererCapture?: (
    width: number,
    height: number,
  ) => (() => void) | null;
};

function updateCamera(camera: ExportCamera, width: number, height: number) {
  const aspect = width / Math.max(1, height);
  if (typeof camera.aspect === 'number') {
    camera.aspect = aspect;
  } else if (
    typeof camera.left === 'number' &&
    typeof camera.right === 'number' &&
    typeof camera.top === 'number' &&
    typeof camera.bottom === 'number'
  ) {
    const halfWidth = Math.max(1, aspect);
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = 1;
    camera.bottom = -1;
  }
  camera.updateProjectionMatrix?.();
}

export function createVideoExportRuntime({
  getToy,
  resizeMilkdrop,
}: {
  getToy: () => ExportToy | null;
  resizeMilkdrop: (width: number, height: number) => void;
}): CanvasVideoExportRuntime {
  return {
    getAudioStream: () => getToy()?.audioStream ?? null,
    beginNativeCapture: ({ width, height }) => {
      const toy = getToy();
      const renderer = toy?.renderer;
      if (!toy || !renderer) {
        return {
          ok: false,
          reason: 'The visualizer renderer is not ready for native export.',
        };
      }

      const previousSize = new Vector2();
      renderer.getSize(previousSize);
      const previousPixelRatio = renderer.getPixelRatio();
      const previousViewport = {
        width: toy.viewportWidth,
        height: toy.viewportHeight,
      };
      const camera = toy.camera as ExportCamera;
      const previousCamera = {
        aspect: camera.aspect,
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
      };
      let restored = false;
      let managedRendererRestore: (() => void) | null = null;
      const usesManagedRenderer =
        typeof toy.beginNativeRendererCapture === 'function';

      const restore = () => {
        if (restored) return;
        restored = true;
        toy.viewportWidth = previousViewport.width;
        toy.viewportHeight = previousViewport.height;
        if (previousCamera.aspect !== undefined) {
          camera.aspect = previousCamera.aspect;
        }
        if (previousCamera.left !== undefined)
          camera.left = previousCamera.left;
        if (previousCamera.right !== undefined)
          camera.right = previousCamera.right;
        if (previousCamera.top !== undefined) camera.top = previousCamera.top;
        if (previousCamera.bottom !== undefined)
          camera.bottom = previousCamera.bottom;
        camera.updateProjectionMatrix?.();
        if (usesManagedRenderer) {
          managedRendererRestore?.();
        } else if (typeof renderer.setDrawingBufferSize === 'function') {
          renderer.setDrawingBufferSize(
            previousSize.x,
            previousSize.y,
            previousPixelRatio,
          );
        } else {
          renderer.setPixelRatio(previousPixelRatio);
          renderer.setSize(previousSize.x, previousSize.y, false);
        }
        resizeMilkdrop(previousViewport.width, previousViewport.height);
      };

      try {
        toy.viewportWidth = width;
        toy.viewportHeight = height;
        updateCamera(camera, width, height);
        if (usesManagedRenderer) {
          managedRendererRestore =
            toy.beginNativeRendererCapture?.(width, height) ?? null;
          if (!managedRendererRestore) {
            throw new Error('The renderer is already in a capture session.');
          }
        } else if (typeof renderer.setDrawingBufferSize === 'function') {
          renderer.setDrawingBufferSize(width, height, 1);
        } else {
          renderer.setPixelRatio(1);
          renderer.setSize(width, height, false);
        }
        resizeMilkdrop(width, height);
      } catch (error) {
        restore();
        return {
          ok: false,
          reason:
            error instanceof Error
              ? `Native video export failed: ${error.message}`
              : 'Native video export failed while resizing the renderer.',
        };
      }

      if (toy.canvas.width !== width || toy.canvas.height !== height) {
        restore();
        const backend = toy.rendererBackend === 'webgpu' ? 'WebGPU' : 'WebGL';
        return {
          ok: false,
          reason: `The active ${backend} backend could not allocate a native ${width} × ${height} recording surface.`,
        };
      }

      return { ok: true, restore };
    },
  };
}
