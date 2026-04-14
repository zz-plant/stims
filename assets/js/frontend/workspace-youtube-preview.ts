import { useRef, useState } from 'react';
import { YouTubeController } from '../ui/youtube-controller.ts';

export function useWorkspaceYouTubePreview({
  setStatusMessage,
}: {
  setStatusMessage: (message: string | null) => void;
}) {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeReady, setYoutubeReady] = useState(false);
  const youtubeControllerRef = useRef<YouTubeController | null>(null);
  const youtubePreviewRef = useRef<HTMLDivElement | null>(null);

  const loadYouTubePreview = async () => {
    const previewHost = youtubePreviewRef.current;
    const value = youtubeUrl.trim();
    if (!previewHost || !value) {
      return;
    }

    try {
      if (!youtubeControllerRef.current) {
        youtubeControllerRef.current = new YouTubeController();
      }

      const reference = youtubeControllerRef.current.parseVideoReference(value);
      if (!reference) {
        setStatusMessage('Enter a valid YouTube URL or 11-character video ID.');
        setYoutubeReady(false);
        return;
      }

      previewHost.hidden = false;
      await youtubeControllerRef.current.loadVideo(
        'workspace-youtube-player',
        reference,
      );
      setYoutubeReady(true);
      setStatusMessage(
        'YouTube preview is ready. Capture this tab audio next.',
      );
    } catch (error) {
      setYoutubeReady(false);
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load YouTube preview.',
      );
    }
  };

  return {
    loadYouTubePreview,
    youtubePreviewRef,
    youtubeReady,
    youtubeUrl,
    setYoutubeUrl,
  };
}
