import type { RendererInitConfig } from './renderer-setup.ts';
import {
  type RendererHandle,
  requestRenderer,
} from './services/render-service.ts';
import type { ToyViewportState } from './toy-viewport-session.ts';

export function createToyRendererSession({
  host,
  canvas,
  options,
  onReady,
  requestRendererImpl = requestRenderer,
}: {
  host: HTMLElement | null;
  canvas: HTMLCanvasElement;
  options: Partial<RendererInitConfig>;
  onReady?: (handle: RendererHandle | null) => void;
  requestRendererImpl?: typeof requestRenderer;
}) {
  let rendererHandle: RendererHandle | null = null;
  let rendererOptions = options;
  let viewportState: ToyViewportState | null = null;
  let captureViewport: { width: number; height: number } | null = null;

  const ready = requestRendererImpl({
    host,
    options,
    canvas,
  })
    .then((handle) => {
      rendererHandle = handle;
      onReady?.(handle);
      return handle;
    })
    .catch((error) => {
      console.warn('Renderer initialization failed.', error);
      onReady?.(null);
      return null;
    });

  const applySettings = (
    nextOptions?: Partial<RendererInitConfig>,
    nextViewport?: ToyViewportState | null,
  ) => {
    if (nextOptions) {
      rendererOptions = { ...rendererOptions, ...nextOptions };
    }
    if (nextViewport) {
      viewportState = nextViewport;
    }
    if (!rendererHandle) {
      return;
    }
    const viewport = viewportState
      ? {
          width: viewportState.width,
          height: viewportState.height,
        }
      : undefined;
    rendererHandle.applySettings(
      captureViewport
        ? {
            ...rendererOptions,
            maxPixelRatio: 1,
            renderScale: 1,
            adaptiveMaxPixelRatioMultiplier: 1,
            adaptiveRenderScaleMultiplier: 1,
          }
        : rendererOptions,
      captureViewport ?? viewport,
    );
  };

  return {
    ready,
    getHandle: () => rendererHandle,
    getOptions: () => rendererOptions,
    setViewport: (nextViewport: ToyViewportState) => {
      viewportState = nextViewport;
      applySettings();
    },
    applySettings,
    updateOptions: (nextOptions: Partial<RendererInitConfig>) => {
      rendererOptions = { ...rendererOptions, ...nextOptions };
      applySettings();
    },
    beginNativeCapture: (width: number, height: number) => {
      if (!rendererHandle || captureViewport) {
        return null;
      }
      captureViewport = { width, height };
      applySettings();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        captureViewport = null;
        applySettings();
      };
    },
    dispose: () => {
      captureViewport = null;
      rendererHandle?.renderer.setAnimationLoop?.(null);
      rendererHandle?.release();
      rendererHandle = null;
    },
  };
}
