import type { KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  parseYouTubeVideoReference,
  readStoredRecentYouTubeVideos,
  YouTubeController,
  type YouTubeTransportState,
  type YouTubeVideo,
} from '../ui/youtube-controller.ts';

const YOUTUBE_URL_STORAGE_KEY = 'stims-youtube-url';
const DEFAULT_YOUTUBE_FEEDBACK = 'Paste a YouTube link or video ID to load it.';
const INVALID_YOUTUBE_FEEDBACK =
  'That link or ID was not recognized. Try a YouTube watch/share link or an 11-character video ID.';
const VALID_YOUTUBE_FEEDBACK = 'Press Load to continue.';
const LOADING_YOUTUBE_FEEDBACK = 'Loading the embedded player…';
const READY_YOUTUBE_FEEDBACK =
  'Video is ready. Choose Start capture to continue.';

export function readStoredWorkspaceYouTubeUrl() {
  try {
    return window.sessionStorage.getItem(YOUTUBE_URL_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredWorkspaceYouTubeUrl(value: string) {
  try {
    if (value.trim()) {
      window.sessionStorage.setItem(YOUTUBE_URL_STORAGE_KEY, value);
      return;
    }
    window.sessionStorage.removeItem(YOUTUBE_URL_STORAGE_KEY);
  } catch {
    // Ignore storage errors in preview UI state.
  }
}

export function describeWorkspaceYouTubeInputState({
  loadedVideoKey,
  value,
  youtubeLoading,
}: {
  loadedVideoKey: string | null;
  value: string;
  youtubeLoading: boolean;
}) {
  const trimmedValue = value.trim();
  const reference = parseYouTubeVideoReference(trimmedValue);

  if (!trimmedValue) {
    return {
      canLoad: false,
      feedback: DEFAULT_YOUTUBE_FEEDBACK,
      invalid: false,
      reference: null,
    };
  }

  if (!reference) {
    return {
      canLoad: false,
      feedback: INVALID_YOUTUBE_FEEDBACK,
      invalid: true,
      reference: null,
    };
  }

  if (youtubeLoading) {
    return {
      canLoad: false,
      feedback: LOADING_YOUTUBE_FEEDBACK,
      invalid: false,
      reference,
    };
  }

  if (loadedVideoKey && reference.canonicalUrl === loadedVideoKey) {
    return {
      canLoad: true,
      feedback: READY_YOUTUBE_FEEDBACK,
      invalid: false,
      reference,
    };
  }

  return {
    canLoad: true,
    feedback: VALID_YOUTUBE_FEEDBACK,
    invalid: false,
    reference,
  };
}

/**
 * A shared `?yt=` link wins over whatever this browser had in sessionStorage:
 * the recipient followed the link to see that video, not their own last one.
 */
export function resolveInitialWorkspaceYouTubeUrl(
  videoId: string | null | undefined,
  startSeconds: number | null | undefined,
) {
  if (!videoId) {
    return readStoredWorkspaceYouTubeUrl();
  }
  const offset = startSeconds && startSeconds > 0 ? `&t=${startSeconds}s` : '';
  return `https://www.youtube.com/watch?v=${videoId}${offset}`;
}

export function useWorkspaceYouTubePreview({
  setStatusMessage,
  initialVideoId = null,
  initialStartSeconds = null,
  onVideoLoaded,
}: {
  setStatusMessage: (message: string | null) => void;
  /** From `?yt=` on the incoming URL. */
  initialVideoId?: string | null;
  /** From `?t=` on the incoming URL. */
  initialStartSeconds?: number | null;
  /** Lets the route pick up the video so the address bar stays shareable. */
  onVideoLoaded?: (video: { id: string; startSeconds: number }) => void;
}) {
  const [youtubeUrl, setYoutubeUrlState] = useState(() =>
    resolveInitialWorkspaceYouTubeUrl(initialVideoId, initialStartSeconds),
  );
  const [youtubeReady, setYoutubeReady] = useState(false);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [loadedVideoKey, setLoadedVideoKey] = useState<string | null>(null);
  const [recentYouTubeVideos, setRecentYouTubeVideos] = useState<
    YouTubeVideo[]
  >(() => readStoredRecentYouTubeVideos());
  const youtubeControllerRef = useRef<YouTubeController | null>(null);
  const youtubePreviewRef = useRef<HTMLDivElement | null>(null);
  const [youtubeTransport, setYoutubeTransport] =
    useState<YouTubeTransportState | null>(null);

  // Once the visuals go fullscreen the video is a cropped texture with no
  // controls of its own, so Stims has to own the transport. The IFrame API
  // has no time-update event — polling once a second is the only option, and
  // it costs nothing while no video is loaded.
  useEffect(() => {
    if (!youtubeReady) {
      setYoutubeTransport(null);
      return;
    }

    const readTransport = () => {
      // Skip the read while the tab is hidden — the poll would only thrash
      // state for a UI nobody can see, and it resumes on the next tick.
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      const next = youtubeControllerRef.current?.getTransportState() ?? null;
      // getTransportState returns a fresh object every call; committing it
      // unconditionally re-rendered the workspace subtree once a second even
      // while paused. Only publish when a field actually moved.
      setYoutubeTransport((previous) => {
        if (
          previous &&
          next &&
          previous.currentSeconds === next.currentSeconds &&
          previous.durationSeconds === next.durationSeconds &&
          previous.paused === next.paused
        ) {
          return previous;
        }
        return next;
      });
    };

    readTransport();
    const timer = setInterval(readTransport, 1000);
    return () => clearInterval(timer);
  }, [youtubeReady]);

  // The IFrame API applies commands asynchronously, so reading the player
  // straight back after a command returns the *previous* state — the Pause
  // button would keep saying "Pause" until the next poll. Apply the intended
  // change optimistically instead and let the poll reconcile it.
  const applyOptimisticTransport = (
    change: (previous: YouTubeTransportState) => YouTubeTransportState,
  ) => {
    setYoutubeTransport((previous) => (previous ? change(previous) : previous));
  };

  const youtubeTransportControls = {
    play: () => {
      youtubeControllerRef.current?.play();
      applyOptimisticTransport((previous) => ({ ...previous, paused: false }));
    },
    pause: () => {
      youtubeControllerRef.current?.pause();
      applyOptimisticTransport((previous) => ({ ...previous, paused: true }));
    },
    seekTo: (seconds: number) => {
      youtubeControllerRef.current?.seekTo(seconds);
      applyOptimisticTransport((previous) => ({
        ...previous,
        currentSeconds: Math.min(
          previous.durationSeconds,
          Math.max(0, seconds),
        ),
      }));
    },
    nudge: (deltaSeconds: number) => {
      youtubeControllerRef.current?.nudge(deltaSeconds);
      applyOptimisticTransport((previous) => ({
        ...previous,
        currentSeconds: Math.min(
          previous.durationSeconds,
          Math.max(0, previous.currentSeconds + deltaSeconds),
        ),
      }));
    },
  };

  const youtubeInputState = describeWorkspaceYouTubeInputState({
    loadedVideoKey,
    value: youtubeUrl,
    youtubeLoading,
  });

  const setYoutubeUrl = (value: string) => {
    writeStoredWorkspaceYouTubeUrl(value);
    setYoutubeReady(false);
    setLoadedVideoKey(null);
    setYoutubeUrlState(value);
  };

  const loadYouTubePreview = async (
    requestedUrl = youtubeUrl,
    onLoaded?: () => void,
  ) => {
    const previewHost = youtubePreviewRef.current;
    const value = requestedUrl.trim();
    if (!previewHost || !value) {
      return;
    }

    const reference = parseYouTubeVideoReference(value);
    if (!reference) {
      setStatusMessage('Enter a valid YouTube URL or 11-character video ID.');
      setYoutubeReady(false);
      setLoadedVideoKey(null);
      return;
    }

    try {
      if (!youtubeControllerRef.current) {
        youtubeControllerRef.current = new YouTubeController();
      }

      setYoutubeLoading(true);
      setYoutubeReady(false);
      setLoadedVideoKey(null);
      previewHost.hidden = false;
      // Resolve the player element *within* the host this hook holds a ref
      // to, rather than by a document-wide id. Both AudioSourcePanel mounts
      // render a player container; getElementById returned the home hero's
      // copy, so loading a video from Settings put the iframe in the panel
      // the user could not see. The ref is last-mount-wins, which is the
      // visible one.
      const playerHost = previewHost.querySelector<HTMLElement>(
        '[data-youtube-player]',
      );
      if (!playerHost) {
        throw new Error('YouTube player container is not mounted.');
      }
      await youtubeControllerRef.current.loadVideo(
        playerHost,
        reference,
        (state) => {
          if (state === 1) {
            setYoutubeReady(true);
            onLoaded?.();
          }
        },
      );
      setLoadedVideoKey(reference.canonicalUrl);
      setRecentYouTubeVideos(readStoredRecentYouTubeVideos());
      onVideoLoaded?.({
        id: reference.id,
        startSeconds: reference.startSeconds,
      });
      setStatusMessage(
        'YouTube preview is ready. Capture this tab audio next.',
      );
    } catch (error) {
      setYoutubeReady(false);
      setLoadedVideoKey(null);
      previewHost.hidden = true;
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load YouTube preview.',
      );
    } finally {
      setYoutubeLoading(false);
    }
  };

  const handleYoutubeUrlKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    onLoaded?: () => void,
  ) => {
    if (event.key !== 'Enter' || !youtubeInputState.canLoad) {
      return;
    }

    event.preventDefault();
    // The loaded video is already playing — Enter means "start capture", and
    // getDisplayMedia needs the transient activation this keypress carries,
    // so call straight through instead of reloading first.
    if (
      youtubeReady &&
      youtubeInputState.reference?.canonicalUrl === loadedVideoKey
    ) {
      onLoaded?.();
      return;
    }
    void loadYouTubePreview(youtubeUrl, onLoaded);
  };

  const loadRecentYouTubeVideo = (videoId: string, onLoaded?: () => void) => {
    const nextUrl = `https://www.youtube.com/watch?v=${videoId}`;
    writeStoredWorkspaceYouTubeUrl(nextUrl);
    setYoutubeUrlState(nextUrl);
    setYoutubeReady(false);
    setLoadedVideoKey(null);
    void loadYouTubePreview(nextUrl);
    // Capture records this tab's audio, not the player element, so it does
    // not need the load to finish — and getDisplayMedia must run inside the
    // chip's click gesture, which expires long before the player is ready.
    // Fire it now and let the video load behind the share prompt.
    onLoaded?.();
  };

  const clearRecentYouTubeVideos = () => {
    try {
      window.localStorage.removeItem('stims_recent_youtube');
      setRecentYouTubeVideos([]);
    } catch {}
  };

  return {
    handleYoutubeUrlKeyDown,
    loadRecentYouTubeVideo,
    loadYouTubePreview,
    clearRecentYouTubeVideos,
    recentYouTubeVideos,
    youtubeCanLoad: youtubeInputState.canLoad,
    youtubeFeedback: youtubeInputState.feedback,
    youtubeInputInvalid: youtubeInputState.invalid,
    youtubeLoading,
    youtubePreviewRef,
    youtubeReady,
    youtubeTransport,
    youtubeTransportControls,
    youtubeUrl,
    setYoutubeUrl,
  };
}
