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
    return {
      supported: false,
      state,
      reason: 'This browser cannot capture microphone audio.',
    };
  }

  if (state === 'denied') {
    return {
      supported: true,
      state,
      reason: 'Microphone access is blocked for this site.',
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
