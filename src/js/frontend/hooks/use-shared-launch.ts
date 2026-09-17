/**
 * Consumes a payload shared into the installed app from another app.
 *
 * The service worker answers the `share_target` POST and hands the page a
 * marker in the query string — a file waits in the share inbox cache, a link
 * rides along as text. This runs once on arrival, picks it up, and clears the
 * marker so a reload is not a second share.
 *
 * Links are parsed here rather than in the worker on purpose: the app already
 * owns a YouTube reference parser, and `public/service-worker.js` is plain
 * unbundled JavaScript that cannot import it. Handing the raw text over keeps
 * one parser instead of two that drift.
 */

import { useEffect, useRef } from 'react';
import { parseYouTubeVideoReference } from '../../ui/youtube-controller.ts';
import type { SessionRouteState } from '../contracts.ts';
import { startFileAudio } from '../file-audio.ts';

/** Must match `SHARED_AUDIO_KEY` in public/service-worker.js. */
const SHARED_AUDIO_KEY = '/__stims-shared-audio';
const SHARE_PARAMS = ['share', 'u'] as const;

type SharedLaunchOptions = {
  routeState: SessionRouteState;
  commitRoute: (route: SessionRouteState) => void;
  startAudioSource: (request: {
    source: 'file';
    stream: MediaStream;
    launchState: SessionRouteState;
  }) => Promise<void>;
  setStatusMessage: (message: string | null) => void;
};

/**
 * Drops the share markers from the address bar without adding a history
 * entry, so Back still leaves the app rather than replaying the share.
 */
function clearShareParams() {
  const url = new URL(window.location.href);
  let touched = false;
  for (const param of SHARE_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      touched = true;
    }
  }
  if (!touched) return;
  const search = url.searchParams.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${search ? `?${search}` : ''}${url.hash}`,
  );
}

async function takeSharedAudioFile(): Promise<File | null> {
  try {
    const response = await fetch(SHARED_AUDIO_KEY);
    if (!response.ok) return null;
    const type = response.headers.get('Content-Type') ?? 'audio/*';
    const rawName = response.headers.get('X-Stims-Shared-Name');
    const name = rawName ? decodeURIComponent(rawName) : 'Shared audio';
    const blob = await response.blob();
    if (blob.size === 0) return null;
    return new File([blob], name, { type });
  } catch {
    return null;
  }
}

export function useSharedLaunch({
  routeState,
  commitRoute,
  startAudioSource,
  setStatusMessage,
}: SharedLaunchOptions): void {
  // Latest-value refs: this fires once, but the values it needs are rebuilt
  // on nearly every render of the shell, and depending on them would re-run
  // the arrival.
  const depsRef = useRef({
    routeState,
    commitRoute,
    startAudioSource,
    setStatusMessage,
  });
  depsRef.current = {
    routeState,
    commitRoute,
    startAudioSource,
    setStatusMessage,
  };
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current || typeof window === 'undefined') return;
    consumedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const share = params.get('share');
    if (!share) return;

    if (share === 'link') {
      const reference = parseYouTubeVideoReference(params.get('u') ?? '');
      clearShareParams();
      if (!reference) {
        depsRef.current.setStatusMessage(
          'That link is not something Stims can play. Share a YouTube link or an audio file.',
        );
        return;
      }
      // Re-entering through the app's own deep link rather than reproducing
      // the YouTube start sequence: `?audio=youtube&yt=` is already wired end
      // to end, and a share is a cold start anyway, so the second load costs
      // nothing a duplicate start path would not cost in drift.
      const target = new URL(window.location.href);
      target.search = '';
      target.searchParams.set('audio', 'youtube');
      target.searchParams.set('yt', reference.id);
      if (reference.startSeconds > 0) {
        target.searchParams.set('t', String(reference.startSeconds));
      }
      window.location.replace(target.toString());
      return;
    }

    if (share !== 'audio') {
      clearShareParams();
      return;
    }

    void (async () => {
      const file = await takeSharedAudioFile();
      clearShareParams();
      if (!file) {
        depsRef.current.setStatusMessage(
          'The shared track could not be read. Try sharing it again.',
        );
        return;
      }
      try {
        const handle = await startFileAudio(file, depsRef.current);
        depsRef.current.setStatusMessage(`Playing ${handle.name}`);
      } catch (error) {
        depsRef.current.setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Could not play the shared track.',
        );
      }
    })();
  }, []);
}
