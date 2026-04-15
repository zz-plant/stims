import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import {
  parseYouTubeVideoReference,
  readStoredRecentYouTubeVideos,
  YouTubeController,
  type YouTubeVideo,
} from '../ui/youtube-controller.ts';

const YOUTUBE_URL_STORAGE_KEY = 'stims-youtube-url';
const DEFAULT_YOUTUBE_FEEDBACK = 'Paste a YouTube link or video ID to load it.';
const INVALID_YOUTUBE_FEEDBACK =
  'That link or ID was not recognized. Try a YouTube watch/share link or an 11-character video ID.';
const VALID_YOUTUBE_FEEDBACK = 'Link looks good. Press Load to continue.';
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

export function useWorkspaceYouTubePreview({
  setStatusMessage,
}: {
  setStatusMessage: (message: string | null) => void;
}) {
  const [youtubeUrl, setYoutubeUrlState] = useState(() =>
    readStoredWorkspaceYouTubeUrl(),
  );
  const [youtubeReady, setYoutubeReady] = useState(false);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [loadedVideoKey, setLoadedVideoKey] = useState<string | null>(null);
  const [recentYouTubeVideos, setRecentYouTubeVideos] = useState<
    YouTubeVideo[]
  >(() => readStoredRecentYouTubeVideos());
  const youtubeControllerRef = useRef<YouTubeController | null>(null);
  const youtubePreviewRef = useRef<HTMLDivElement | null>(null);

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

  const loadYouTubePreview = async (requestedUrl = youtubeUrl) => {
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
      await youtubeControllerRef.current.loadVideo(
        'workspace-youtube-player',
        reference,
        (state) => {
          if (state === 1) {
            setYoutubeReady(true);
          }
        },
      );
      setLoadedVideoKey(reference.canonicalUrl);
      setRecentYouTubeVideos(readStoredRecentYouTubeVideos());
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

  const handleYoutubeUrlKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !youtubeInputState.canLoad) {
      return;
    }

    event.preventDefault();
    void loadYouTubePreview();
  };

  const loadRecentYouTubeVideo = (videoId: string) => {
    const nextUrl = `https://www.youtube.com/watch?v=${videoId}`;
    writeStoredWorkspaceYouTubeUrl(nextUrl);
    setYoutubeUrlState(nextUrl);
    setYoutubeReady(false);
    setLoadedVideoKey(null);
    void loadYouTubePreview(nextUrl);
  };

  return {
    handleYoutubeUrlKeyDown,
    loadRecentYouTubeVideo,
    loadYouTubePreview,
    recentYouTubeVideos,
    youtubeCanLoad: youtubeInputState.canLoad,
    youtubeFeedback: youtubeInputState.feedback,
    youtubeInputInvalid: youtubeInputState.invalid,
    youtubeLoading,
    youtubePreviewRef,
    youtubeReady,
    youtubeUrl,
    setYoutubeUrl,
  };
}
