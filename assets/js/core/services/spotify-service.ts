declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

declare const Spotify: {
  Player: new (config: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume: number;
  }) => {
    connect: () => void;
    disconnect: () => void;
    resume: () => void;
    pause: () => void;
    nextTrack: () => void;
    previousTrack: () => void;
    setVolume: (v: number) => void;
    addListener: (event: string, callback: (...args: any[]) => void) => void;
  };
};

const SPOTIFY_CLIENT_ID = 'YOUR_CLIENT_ID';
const REDIRECT_URI =
  typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : '';
const SCOPES = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
];

type SpotifyState =
  | 'idle'
  | 'authorizing'
  | 'authorized'
  | 'connecting'
  | 'ready'
  | 'error';

interface SpotifyCallbacks {
  onStateChange: (state: SpotifyState) => void;
  onTrackChange: (track: {
    title: string;
    artist: string;
    albumArt?: string;
    duration: number;
  }) => void;
  onPlaybackChange: (paused: boolean, position: number) => void;
  onAudioStream: (stream: MediaStream) => void;
  onError: (error: string) => void;
}

function setVerifier(verifier: string) {
  try {
    sessionStorage.setItem('spotify:verifier', verifier);
  } catch {}
}
function getVerifier(): string | null {
  try {
    return sessionStorage.getItem('spotify:verifier');
  } catch {
    return null;
  }
}
function clearVerifier() {
  try {
    sessionStorage.removeItem('spotify:verifier');
  } catch {}
}

function setRefreshToken(token: string) {
  try {
    localStorage.setItem('spotify:refresh_token', token);
  } catch {}
}
export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem('spotify:refresh_token');
  } catch {
    return null;
  }
}
function clearRefreshToken() {
  try {
    localStorage.removeItem('spotify:refresh_token');
  } catch {}
}

let accessToken: string | null = null;
let player: any = null;
let audioElement: HTMLAudioElement | null = null;
let callbacks: SpotifyCallbacks | null = null;
let currentState: SpotifyState = 'idle';

function notifyState(s: SpotifyState) {
  currentState = s;
  callbacks?.onStateChange(s);
}

function generateCodeVerifier(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  for (let i = 0; i < 64; i++) result += chars[array[i] % chars.length];
  return result;
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function startSpotifyOAuth(): void {
  notifyState('authorizing');
  const verifier = generateCodeVerifier();
  setVerifier(verifier);

  generateCodeChallenge(verifier).then((challenge) => {
    const params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri:
        REDIRECT_URI +
        (REDIRECT_URI.includes('?') ? '&' : '?') +
        'spotify_auth=1',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES.join(' '),
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
  });
}

export async function handleOAuthCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');

  if (!code || !state) return false;

  const verifier = getVerifier();
  if (!verifier) return false;
  clearVerifier();

  try {
    const response = await fetch('/api/spotify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier, redirect_uri: REDIRECT_URI }),
    });

    if (!response.ok) throw new Error('Token exchange failed');

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
    };
    accessToken = data.access_token;
    setRefreshToken(data.refresh_token);
    notifyState('authorized');

    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('spotify_auth');
    window.history.replaceState(null, '', url.toString());

    return true;
  } catch {
    notifyState('error');
    return false;
  }
}

export async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;

  try {
    const response = await fetch('/api/spotify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      clearRefreshToken();
      return false;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
    };
    accessToken = data.access_token;
    if (data.refresh_token) setRefreshToken(data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export async function connectSpotifyPlayer(
  sdkCallback: SpotifyCallbacks,
): Promise<void> {
  callbacks = sdkCallback;

  if (!accessToken) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      callbacks.onError(
        'No Spotify access token. Please connect your account.',
      );
      return;
    }
  }

  notifyState('connecting');

  if (
    !document.querySelector(
      'script[src="https://sdk.scdn.co/spotify-player.js"]',
    )
  ) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Spotify SDK'));
      document.head.appendChild(script);
    });
  }

  await new Promise<void>((resolve) => {
    const check = () => {
      if (typeof Spotify !== 'undefined') {
        resolve();
        return;
      }
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
    };
    check();
  });

  player = new Spotify.Player({
    name: 'Stims Visualizer',
    getOAuthToken: (cb: (token: string) => void) => {
      if (accessToken) cb(accessToken);
    },
    volume: 0.5,
  });

  player.addListener('ready', async () => {
    notifyState('ready');

    const el = document.querySelector(
      'audio[data-testid="audio-element"]',
    ) as HTMLAudioElement | null;
    if (el) audioElement = el;
  });

  player.addListener('player_state_changed', (state: any) => {
    if (!state?.track_window?.current_track) return;
    const track = state.track_window.current_track;
    callbacks?.onTrackChange({
      title: track.name,
      artist: track.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
      albumArt: track.album?.images?.[0]?.url,
      duration: track.duration_ms,
    });
    callbacks?.onPlaybackChange(state.paused, state.position);
  });

  player.addListener('autoplay_failed', () => {
    callbacks?.onError('Autoplay blocked. Please interact with the page.');
  });

  player.addListener('authentication_error', async () => {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      notifyState('error');
      callbacks?.onError('Spotify authentication failed. Please reconnect.');
    } else if (player) {
      player.connect();
    }
  });

  player.connect();
}

export function getSpotifyAudioStream(
  audioCtx: AudioContext,
): MediaStream | null {
  if (!audioElement) return null;
  try {
    const source = audioCtx.createMediaElementSource(audioElement);
    const destination = audioCtx.createMediaStreamDestination();
    source.connect(destination);
    source.connect(audioCtx.destination);
    return destination.stream;
  } catch {
    return null;
  }
}

export function spotifyPlay() {
  player?.resume();
}
export function spotifyPause() {
  player?.pause();
}
export function spotifyNext() {
  player?.nextTrack();
}
export function spotifyPrevious() {
  player?.previousTrack();
}
export function spotifySetVolume(v: number) {
  player?.setVolume(v);
}

export function isSpotifyConnected(): boolean {
  return currentState === 'ready' || currentState === 'authorized';
}

export function getSpotifyState(): SpotifyState {
  return currentState;
}

export function disconnectSpotify() {
  player?.disconnect();
  player = null;
  accessToken = null;
  audioElement = null;
  callbacks = null;
  clearRefreshToken();
  currentState = 'idle';
  notifyState('idle');
}
