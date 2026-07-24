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
}: {
  host: HTMLElement | null;
  canvas: HTMLCanvasElement;
  options: Partial<RendererInitConfig>;
  onReady?: (handle: RendererHandle | null) => void;
}) {
  let rendererHandle: RendererHandle | null = null;
  let rendererOptions = options;
  let viewportState: ToyViewportState | null = null;

  const ready = requestRenderer({
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
    rendererHandle.applySettings(rendererOptions, viewport);
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
    dispose: () => {
      rendererHandle?.renderer.setAnimationLoop?.(null);
      rendererHandle?.release();
      rendererHandle = null;
    },
  };
}
