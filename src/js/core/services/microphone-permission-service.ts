import { isInAppBrowser } from '../../utils/device-detect.ts';

export type MicrophonePermissionState =
  | PermissionState
  | 'unsupported'
  | 'unknown';

export async function queryMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  if (typeof navigator === 'undefined') {
    return 'unsupported';
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return 'unsupported';
  }

  if (!navigator.permissions?.query) {
    return 'unknown';
  }

  try {
    const result = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });
    return result.state;
  } catch (_error) {
    return 'unknown';
  }
}

export type MicrophoneCapability = {
  supported: boolean;
  state: MicrophonePermissionState;
  reason: string | null;
};

export function getMicrophoneCapabilityFromState(
  state: MicrophonePermissionState,
): MicrophoneCapability {
  if (state === 'unsupported') {
    const isHttpInsecure =
      typeof window !== 'undefined' &&
      (window.isSecureContext === false ||
        (window.location?.protocol === 'http:' &&
          window.location?.hostname !== 'localhost' &&
          window.location?.hostname !== '127.0.0.1'));
    const isAppBrowser = isInAppBrowser();

    return {
      supported: false,
      state,
      reason: isHttpInsecure
        ? 'Microphone access requires HTTPS or localhost. Non-secure HTTP addresses (e.g. LAN IPs) block audio capture.'
        : isAppBrowser
          ? "In-app browsers (Instagram, TikTok, Twitter) may block microphone capture. Tap '...' and select 'Open in Safari/Chrome'."
          : 'This browser cannot capture microphone audio.',
    };
  }

  if (state === 'denied') {
    return {
      supported: true,
      state,
      reason:
        'Microphone access is blocked. Please allow microphone access in site settings or OS Privacy Settings.',
    };
  }

  if (state === 'unknown') {
    return {
      supported: true,
      state,
      reason:
        'Unable to read microphone permission state. The browser will still prompt when needed.',
    };
  }

  return {
    supported: true,
    state,
    reason: null,
  };
}

export async function probeMicrophoneCapability(): Promise<MicrophoneCapability> {
  const state = await queryMicrophonePermissionState();
  return getMicrophoneCapabilityFromState(state);
}
