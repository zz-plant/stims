/**
 * Webcam as a visual input.
 *
 * The captured-video pipeline (captured-video-texture.ts, the `videoTex`
 * sampler on both backends, and the captured-video reactivity tracker) was
 * only ever fed by `getDisplayMedia` — tab and screen capture — so the many
 * MilkDrop presets that sample `sampler_video` had no way to see a camera.
 * A camera is just another MediaStream, so this hands one to the same
 * `setMilkdropCapturedVideoStream` entry point the capture flow uses.
 *
 * Deliberately independent of the audio source: pointing a camera at the room
 * while the music comes from the tab, a mic, or the demo track is the normal
 * case, not an exception.
 */

import {
  clearMilkdropCapturedVideoStream,
  hasActiveMilkdropCapturedVideoStream,
  setMilkdropCapturedVideoStream,
} from './captured-video-texture.ts';

export type CameraVideoDevice = {
  deviceId: string;
  label: string;
};

export type CameraVideoOptions = {
  /** Pin a specific camera; omit to let the browser choose. */
  deviceId?: string;
  /** 'user' is the selfie camera, 'environment' the rear one. Phones only. */
  facingMode?: 'user' | 'environment';
};

/**
 * Distinguishes the ways a camera request can fail, so callers can say
 * something useful instead of "camera failed". Mirrors the shape
 * audio-handler.ts uses for microphone errors.
 */
export type CameraVideoErrorReason =
  | 'unsupported'
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'failed';

export class CameraVideoError extends Error {
  readonly reason: CameraVideoErrorReason;
  constructor(reason: CameraVideoErrorReason, message: string) {
    super(message);
    this.name = 'CameraVideoError';
    this.reason = reason;
  }
}

let activeCameraStream: MediaStream | null = null;

export function isCameraVideoSupported(): boolean {
  // getUserMedia's presence is the whole test: no engine ships it without
  // MediaStream, and probing for the constructor as well only made this
  // untestable outside a full browser.
  return (
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  );
}

/** True while a camera — specifically, not a screen capture — is feeding the
 * preset. Kept separate from `hasActiveMilkdropCapturedVideoStream` so the UI
 * can tell "camera on" from "sharing a tab". */
export function isCameraVideoActive(): boolean {
  return (
    activeCameraStream
      ?.getVideoTracks()
      .some((track) => track.readyState === 'live') ?? false
  );
}

/**
 * Cameras are only enumerable with labels once permission has been granted;
 * before that the browser returns entries with empty labels. Callers should
 * treat an empty list as "ask first, then enumerate".
 */
export async function listCameraVideoDevices(): Promise<CameraVideoDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));
  } catch {
    return [];
  }
}

function describeCameraError(error: unknown): CameraVideoError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new CameraVideoError(
      'denied',
      'Camera access was blocked. Allow it in the browser’s site settings, then try again.',
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new CameraVideoError(
      'not-found',
      'No camera matched. Check that one is connected and not disabled.',
    );
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new CameraVideoError(
      'in-use',
      'The camera is already in use by another app. Close that app and try again.',
    );
  }
  return new CameraVideoError('failed', 'Could not start the camera.');
}

/**
 * Opens a camera and routes it into the preset's video texture. Resolves once
 * the stream is handed over; the texture itself goes live a frame or two
 * later, which `isMilkdropCapturedVideoReady()` reports.
 */
export async function startCameraVideoSource(
  options: CameraVideoOptions = {},
): Promise<MediaStream> {
  if (!isCameraVideoSupported()) {
    throw new CameraVideoError(
      'unsupported',
      'This browser cannot open a camera.',
    );
  }

  // Swap cleanly rather than stacking streams — two live cameras would both
  // hold the device and only one can reach the texture.
  stopCameraVideoSource({ keepTexture: true });

  const video: MediaTrackConstraints = {
    // A preset samples this as a texture at feedback resolution, so a 4K
    // camera costs upload bandwidth for detail nothing can show.
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
  if (options.deviceId) {
    video.deviceId = { exact: options.deviceId };
  } else if (options.facingMode) {
    video.facingMode = { ideal: options.facingMode };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (error) {
    throw describeCameraError(error);
  }

  activeCameraStream = stream;
  // The user can revoke the camera from the browser's own UI; without this
  // the texture would freeze on the last frame with no way back.
  for (const track of stream.getVideoTracks()) {
    track.addEventListener('ended', () => {
      if (activeCameraStream === stream) stopCameraVideoSource();
    });
  }

  try {
    await setMilkdropCapturedVideoStream(stream);
  } catch (error) {
    stopCameraVideoSource();
    throw error;
  }
  return stream;
}

/**
 * Stops the camera and releases the device (the indicator light goes out).
 * `keepTexture` is for the internal swap path only — an external caller
 * always wants the preset to stop sampling a dead stream too.
 */
export function stopCameraVideoSource({
  keepTexture = false,
}: {
  keepTexture?: boolean;
} = {}): void {
  const stream = activeCameraStream;
  activeCameraStream = null;
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  if (!keepTexture && stream && hasActiveMilkdropCapturedVideoStream()) {
    clearMilkdropCapturedVideoStream();
  }
}

/** Start if idle, stop if running. Returns the resulting state. */
export async function toggleCameraVideoSource(
  options: CameraVideoOptions = {},
): Promise<boolean> {
  if (isCameraVideoActive()) {
    stopCameraVideoSource();
    return false;
  }
  await startCameraVideoSource(options);
  return true;
}
