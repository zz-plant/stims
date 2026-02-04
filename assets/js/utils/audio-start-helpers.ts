import type { ToyRuntimeInstance } from '../core/toy-runtime';
import type { ToyAudioRequest } from './audio-start';

type RuntimeAudioHandlerOptions = {
  runtime: ToyRuntimeInstance;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  onFallback?: (
    error: unknown,
  ) =>
    | Promise<RuntimeAudioStartFallbackResult>
    | RuntimeAudioStartFallbackResult;
};

type RuntimeAudioStartResult = Awaited<
  ReturnType<ToyRuntimeInstance['startAudio']>
>;
type RuntimeAudioStartFallbackResult = RuntimeAudioStartResult | null;
type RuntimeAudioStarter = (
  request?: ToyAudioRequest,
) => Promise<RuntimeAudioStartFallbackResult>;

export function createRuntimeAudioStarter({
  runtime,
  onSuccess,
  onError,
  onFallback,
}: RuntimeAudioHandlerOptions): RuntimeAudioStarter {
  const runFallback = async (error: unknown) => {
    if (onFallback) {
      return await onFallback(error);
    }
    throw error;
  };

  return async (request: ToyAudioRequest = false) => {
    try {
      const result = await runtime.startAudio(request);
      onSuccess?.();
      return result;
    } catch (error) {
      onError?.(error);
      return await runFallback(error);
    }
  };
}
