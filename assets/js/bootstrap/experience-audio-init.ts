import type { CapabilityPreflightResult } from '../core/capability-preflight.ts';
import { isSmartTvDevice } from '../utils/device-detect.ts';

export function buildExperienceAudioInitState(
  result: CapabilityPreflightResult | null,
) {
  if (isSmartTvDevice()) {
    return {
      preferDemoAudio: true,
      initialStatus: {
        message:
          'TV mode enabled. Demo audio is selected first for easier remote setup, but microphone and tab audio are still available.',
        variant: 'success' as const,
      },
    };
  }

  if (!result) {
    return {};
  }

  const microphone = result.microphone;
  if (!microphone?.supported) {
    return {
      preferDemoAudio: true,
      initialStatus: {
        message:
          'Microphone access is unavailable in this browser. Use demo, tab, or YouTube audio to keep exploring.',
        variant: 'error' as const,
      },
    };
  }

  if (microphone.state === 'denied') {
    return {
      preferDemoAudio: true,
      initialStatus: {
        message:
          'Microphone access is blocked. Update permissions or use demo, tab, or YouTube audio to start the visuals.',
        variant: 'error' as const,
      },
    };
  }

  return {};
}
