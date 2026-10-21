import { afterEach, describe, expect, test } from 'bun:test';
import { captureDisplayAudioStream } from '../../src/js/ui/audio-advanced-sources.ts';

type FakeTrack = {
  kind: 'audio' | 'video';
  displaySurface?: string;
  stop: () => void;
  getSettings: () => { displaySurface?: string };
  addEventListener: (type: string, listener: () => void) => void;
  fire: (type: string) => void;
};

function createTrack(kind: 'audio' | 'video', displaySurface?: string) {
  const listeners = new Map<string, Array<() => void>>();
  const track: FakeTrack = {
    kind,
    displaySurface,
    stop: () => {},
    getSettings: () => (displaySurface ? { displaySurface } : {}),
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    fire: (type) => {
      listeners.get(type)?.forEach((listener) => {
        listener();
      });
    },
  };
  return track;
}

function createStream(tracks: FakeTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
  } as unknown as MediaStream;
}

const originalMediaDevices = navigator.mediaDevices;

function installGetDisplayMedia(
  handler: (constraints: unknown) => Promise<MediaStream>,
) {
  const calls: unknown[] = [];
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getDisplayMedia: (constraints: unknown) => {
        calls.push(constraints);
        return handler(constraints);
      },
    },
  });
  return calls;
}

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: originalMediaDevices,
  });
});

describe('captureDisplayAudioStream', () => {
  test('pre-selects this tab when the caller hosts the audio', async () => {
    const calls = installGetDisplayMedia(async () =>
      createStream([createTrack('video', 'browser'), createTrack('audio')]),
    );

    await captureDisplayAudioStream({
      unavailableMessage: 'unavailable',
      preferCurrentTab: true,
    });

    // Chrome rejects selfBrowserSurface alongside preferCurrentTab, so the
    // two must never be sent together.
    expect(calls[0]).toMatchObject({ preferCurrentTab: true });
    expect(calls[0]).not.toHaveProperty('selfBrowserSurface');
  });

  test('names the wrong surface instead of reporting generic silence', async () => {
    installGetDisplayMedia(async () =>
      createStream([createTrack('video', 'monitor')]),
    );

    await expect(
      captureDisplayAudioStream({
        unavailableMessage: 'unavailable',
        missingAudioMessage: 'generic',
        preferCurrentTab: true,
      }),
    ).rejects.toThrow(/whole screen/i);
  });

  test('falls back to the generic message when the surface is unknown', async () => {
    installGetDisplayMedia(async () => createStream([createTrack('video')]));

    await expect(
      captureDisplayAudioStream({
        unavailableMessage: 'unavailable',
        missingAudioMessage: 'generic',
      }),
    ).rejects.toThrow('generic');
  });

  test('retries without hints when the browser rejects the dictionary', async () => {
    let attempt = 0;
    const calls = installGetDisplayMedia(async () => {
      attempt += 1;
      if (attempt === 1) {
        const error = new Error('bad dictionary');
        error.name = 'InvalidStateError';
        throw error;
      }
      return createStream([
        createTrack('video', 'browser'),
        createTrack('audio'),
      ]);
    });

    await captureDisplayAudioStream({
      unavailableMessage: 'unavailable',
      preferCurrentTab: true,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ video: true, audio: true });
  });

  test('does not reopen the dialog the user just dismissed', async () => {
    const calls = installGetDisplayMedia(async () => {
      const error = new Error('denied');
      error.name = 'NotAllowedError';
      throw error;
    });

    await expect(
      captureDisplayAudioStream({
        unavailableMessage: 'unavailable',
        preferCurrentTab: true,
      }),
    ).rejects.toThrow('No tab was shared');
    expect(calls).toHaveLength(1);
  });

  describe('a refused picker names the cause retrying cannot fix', () => {
    // NotAllowedError means a closed picker, a page not allowed to capture,
    // or an OS refusal. Telling the last two to "try again" sent visitors
    // round a loop that could never succeed.
    const refuse = (message: string) =>
      installGetDisplayMedia(async () => {
        const error = new Error(message);
        error.name = 'NotAllowedError';
        throw error;
      });
    const capture = () =>
      captureDisplayAudioStream({ unavailableMessage: 'unavailable' });
    let restorePolicy: (() => void) | null = null;
    afterEach(() => {
      restorePolicy?.();
      restorePolicy = null;
    });

    test('a Permissions Policy that forbids capture', async () => {
      const original = Object.getOwnPropertyDescriptor(
        document,
        'permissionsPolicy',
      );
      Object.defineProperty(document, 'permissionsPolicy', {
        configurable: true,
        value: {
          allowsFeature: (feature: string) => feature !== 'display-capture',
        },
      });
      restorePolicy = () => {
        if (original)
          Object.defineProperty(document, 'permissionsPolicy', original);
        else
          delete (document as { permissionsPolicy?: unknown })
            .permissionsPolicy;
      };
      refuse('Permission denied');
      await expect(capture()).rejects.toThrow(/blocked on this page/);
    });

    test('the operating system', async () => {
      refuse('Permission denied by system');
      await expect(capture()).rejects.toThrow(/blocked by your system/);
    });

    test('the visitor closing the picker', async () => {
      refuse('Permission denied by user');
      await expect(capture()).rejects.toThrow(
        'No tab was shared, so nothing was captured.',
      );
    });
  });

  test('reports a stopped share once, not once per track', async () => {
    const audio = createTrack('audio');
    const video = createTrack('video', 'browser');
    installGetDisplayMedia(async () => createStream([video, audio]));

    let endedCount = 0;
    await captureDisplayAudioStream({
      unavailableMessage: 'unavailable',
      preferCurrentTab: true,
      onEnded: () => {
        endedCount += 1;
      },
    });

    video.fire('ended');
    audio.fire('ended');
    expect(endedCount).toBe(1);
  });

  test('requests systemAudio: include and selfBrowserSurface: include when capturing external audio', async () => {
    const calls = installGetDisplayMedia(async () =>
      createStream([createTrack('video', 'browser'), createTrack('audio')]),
    );

    await captureDisplayAudioStream({
      unavailableMessage: 'unavailable',
      preferCurrentTab: false,
    });

    expect(calls[0]).toMatchObject({
      selfBrowserSurface: 'include',
      systemAudio: 'include',
    });
  });

  test('succeeds when a monitor share carries an audio track (system audio captured)', async () => {
    const audio = createTrack('audio');
    const video = createTrack('video', 'monitor');
    installGetDisplayMedia(async () => createStream([video, audio]));

    const stream = await captureDisplayAudioStream({
      unavailableMessage: 'unavailable',
      preferCurrentTab: false,
    });

    expect(stream.getAudioTracks()).toHaveLength(1);
  });
});
