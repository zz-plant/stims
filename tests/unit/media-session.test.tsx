import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMediaSession } from '../../src/js/frontend/hooks/use-media-session.ts';

/**
 * What the OS is told about playback, and what it is allowed to do back.
 *
 * The subtle half is play/pause. Left unclaimed, the browser answers the OS
 * transport by pausing the `<audio>` element directly — reaching past this
 * app's own Pause, which is wider: it holds the frame loop *and* pauses
 * whichever source the page produces sound with. The result would be audio
 * stopped, visuals still running on silence, and a dock still reading
 * "Pause". So the handlers route through the same control, guarded so a
 * stale press cannot invert playback, and `playbackState` mirrors the app.
 */

type Registered = Map<string, (() => void) | null>;

function installFakeMediaSession() {
  const handlers: Registered = new Map();
  const session = {
    metadata: null as unknown,
    playbackState: 'none',
    setActionHandler(action: string, handler: (() => void) | null) {
      handlers.set(action, handler);
    },
  };
  // happy-dom ships neither mediaSession nor MediaMetadata.
  const nav = globalThis.navigator as unknown as Record<string, unknown>;
  const priorSession = Object.getOwnPropertyDescriptor(nav, 'mediaSession');
  Object.defineProperty(nav, 'mediaSession', {
    configurable: true,
    writable: true,
    value: session,
  });

  class FakeMediaMetadata {
    title: string;
    artist: string;
    album: string;
    artwork: Array<{ src: string; sizes?: string; type?: string }>;
    constructor(init: {
      title?: string;
      artist?: string;
      album?: string;
      artwork?: Array<{ src: string; sizes?: string; type?: string }>;
    }) {
      this.title = init.title ?? '';
      this.artist = init.artist ?? '';
      this.album = init.album ?? '';
      this.artwork = init.artwork ?? [];
    }
  }
  const priorMetadata = Object.getOwnPropertyDescriptor(
    globalThis,
    'MediaMetadata',
  );
  Object.defineProperty(globalThis, 'MediaMetadata', {
    configurable: true,
    writable: true,
    value: FakeMediaMetadata,
  });

  return {
    session,
    handlers,
    restore() {
      if (priorSession)
        Object.defineProperty(nav, 'mediaSession', priorSession);
      else Reflect.deleteProperty(nav, 'mediaSession');
      if (priorMetadata) {
        Object.defineProperty(globalThis, 'MediaMetadata', priorMetadata);
      } else {
        Reflect.deleteProperty(globalThis, 'MediaMetadata');
      }
    },
  };
}

type HarnessProps = Parameters<typeof useMediaSession>[0];

function Harness(props: HarnessProps) {
  useMediaSession(props);
  return null;
}

describe('media session', () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;
  let fake: ReturnType<typeof installFakeMediaSession> | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    fake?.restore();
    host = null;
    root = null;
    fake = null;
  });

  const calls: string[] = [];

  const baseProps = (over: Partial<HarnessProps> = {}): HarnessProps => ({
    active: true,
    paused: false,
    presetId: 'aderrasi-ghast-entity',
    presetTitle: 'Aderrasi - Ghast Entity',
    presetAuthor: 'Aderrasi',
    onTogglePlayback: () => calls.push('toggle'),
    onNextPreset: () => calls.push('next'),
    onPreviousPreset: () => calls.push('previous'),
    onStop: () => calls.push('stop'),
    ...over,
  });

  const render = (props: HarnessProps) => {
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    if (!host) {
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
    }
    act(() => {
      root?.render(<Harness {...props} />);
    });
  };

  test('publishes the playing preset as the track metadata', () => {
    fake = installFakeMediaSession();
    render(baseProps());

    const metadata = fake.session.metadata as {
      title: string;
      artist: string;
      album: string;
      artwork: Array<{ src: string; sizes?: string; type?: string }>;
    };
    expect(metadata.title).toBe('Aderrasi - Ghast Entity');
    expect(metadata.artist).toBe('Aderrasi');
    expect(metadata.artwork[0]?.src).toBe(
      '/milkdrop-presets/previews/aderrasi-ghast-entity.png',
    );
  });

  test('moves the metadata with the preset', () => {
    fake = installFakeMediaSession();
    render(baseProps());
    render(
      baseProps({
        presetId: 'geiss-bipolar-x',
        presetTitle: 'Geiss - Bipolar',
      }),
    );

    expect((fake.session.metadata as { title: string }).title).toBe(
      'Geiss - Bipolar',
    );
  });

  test('clears the metadata when audio stops', () => {
    fake = installFakeMediaSession();
    render(baseProps());
    expect(fake.session.metadata).not.toBeNull();

    render(baseProps({ active: false }));
    expect(fake.session.metadata).toBeNull();
  });

  test('next and previous move through presets, not tracks', () => {
    fake = installFakeMediaSession();
    calls.length = 0;
    render(baseProps());

    fake.handlers.get('nexttrack')?.();
    fake.handlers.get('previoustrack')?.();
    fake.handlers.get('stop')?.();

    expect(calls).toEqual(['next', 'previous', 'stop']);
  });

  test("routes the OS transport through the app's own playback control", () => {
    fake = installFakeMediaSession();
    calls.length = 0;
    render(baseProps({ paused: false }));

    fake.handlers.get('pause')?.();
    expect(calls).toEqual(['toggle']);

    render(baseProps({ paused: true }));
    fake.handlers.get('play')?.();
    expect(calls).toEqual(['toggle', 'toggle']);
  });

  test('ignores a transport press that matches the current state', () => {
    // A lock screen redrawing a beat late, or two presses in flight, must not
    // invert playback by toggling twice.
    fake = installFakeMediaSession();
    calls.length = 0;
    render(baseProps({ paused: false }));

    fake.handlers.get('play')?.();
    expect(calls).toEqual([]);

    render(baseProps({ paused: true }));
    fake.handlers.get('pause')?.();
    expect(calls).toEqual([]);
  });

  test('mirrors the app playback state back to the OS', () => {
    fake = installFakeMediaSession();
    render(baseProps({ paused: false }));
    expect(fake.session.playbackState).toBe('playing');

    render(baseProps({ paused: true }));
    expect(fake.session.playbackState).toBe('paused');

    render(baseProps({ active: false }));
    expect(fake.session.playbackState).toBe('none');
  });

  test('releases its action handlers when audio stops', () => {
    fake = installFakeMediaSession();
    render(baseProps());
    expect(fake.handlers.get('nexttrack')).not.toBeNull();

    render(baseProps({ active: false }));
    for (const action of [
      'play',
      'pause',
      'nexttrack',
      'previoustrack',
      'stop',
    ]) {
      expect(fake.handlers.get(action), action).toBeNull();
    }
  });
});
