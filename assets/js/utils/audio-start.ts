import type { AudioInitOptions } from './audio-handler';

export type ToyAudioRequest =
  | boolean
  | (AudioInitOptions & {
      fallbackToSynthetic?: boolean;
      preferSynthetic?: boolean;
    })
  | undefined;

export function resolveToyAudioOptions(
  request: ToyAudioRequest,
  baseOptions: AudioInitOptions = {}
): AudioInitOptions & {
  fallbackToSynthetic?: boolean;
  preferSynthetic?: boolean;
} {
  if (typeof request === 'boolean') {
    return {
      ...baseOptions,
      fallbackToSynthetic: request || baseOptions.fallbackToSynthetic,
      preferSynthetic: request,
    };
  }

  if (!request) {
    return baseOptions;
  }

  const { fallbackToSynthetic, preferSynthetic, ...rest } = request;
  return {
    ...baseOptions,
    ...rest,
    fallbackToSynthetic,
    preferSynthetic,
  };
}
