export interface YouTubeVideo {
  id: string;
  title: string;
  timestamp: number;
}

export class YouTubeController {
  private static STORAGE_KEY = 'stims_recent_youtube';
  private static MAX_RECENT = 5;
  private player: any = null;
  private apiReady = false;

  constructor() {
    this.initAPI();
  }

  private initAPI() {
    if ((window as any).YT) {
      this.apiReady = true;
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    (window as any).onYouTubeIframeAPIReady = () => {
      this.apiReady = true;
    };
  }

  parseVideoId(url: string): string | null {
    const trimmed = url.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    
    // Support various formats: watch?v=, embed/, youtu.be/, shorts/
    const patterns = [
      /(?:v=|embed\/|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/,
      /^[a-zA-Z0-9_-]{11}$/
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) return match[1];
    }
    
    return null;
  }

  async loadVideo(containerId: string, videoId: string, onStateChange?: (state: number) => void): Promise<void> {
    if (!this.apiReady) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (this.apiReady) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }

    return new Promise((resolve) => {
      this.player = new (window as any).YT.Player(containerId, {
        height: '180',
        width: '100%',
        videoId: videoId,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          modestbranding: 1,
          rel: 0
        },
        events: {
          onReady: () => {
            this.saveToRecent(videoId);
            resolve();
          },
          onStateChange: (event: any) => {
            onStateChange?.(event.data);
          }
        }
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

  private saveToRecent(id: string) {
    let recent = this.getRecentVideos();
    // Move to front if exists, or add new
    recent = recent.filter(v => v.id !== id);
    recent.unshift({ id, title: `Video ${id}`, timestamp: Date.now() });
    recent = recent.slice(0, YouTubeController.MAX_RECENT);
    localStorage.setItem(YouTubeController.STORAGE_KEY, JSON.stringify(recent));
  }
}
