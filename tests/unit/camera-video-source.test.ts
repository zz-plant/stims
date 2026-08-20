import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { importFresh } from '../test-helpers.ts';

type CameraModule =
  typeof import('../../src/js/core/services/camera-video-source.ts');

/** A MediaStreamTrack stub that records whether it was released. */
function makeTrack(kind: 'video' | 'audio' = 'video') {
  const listeners = new Map<string, () => void>();
  return {
    kind,
    readyState: 'live' as string,
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = 'ended';
    },
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, listener);
    },
    fire(type: string) {
      listeners.get(type)?.();
    },
  };
}

function makeStream(tracks = [makeTrack()]) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
  };
}

const originalMediaDevices = navigator.mediaDevices;

function installMediaDevices(overrides: Record<string, unknown>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: overrides,
    configurable: true,
    writable: true,
  });
}

let setStream: ReturnType<typeof mock>;
let clearStream: ReturnType<typeof mock>;
let hasStream = false;

async function loadCameraModule(): Promise<CameraModule> {
  setStream = mock(async () => {});
  clearStream = mock(() => {
    hasStream = false;
  });
  // Spread the real module rather than replacing it: mock.module swaps the
  // module registry entry process-wide, so returning only the three functions
  // this suite stubs left every OTHER suite importing that module with its
  // remaining exports missing.
  const actual = await import(
    '../../src/js/core/services/captured-video-texture.ts'
  );
  mock.module('../../src/js/core/services/captured-video-texture.ts', () => ({
    ...actual,
    setMilkdropCapturedVideoStream: (...args: unknown[]) => {
      hasStream = true;
      return setStream(...args);
    },
    clearMilkdropCapturedVideoStream: clearStream,
    hasActiveMilkdropCapturedVideoStream: () => hasStream,
  }));
  return importFresh<CameraModule>(
    '../../src/js/core/services/camera-video-source.ts',
  );
}

beforeEach(() => {
  hasStream = false;
});

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: originalMediaDevices,
    configurable: true,
    writable: true,
  });
  mock.restore();
});

describe('camera video source', () => {
  test('reports unsupported when the browser has no getUserMedia', async () => {
    installMediaDevices({});
    const mod = await loadCameraModule();
    expect(mod.isCameraVideoSupported()).toBe(false);
    await expect(mod.startCameraVideoSource()).rejects.toThrow(
      /cannot open a camera/i,
    );
  });

  test('routes the camera stream into the shared video texture', async () => {
    const stream = makeStream();
    installMediaDevices({ getUserMedia: async () => stream });
    const mod = await loadCameraModule();

    await mod.startCameraVideoSource();
    expect(setStream).toHaveBeenCalledTimes(1);
    expect(mod.isCameraVideoActive()).toBe(true);
  });

  test('requests a bounded resolution rather than whatever the camera offers', async () => {
    let constraints: MediaStreamConstraints | undefined;
    installMediaDevices({
      getUserMedia: async (c: MediaStreamConstraints) => {
        constraints = c;
        return makeStream();
      },
    });
    const mod = await loadCameraModule();
    await mod.startCameraVideoSource();

    const video = constraints?.video as MediaTrackConstraints;
    expect(video.width).toEqual({ ideal: 1280 });
    // Audio stays with the audio pipeline; a camera mic here would fight it.
    expect(constraints?.audio).toBe(false);
  });

  test('pins an explicit device id when one is given', async () => {
    let constraints: MediaStreamConstraints | undefined;
    installMediaDevices({
      getUserMedia: async (c: MediaStreamConstraints) => {
        constraints = c;
        return makeStream();
      },
    });
    const mod = await loadCameraModule();
    await mod.startCameraVideoSource({ deviceId: 'cam-2' });

    const video = constraints?.video as MediaTrackConstraints;
    expect(video.deviceId).toEqual({ exact: 'cam-2' });
  });

  test('stopping releases the device and clears the texture', async () => {
    const track = makeTrack();
    installMediaDevices({ getUserMedia: async () => makeStream([track]) });
    const mod = await loadCameraModule();

    await mod.startCameraVideoSource();
    mod.stopCameraVideoSource();

    expect(track.stopped).toBe(true);
    expect(clearStream).toHaveBeenCalledTimes(1);
    expect(mod.isCameraVideoActive()).toBe(false);
  });

  test('a track ended by the browser stops the source instead of freezing', async () => {
    const track = makeTrack();
    installMediaDevices({ getUserMedia: async () => makeStream([track]) });
    const mod = await loadCameraModule();

    await mod.startCameraVideoSource();
    // The user revoked the camera from the browser's own UI.
    track.fire('ended');

    expect(mod.isCameraVideoActive()).toBe(false);
    expect(clearStream).toHaveBeenCalled();
  });

  test('maps a denied permission to an actionable message', async () => {
    installMediaDevices({
      getUserMedia: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    });
    const mod = await loadCameraModule();

    await expect(mod.startCameraVideoSource()).rejects.toMatchObject({
      reason: 'denied',
    });
  });

  test('maps a busy device to the in-use reason', async () => {
    installMediaDevices({
      getUserMedia: async () => {
        throw new DOMException('busy', 'NotReadableError');
      },
    });
    const mod = await loadCameraModule();

    await expect(mod.startCameraVideoSource()).rejects.toMatchObject({
      reason: 'in-use',
    });
  });

  test('toggle starts when idle and stops when running', async () => {
    installMediaDevices({ getUserMedia: async () => makeStream() });
    const mod = await loadCameraModule();

    expect(await mod.toggleCameraVideoSource()).toBe(true);
    expect(await mod.toggleCameraVideoSource()).toBe(false);
  });

  test('lists only video inputs, labelling ones the browser leaves blank', async () => {
    installMediaDevices({
      getUserMedia: async () => makeStream(),
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'a', label: 'Front' },
        { kind: 'audioinput', deviceId: 'b', label: 'Mic' },
        { kind: 'videoinput', deviceId: 'c', label: '' },
      ],
    });
    const mod = await loadCameraModule();

    expect(await mod.listCameraVideoDevices()).toEqual([
      { deviceId: 'a', label: 'Front' },
      { deviceId: 'c', label: 'Camera 2' },
    ]);
  });
});
