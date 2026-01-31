import type { ToyRuntimeInstance } from '../core/toy-runtime';
import type { ToyAudioRequest } from './audio-start';

type RuntimeAudioHandlerOptions = {
  runtime: ToyRuntimeInstance;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  onFallback?: (error: unknown) => Promise<unknown> | unknown;
};

export function createRuntimeAudioStarter({
  runtime,
  onSuccess,
  onError,
  onFallback,
}: RuntimeAudioHandlerOptions) {
  return async (request: ToyAudioRequest = false) => {
    try {
      const result = await runtime.startAudio(request);
      onSuccess?.();
      return result;
    } catch (error) {
      onError?.(error);
      if (onFallback) {
        return await onFallback(error);
      }
      throw error;
    }
  };
}
