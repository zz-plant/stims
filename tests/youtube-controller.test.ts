import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { YouTubeController } from '../assets/js/ui/youtube-controller.ts';

describe('YouTubeController', () => {
  const originalYT = window.YT;
  const originalFetch = globalThis.fetch;
  const originalReadyHandler = window.onYouTubeIframeAPIReady;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="youtube-player"></div>';
    localStorage.clear();
    window.onYouTubeIframeAPIReady = undefined;
  });

  afterEach(() => {
    window.YT = originalYT;
    window.onYouTubeIframeAPIReady = originalReadyHandler;
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('loads YouTube videos unmuted at full volume', async () => {
    const playVideo = mock(() => {});
    const unMute = mock(() => {});
    const setVolume = mock(() => {});
    const destroy = mock(() => {});

    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ title: 'Test video' }),
    })) as unknown as typeof fetch;

    window.YT = {
      Player: function playerFactory(
        _containerId: string,
        options: {
          playerVars: { autoplay: number };
          events: { onReady: () => void };
        },
      ) {
        expect(options.playerVars.autoplay).toBe(1);
        queueMicrotask(() => options.events.onReady());
        return {
          destroy,
          playVideo,
          unMute,
          setVolume,
        };
      } as unknown as NonNullable<NonNullable<typeof window.YT>['Player']>,
    };

    const controller = new YouTubeController();
    await controller.loadVideo('youtube-player', 'dQw4w9WgXcQ');

    expect(unMute).toHaveBeenCalledTimes(1);
    expect(setVolume).toHaveBeenCalledWith(100);
    expect(playVideo).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });
});
