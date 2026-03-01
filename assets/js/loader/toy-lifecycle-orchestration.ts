import { setAudioActive, setCurrentToy } from '../core/agent-api.ts';
import type { getRendererCapabilities } from '../core/renderer-capabilities.ts';
import type { ToyLifecycle } from '../core/toy-lifecycle.ts';
import type { createToyView } from '../toy-view.ts';
import { resetToyPictureInPicture } from '../utils/picture-in-picture';

type RendererCapabilities = Awaited<ReturnType<typeof getRendererCapabilities>>;

type LoaderView = ReturnType<typeof createToyView>;

export function createToyLifecycleOrchestration({
  lifecycle,
  view,
}: {
  lifecycle: ToyLifecycle;
  view: LoaderView;
}) {
  const updateRendererStatus = (
    capabilities: RendererCapabilities | null,
    onRetry?: () => void,
  ) => {
    view?.setRendererStatus?.(
      capabilities
        ? {
            backend: capabilities.preferredBackend,
            fallbackReason: capabilities.fallbackReason,
            shouldRetryWebGPU: capabilities.shouldRetryWebGPU,
            triedWebGPU: capabilities.triedWebGPU,
            onRetry,
          }
        : null,
    );
  };

  const disposeActiveToy = () => {
    if (typeof document !== 'undefined') {
      resetToyPictureInPicture(document);
    }
    lifecycle.disposeActiveToy();
    view?.clearActiveToyContainer?.();
    setCurrentToy(null);
    setAudioActive(false);
  };

  const removeEscapeHandler = () => lifecycle.removeEscapeHandler();
  const registerEscapeHandler = (onEscape: () => void) => {
    lifecycle.attachEscapeHandler(onEscape);
  };

  return {
    updateRendererStatus,
    disposeActiveToy,
    removeEscapeHandler,
    registerEscapeHandler,
  };
}
