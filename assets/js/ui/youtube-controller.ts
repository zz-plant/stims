export interface YouTubeVideo {
  id: string;
  title: string;
  timestamp: number;
}

type YouTubeVideoReference = {
  id: string;
  startSeconds: number;
  canonicalUrl: string;
};

type YouTubePlayerEvent = {
  data: number;
};

type YouTubePlayerErrorEvent = {
  data: number;
};

type YouTubePlayerOptions = {
  height: string;
  width: string;
  videoId: string;
  playerVars: {
    autoplay: number;
    playsinline: number;
    modestbranding: number;
    rel: number;
    start: number;
  };
  events: {
    onReady: () => void;
    onStateChange: (event: YouTubePlayerEvent) => void;
    onError: (event: YouTubePlayerErrorEvent) => void;
  };
};

type YouTubePlayer = {
  destroy?: () => void;
  playVideo?: () => void;
  unMute?: () => void;
  setVolume?: (volume: number) => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        containerId: string,
        options: YouTubePlayerOptions,
      ) => YouTubePlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export class YouTubeController {
  private static STORAGE_KEY = 'stims_recent_youtube';
  private static MAX_RECENT = 5;
  private static VIDEO_TITLE_CACHE = new Map<string, string>();
  private static apiReadyPromise: Promise<void> | null = null;
  private static apiReadyResolve: (() => void) | null = null;
  private static apiInitialized = false;
  private player: YouTubePlayer | null = null;
  private loadSequence = 0;

  constructor() {
    this.initAPI();
  }

  private initAPI() {
    if (YouTubeController.apiInitialized) {
      return;
    }

    YouTubeController.apiInitialized = true;
    if (!YouTubeController.apiReadyPromise) {
      YouTubeController.apiReadyPromise = new Promise((resolve) => {
        YouTubeController.apiReadyResolve = resolve;
      });
    }

    if (window.YT) {
      YouTubeController.apiReadyResolve?.();
      return;
    }

    const apiUrl = 'https://www.youtube.com/iframe_api';
    const existingScript = Array.from(
      document.getElementsByTagName('script'),
    ).find((script) => script.src === apiUrl);
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = apiUrl;
      const firstScriptTag = document.getElementsByTagName('script')[0];
      if (firstScriptTag?.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        document.head?.appendChild(tag) ?? document.body?.appendChild(tag);
      }
    }

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      YouTubeController.apiReadyResolve?.();
    };
  }

  private async waitForAPI() {
    if (window.YT) {
      return;
    }
    this.initAPI();
    await YouTubeController.apiReadyPromise;
  }

  parseVideoReference(url: string): YouTubeVideoReference | null {
    const trimmed = url.trim();
    if (!trimmed) {
      return null;
    }

    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return {
        id: trimmed,
        startSeconds: 0,
        canonicalUrl: `https://www.youtube.com/watch?v=${trimmed}`,
      };
    }

    const normalizedUrl = this.normalizeYouTubeUrl(trimmed);
    if (!normalizedUrl) {
      return null;
    }

    try {
      const parsed = new URL(normalizedUrl);
      const hostname = parsed.hostname.replace(/^www\./, '');
      let id: string | null = null;

      if (hostname === 'youtu.be') {
        id = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
      } else if (
        hostname === 'youtube.com' ||
        hostname.endsWith('.youtube.com')
      ) {
        if (parsed.pathname === '/watch') {
          id = parsed.searchParams.get('v');
        } else {
          const pathSegments = parsed.pathname.split('/').filter(Boolean);
          const playerPrefix = pathSegments[0];
          if (
            playerPrefix === 'embed' ||
            playerPrefix === 'shorts' ||
            playerPrefix === 'live' ||
            playerPrefix === 'v'
          ) {
            id = pathSegments[1] ?? null;
          }
        }
      }

      if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return null;
      }

      const startSeconds = this.parseStartSeconds(parsed);
      return {
        id,
        startSeconds,
        canonicalUrl: `https://www.youtube.com/watch?v=${id}${
          startSeconds > 0 ? `&t=${startSeconds}s` : ''
        }`,
      };
    } catch {
      return null;
    }
  }

  parseVideoId(url: string): string | null {
    return this.parseVideoReference(url)?.id ?? null;
  }

  async loadVideo(
    containerId: string,
    video: string | YouTubeVideoReference,
    onStateChange?: (state: number) => void,
  ): Promise<void> {
    const reference =
      typeof video === 'string'
        ? {
            id: video,
            startSeconds: 0,
            canonicalUrl: `https://www.youtube.com/watch?v=${video}`,
          }
        : video;
    const loadId = ++this.loadSequence;
    await this.waitForAPI();

    return new Promise((resolve, reject) => {
      if (!window.YT) {
        resolve();
        return;
      }

      this.player?.destroy?.();
      this.player = new window.YT.Player(containerId, {
        height: '180',
        width: '100%',
        videoId: reference.id,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          modestbranding: 1,
          rel: 0,
          start: reference.startSeconds,
        },
        events: {
          onReady: () => {
            if (loadId !== this.loadSequence) {
              resolve();
              return;
            }
            this.player?.unMute?.();
            this.player?.setVolume?.(100);
            this.player?.playVideo?.();
            void this.saveToRecent(reference);
            resolve();
          },
          onStateChange: (event) => {
            if (loadId !== this.loadSequence) {
              return;
            }
            onStateChange?.(event.data);
          },
          onError: (event) => {
            if (loadId !== this.loadSequence) {
              resolve();
              return;
            }
            reject(new Error(`YouTube player error ${event.data}`));
          },
        },
      });
    });
  }

  getRecentVideos(): YouTubeVideo[] {
    try {
      const stored = localStorage.getItem(YouTubeController.STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private async saveToRecent(video: YouTubeVideoReference) {
    let recent = this.getRecentVideos();
    const title = await this.getVideoTitle(video);
    recent = recent.filter((v) => v.id !== video.id);
    recent.unshift({ id: video.id, title, timestamp: Date.now() });
    recent = recent.slice(0, YouTubeController.MAX_RECENT);
    try {
      localStorage.setItem(
        YouTubeController.STORAGE_KEY,
        JSON.stringify(recent),
      );
    } catch {
      // Ignore storage errors.
    }
  }

  private normalizeYouTubeUrl(url: string): string | null {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    if (/^(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url)) {
      return `https://${url}`;
    }
    return null;
  }

  private parseStartSeconds(url: URL): number {
    const candidates = [
      url.searchParams.get('t'),
      url.searchParams.get('start'),
      url.hash.startsWith('#t=') ? url.hash.slice(3) : null,
    ];

    for (const candidate of candidates) {
      const seconds = this.parseTimestamp(candidate);
      if (seconds > 0) {
        return seconds;
      }
    }

    return 0;
  }

  private parseTimestamp(value: string | null): number {
    if (!value) {
      return 0;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }

    if (/^\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }

    const matches = trimmed.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
    if (!matches) {
      return 0;
    }

    const hours = Number.parseInt(matches[1] ?? '0', 10);
    const minutes = Number.parseInt(matches[2] ?? '0', 10);
    const seconds = Number.parseInt(matches[3] ?? '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
  }

  private async getVideoTitle(video: YouTubeVideoReference): Promise<string> {
    const cached = YouTubeController.VIDEO_TITLE_CACHE.get(video.id);
    if (cached) {
      return cached;
    }

    try {
      const oEmbedUrl = new URL('https://www.youtube.com/oembed');
      oEmbedUrl.searchParams.set('url', video.canonicalUrl);
      oEmbedUrl.searchParams.set('format', 'json');
      const response = await fetch(oEmbedUrl.toString());
      if (!response.ok) {
        throw new Error(`Failed to fetch title: ${response.status}`);
      }
      const data = (await response.json()) as { title?: unknown };
      if (typeof data.title === 'string' && data.title.trim()) {
        const title = data.title.trim();
        YouTubeController.VIDEO_TITLE_CACHE.set(video.id, title);
        return title;
      }
    } catch {
      // Ignore metadata fetch failures and fall back to the video id.
    }

    return `Video ${video.id}`;
  }
}
