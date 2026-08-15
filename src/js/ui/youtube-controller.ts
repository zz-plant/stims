export interface YouTubeVideo {
  id: string;
  title: string;
  timestamp: number;
  /** oEmbed thumbnail, when the metadata fetch succeeded. */
  thumbnail?: string;
  /** Channel name, when the metadata fetch succeeded. */
  author?: string;
}

/** Playback position, polled by the transport UI. */
export type YouTubeTransportState = {
  currentSeconds: number;
  durationSeconds: number;
  paused: boolean;
};

export type YouTubeVideoReference = {
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
    enablejsapi: number;
    rel: number;
    start: number;
    origin?: string;
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
  pauseVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getPlayerState?: () => number;
  unMute?: () => void;
  setVolume?: (volume: number) => void;
};

/** YT.PlayerState.PLAYING — the only state constant we branch on. */
export const YOUTUBE_STATE_PLAYING = 1;

/**
 * The IFrame API is a third-party script: ad blockers, offline mode, and
 * locked-down networks all silently never resolve `onYouTubeIframeAPIReady`.
 * Without a deadline the Load button spins forever.
 */
const API_LOAD_TIMEOUT_MS = 10_000;
export const YOUTUBE_API_BLOCKED_MESSAGE =
  "The YouTube player script couldn't load. An ad blocker or network policy may be blocking youtube.com — try demo audio or microphone instead.";

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

const YOUTUBE_RECENT_STORAGE_KEY = 'stims_recent_youtube';
const YOUTUBE_METADATA_STORAGE_KEY = 'stims_youtube_metadata';
/** Titles change rarely; the cap is about storage size, not staleness. */
const METADATA_CACHE_LIMIT = 50;

type YouTubeVideoMetadata = {
  title: string;
  thumbnail?: string;
  author?: string;
};

function readMetadataStore(): Record<string, YouTubeVideoMetadata> {
  try {
    const stored = localStorage.getItem(YOUTUBE_METADATA_STORAGE_KEY);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, YouTubeVideoMetadata>)
      : {};
  } catch {
    return {};
  }
}

function readStoredVideoMetadata(id: string): YouTubeVideoMetadata | null {
  const entry = readMetadataStore()[id];
  return entry && typeof entry.title === 'string' ? entry : null;
}

function writeStoredVideoMetadata(id: string, metadata: YouTubeVideoMetadata) {
  try {
    const store = readMetadataStore();
    store[id] = metadata;
    const ids = Object.keys(store);
    if (ids.length > METADATA_CACHE_LIMIT) {
      for (const stale of ids.slice(0, ids.length - METADATA_CACHE_LIMIT)) {
        delete store[stale];
      }
    }
    localStorage.setItem(YOUTUBE_METADATA_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage errors — the in-memory cache still applies this session.
  }
}

function normalizeYouTubeUrl(url: string): string | null {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (/^(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url)) {
    return `https://${url}`;
  }
  return null;
}

function parseTimestamp(value: string | null): number {
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

function parseStartSeconds(url: URL): number {
  const candidates = [
    url.searchParams.get('t'),
    url.searchParams.get('start'),
    url.hash.startsWith('#t=') ? url.hash.slice(3) : null,
  ];

  for (const candidate of candidates) {
    const seconds = parseTimestamp(candidate);
    if (seconds > 0) {
      return seconds;
    }
  }

  return 0;
}

export function parseYouTubeVideoReference(
  url: string,
): YouTubeVideoReference | null {
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

  const normalizedUrl = normalizeYouTubeUrl(trimmed);
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

    const startSeconds = parseStartSeconds(parsed);
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

export function readStoredRecentYouTubeVideos(): YouTubeVideo[] {
  try {
    const stored = localStorage.getItem(YOUTUBE_RECENT_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as YouTubeVideo[]) : [];
  } catch {
    return [];
  }
}

export class YouTubeController {
  private static MAX_RECENT = 5;
  private static VIDEO_METADATA_CACHE = new Map<string, YouTubeVideoMetadata>();
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

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(YOUTUBE_API_BLOCKED_MESSAGE)),
        API_LOAD_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([YouTubeController.apiReadyPromise, deadline]);
    } catch (error) {
      // Let a later attempt re-inject the script rather than racing a
      // promise that already lost.
      YouTubeController.apiInitialized = false;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  parseVideoReference(url: string): YouTubeVideoReference | null {
    return parseYouTubeVideoReference(url);
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
          // Required for the postMessage transport controls to reach the frame.
          enablejsapi: 1,
          rel: 0,
          start: reference.startSeconds,
          ...(typeof window !== 'undefined' && window.location?.origin
            ? { origin: window.location.origin }
            : {}),
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
            void this.saveToRecent(reference).finally(() => {
              resolve();
            });
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
    return readStoredRecentYouTubeVideos();
  }

  /** Pause playback without tearing down the player or the capture stream. */
  pause() {
    this.player?.pauseVideo?.();
  }

  /** Resume playback. Volume stays wherever the user left it. */
  play() {
    this.player?.playVideo?.();
  }

  seekTo(seconds: number) {
    this.player?.seekTo?.(Math.max(0, seconds), true);
  }

  /** Relative seek, for the ±10s transport buttons. */
  nudge(deltaSeconds: number) {
    const current = this.player?.getCurrentTime?.();
    if (typeof current !== 'number' || Number.isNaN(current)) {
      return;
    }
    this.seekTo(current + deltaSeconds);
  }

  /**
   * Null until the player reports usable numbers — the IFrame API returns 0
   * for duration until metadata lands, which would render as a 0:00 scrubber.
   */
  getTransportState(): YouTubeTransportState | null {
    const player = this.player;
    if (!player?.getDuration || !player.getCurrentTime) {
      return null;
    }

    const durationSeconds = player.getDuration();
    const currentSeconds = player.getCurrentTime();
    if (
      typeof durationSeconds !== 'number' ||
      typeof currentSeconds !== 'number' ||
      Number.isNaN(durationSeconds) ||
      Number.isNaN(currentSeconds) ||
      durationSeconds <= 0
    ) {
      return null;
    }

    return {
      currentSeconds,
      durationSeconds,
      paused: player.getPlayerState?.() !== YOUTUBE_STATE_PLAYING,
    };
  }

  private async saveToRecent(video: YouTubeVideoReference) {
    let recent = this.getRecentVideos();
    const metadata = await this.getVideoMetadata(video);
    recent = recent.filter((v) => v.id !== video.id);
    recent.unshift({
      id: video.id,
      title: metadata.title,
      timestamp: Date.now(),
      ...(metadata.thumbnail ? { thumbnail: metadata.thumbnail } : {}),
      ...(metadata.author ? { author: metadata.author } : {}),
    });
    recent = recent.slice(0, YouTubeController.MAX_RECENT);
    try {
      localStorage.setItem(YOUTUBE_RECENT_STORAGE_KEY, JSON.stringify(recent));
    } catch {
      // Ignore storage errors.
    }
  }

  private async getVideoMetadata(
    video: YouTubeVideoReference,
  ): Promise<YouTubeVideoMetadata> {
    const cached =
      YouTubeController.VIDEO_METADATA_CACHE.get(video.id) ??
      readStoredVideoMetadata(video.id);
    if (cached) {
      YouTubeController.VIDEO_METADATA_CACHE.set(video.id, cached);
      return cached;
    }

    try {
      const oEmbedUrl = new URL('https://www.youtube.com/oembed');
      oEmbedUrl.searchParams.set('url', video.canonicalUrl);
      oEmbedUrl.searchParams.set('format', 'json');
      const response = await fetch(oEmbedUrl.toString());
      if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.status}`);
      }
      const data = (await response.json()) as {
        title?: unknown;
        thumbnail_url?: unknown;
        author_name?: unknown;
      };
      if (typeof data.title === 'string' && data.title.trim()) {
        const metadata: YouTubeVideoMetadata = {
          title: data.title.trim(),
          ...(typeof data.thumbnail_url === 'string' && data.thumbnail_url
            ? { thumbnail: data.thumbnail_url }
            : {}),
          ...(typeof data.author_name === 'string' && data.author_name.trim()
            ? { author: data.author_name.trim() }
            : {}),
        };
        YouTubeController.VIDEO_METADATA_CACHE.set(video.id, metadata);
        writeStoredVideoMetadata(video.id, metadata);
        return metadata;
      }
    } catch {
      // Ignore metadata fetch failures and fall back to the video id.
    }

    return { title: `Video ${video.id}` };
  }
}
