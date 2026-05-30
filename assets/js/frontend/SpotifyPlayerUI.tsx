import { useCallback, useEffect, useRef, useState } from 'react';

type SpotifyState =
  | 'idle'
  | 'authorizing'
  | 'authorized'
  | 'connecting'
  | 'ready'
  | 'error';

interface TrackInfo {
  title: string;
  artist: string;
  albumArt?: string;
  duration: number;
}

export function SpotifyPlayerUI() {
  const [spotifyState, setSpotifyState] = useState<SpotifyState>('idle');
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [paused, setPaused] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const init = async () => {
      const { handleOAuthCallback, connectSpotifyPlayer } = await import(
        '../core/services/spotify-service'
      );
      const handled = await handleOAuthCallback();
      if (!handled) return;
      if (!mountedRef.current) return;
      setSpotifyState('authorized');
      await connectSpotifyPlayer({
        onStateChange: (s) => {
          if (mountedRef.current) setSpotifyState(s);
        },
        onTrackChange: (t) => {
          if (mountedRef.current) setTrack(t);
        },
        onPlaybackChange: (paused, _position) => {
          if (mountedRef.current) setPaused(paused);
        },
        onAudioStream: (_stream) => {},
        onError: (_error) => {},
      });
    };
    init();
  }, []);

  const handleConnect = useCallback(async () => {
    const { startSpotifyOAuth } = await import(
      '../core/services/spotify-service'
    );
    startSpotifyOAuth();
  }, []);

  const handlePlaybackAction = useCallback(
    async (action: 'play' | 'pause' | 'next' | 'prev') => {
      const svc = await import('../core/services/spotify-service');
      switch (action) {
        case 'play':
          svc.spotifyPlay();
          break;
        case 'pause':
          svc.spotifyPause();
          break;
        case 'next':
          svc.spotifyNext();
          break;
        case 'prev':
          svc.spotifyPrevious();
          break;
      }
    },
    [],
  );

  if (spotifyState !== 'ready') {
    return (
      <div className="stims-shell__source-card">
        <strong>Spotify</strong>
        <span>
          {spotifyState === 'connecting'
            ? 'Connecting...'
            : spotifyState === 'error'
              ? 'Connection failed'
              : 'Stream your music library'}
        </span>
        <button
          type="button"
          className="cta-button"
          onClick={handleConnect}
          disabled={
            spotifyState === 'authorizing' || spotifyState === 'connecting'
          }
        >
          {spotifyState === 'idle' ? 'Connect Spotify' : 'Connecting...'}
        </button>
      </div>
    );
  }

  return (
    <div className="stims-shell__now-playing">
      {track?.albumArt ? (
        <img className="stims-shell__album-art" src={track.albumArt} alt="" />
      ) : null}
      <div>
        <strong className="stims-shell__now-playing-title">
          {track?.title ?? 'Spotify'}
        </strong>
        <span className="stims-shell__now-playing-artist">
          {track?.artist ?? ''}
        </span>
      </div>
      <div className="stims-shell__playback-controls">
        <button
          type="button"
          className="cta-button ghost"
          onClick={() => handlePlaybackAction('prev')}
        >
          Prev
        </button>
        <button
          type="button"
          className="cta-button primary"
          onClick={() => handlePlaybackAction(paused ? 'play' : 'pause')}
        >
          {paused ? 'Play' : 'Pause'}
        </button>
        <button
          type="button"
          className="cta-button ghost"
          onClick={() => handlePlaybackAction('next')}
        >
          Next
        </button>
      </div>
    </div>
  );
}
