/**
 * Publishes what is playing to the operating system.
 *
 * Without this the OS has no idea Stims exists: no lock-screen or
 * notification-shade transport, no artwork or title anywhere outside the tab,
 * and hardware media keys — headphone remotes, the play/pause key on a
 * keyboard — go nowhere. For something you leave running on a TV or a phone,
 * that is most of the distance between "a tab" and "a media app".
 *
 * ## Which sources actually surface an OS control
 *
 * Chromium only paints media UI for an `HTMLMediaElement` producing audible
 * audio, which among this app's five sources is `file` alone — `file-audio.ts`
 * builds a real `<audio>` and routes it through `createMediaElementSource`.
 * The demo track is procedural Web Audio with no element, microphone and tab
 * are capture streams, and a YouTube embed's iframe owns its own session. The
 * calls below are inert for those rather than wrong, so this stays
 * unconditional: the metadata is correct whenever the platform asks for it,
 * and it starts working the day any of those grow an element behind them.
 *
 * ## Why play/pause routes through the app rather than the element
 *
 * The browser would answer the OS transport on its own by pausing the element
 * directly — and that is the trap. This app's Pause is wider than the element:
 * it holds the frame loop *and* pauses whichever source this page produces
 * sound with. Letting the OS reach past it would pause the audio while the
 * visuals kept running on silence and the dock still read "Pause". Routing the
 * OS transport through the same control keeps all three in step.
 */

import { useEffect, useRef } from 'react';

/** The size `scripts/generate-thumbnails.ts` writes previews at. */
const PREVIEW_ARTWORK_SIZE = '480x270';

type MediaSessionHandlers = {
  /** Bound to `play` and `pause`, guarded against redundant toggles. */
  onTogglePlayback: () => void;
  /** Bound to `nexttrack`. */
  onNextPreset: () => void;
  /** Bound to `previoustrack`. */
  onPreviousPreset: () => void;
  /** Bound to `stop`. */
  onStop: () => void;
};

type MediaSessionOptions = MediaSessionHandlers & {
  /** True while audio is live. Clears everything when it goes false. */
  active: boolean;
  /** Mirrors the app's own playback hold into `playbackState`. */
  paused: boolean;
  presetId: string | null;
  presetTitle: string | null;
  presetAuthor: string | null;
};

function getMediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.mediaSession ?? null;
}

/**
 * `setActionHandler` throws `NotSupportedError` for actions a browser does
 * not implement, and the throw aborts the rest of the registration — so one
 * unsupported action would silently cost every action declared after it.
 */
function setHandler(
  session: MediaSession,
  action: MediaSessionAction,
  handler: (() => void) | null,
) {
  try {
    session.setActionHandler(action, handler);
  } catch {
    // Unsupported on this browser; the others still register.
  }
}

export function useMediaSession({
  active,
  paused,
  presetId,
  presetTitle,
  presetAuthor,
  onTogglePlayback,
  onNextPreset,
  onPreviousPreset,
  onStop,
}: MediaSessionOptions): void {
  // Read through refs so the registration effect depends on `active` alone.
  // The handlers are rebuilt on most renders of the shell (the workspace
  // provider re-renders every frame while audio plays), and re-registering
  // that often would be pure churn against a platform API.
  const handlersRef = useRef<MediaSessionHandlers>({
    onTogglePlayback,
    onNextPreset,
    onPreviousPreset,
    onStop,
  });
  handlersRef.current = {
    onTogglePlayback,
    onNextPreset,
    onPreviousPreset,
    onStop,
  };
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const session = getMediaSession();
    if (!session || !active) return;

    // The only control available is a toggle, so each action checks the
    // current state before firing. `playbackState` below keeps the OS's idea
    // of that state honest, but a stale press — the lock screen redrawing a
    // beat late, two presses in flight — must not invert playback.
    setHandler(session, 'play', () => {
      if (pausedRef.current) handlersRef.current.onTogglePlayback();
    });
    setHandler(session, 'pause', () => {
      if (!pausedRef.current) handlersRef.current.onTogglePlayback();
    });
    setHandler(session, 'nexttrack', () => handlersRef.current.onNextPreset());
    setHandler(session, 'previoustrack', () =>
      handlersRef.current.onPreviousPreset(),
    );
    setHandler(session, 'stop', () => handlersRef.current.onStop());

    return () => {
      for (const action of [
        'play',
        'pause',
        'nexttrack',
        'previoustrack',
        'stop',
      ] as const) {
        setHandler(session, action, null);
      }
    };
  }, [active]);

  useEffect(() => {
    const session = getMediaSession();
    if (!session) return;
    session.playbackState = !active ? 'none' : paused ? 'paused' : 'playing';
  }, [active, paused]);

  useEffect(() => {
    const session = getMediaSession();
    if (!session || typeof MediaMetadata === 'undefined') return;

    if (!active || !presetTitle) {
      session.metadata = null;
      return;
    }

    session.metadata = new MediaMetadata({
      title: presetTitle,
      artist: presetAuthor ?? 'MilkDrop preset',
      album: 'Stims',
      // The same R2 thumbnail the browse grid uses as its default artwork.
      // A preset without one 404s and the OS simply shows no art, which is
      // why this is not gated on knowing the file exists: the alternative is
      // plumbing the grid's per-preset miss set down here to save a request
      // the browser makes once and caches.
      artwork: presetId
        ? [
            {
              src: `/milkdrop-presets/previews/${presetId}.png`,
              sizes: PREVIEW_ARTWORK_SIZE,
              type: 'image/png',
            },
          ]
        : [],
    });

    return () => {
      session.metadata = null;
    };
  }, [active, presetId, presetTitle, presetAuthor]);
}
