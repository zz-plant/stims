/**
 * Local audio file playback, as a MediaStream the engine can analyse.
 *
 * The engine's `'file'` source has always accepted a MediaStream — the Strudel
 * lab was its only caller — so this module's whole job is turning a File the
 * user picked into that stream, plus the transport to control it.
 *
 * Routing note: `createMediaElementSource` takes the element *out* of the
 * default output path, so the element alone is silent from that point on.
 * That is why the graph forks — one branch to `ctx.destination` so the user
 * hears the track, one to a `MediaStreamAudioDestinationNode` so the engine
 * gets something to analyse. Both are required; dropping either gives you
 * silent visuals or a track that plays with a dead visualizer.
 *
 * `HTMLMediaElement.captureStream()` would be shorter, but it is still
 * prefixed on Safari and absent on some older mobile WebViews, whereas this
 * graph works anywhere Web Audio does — which is already a hard requirement
 * for the rest of the app.
 */

import type { SessionRouteState } from './contracts.ts';

export type PlaylistTrack = {
  name: string;
  file: File;
};

export type FilePlaylistSnapshot = {
  tracks: readonly { name: string; size: number }[];
  currentIndex: number;
  currentTrackName: string;
  totalTracks: number;
  loopMode: 'playlist' | 'track' | 'none';
  isPaused: boolean;
};

export type FileAudioHandle = {
  stream: MediaStream;
  element: HTMLAudioElement;
  /** File name, for status copy and the transport label. */
  name: string;
  /** Playlist tracks */
  playlist?: readonly PlaylistTrack[];
  currentIndex?: number;
  loopMode?: 'playlist' | 'track' | 'none';
  nextTrack?: () => Promise<void>;
  previousTrack?: () => Promise<void>;
  selectTrack?: (index: number) => Promise<void>;
  addFiles?: (files: File[]) => void;
  setLoopMode?: (mode: 'playlist' | 'track' | 'none') => void;
  dispose: () => void;
};

const AUDIO_FILE_ACCEPT = 'audio/*';

export { AUDIO_FILE_ACCEPT };

/** True when the browser thinks it can play the file at all. */
export function canProbablyPlay(file: File): boolean {
  if (!file.type) return true; // No MIME from the OS — let the element try.
  try {
    return document.createElement('audio').canPlayType(file.type) !== '';
  } catch {
    return true;
  }
}

export async function createFileAudioStream(
  files: File | File[],
  options?: {
    startIndex?: number;
    loopMode?: 'playlist' | 'track' | 'none';
  },
): Promise<FileAudioHandle> {
  const fileList = Array.isArray(files) ? files : [files];
  const playlist: PlaylistTrack[] = fileList
    .filter(canProbablyPlay)
    .map((file) => ({ name: file.name, file }));

  if (playlist.length === 0) {
    throw new Error('No playable audio files were selected.');
  }

  let currentIndex = Math.max(
    0,
    Math.min(options?.startIndex ?? 0, playlist.length - 1),
  );
  let loopMode: 'playlist' | 'track' | 'none' = options?.loopMode ?? 'playlist';
  let currentObjectUrl: string | null = null;

  const element =
    typeof Audio !== 'undefined'
      ? new Audio()
      : document.createElement('audio');
  element.loop = false;
  element.crossOrigin = 'anonymous';

  let handle: FileAudioHandle | null = null;

  const loadTrack = async (index: number): Promise<void> => {
    if (index < 0 || index >= playlist.length) return;
    currentIndex = index;
    if (handle) {
      handle.name = playlist[index].name;
      handle.currentIndex = index;
    }

    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    const currentFile = playlist[index].file;
    currentObjectUrl = URL.createObjectURL(currentFile);
    element.src = currentObjectUrl;

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(
          new Error(
            `${currentFile.name} could not be decoded — the format may not be supported.`,
          ),
        );
      };
      const cleanup = () => {
        element.removeEventListener('canplay', onReady);
        element.removeEventListener('error', onError);
      };
      element.addEventListener('canplay', onReady);
      element.addEventListener('error', onError);
      element.load();
    });
  };

  await loadTrack(currentIndex).catch((error) => {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    throw error;
  });

  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    throw new Error('Web Audio is unavailable in this browser.');
  }
  const context = new AudioContextCtor();

  const source = context.createMediaElementSource(element);
  const streamDestination = context.createMediaStreamDestination();
  source.connect(streamDestination);
  source.connect(context.destination);

  // Picking the file is the user gesture, but some browsers still hand back a
  // suspended context; resume before play so the first frames aren't silent.
  if (context.state === 'suspended') {
    await context.resume().catch(() => undefined);
  }
  await element.play().catch((error) => {
    // Autoplay policy can still refuse. Leave the handle usable — the caller
    // shows a transport, so the user can press play themselves.
    console.debug('File audio did not autostart', error);
  });

  const onEnded = () => {
    if (loopMode === 'track') {
      element.currentTime = 0;
      void element.play().catch(() => undefined);
      return;
    }
    if (currentIndex + 1 < playlist.length) {
      void nextTrack();
    } else if (loopMode === 'playlist') {
      void selectTrack(0);
    } else {
      notifyPlaylistSubscribers();
    }
  };
  element.addEventListener('ended', onEnded);
  element.addEventListener('play', notifyPlaylistSubscribers);
  element.addEventListener('pause', notifyPlaylistSubscribers);

  const nextTrack = async (): Promise<void> => {
    if (playlist.length === 0) return;
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      if (loopMode === 'playlist') {
        nextIndex = 0;
      } else {
        return;
      }
    }
    await selectTrack(nextIndex);
  };

  const previousTrack = async (): Promise<void> => {
    if (playlist.length === 0) return;
    if (element.currentTime > 3) {
      element.currentTime = 0;
      return;
    }
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      if (loopMode === 'playlist') {
        prevIndex = playlist.length - 1;
      } else {
        prevIndex = 0;
      }
    }
    await selectTrack(prevIndex);
  };

  const selectTrack = async (index: number): Promise<void> => {
    if (index < 0 || index >= playlist.length) return;
    try {
      await loadTrack(index);
      if (context.state === 'suspended') {
        await context.resume().catch(() => undefined);
      }
      await element.play().catch((err) => {
        console.debug('Playlist track autostart deferred', err);
      });
    } catch (err) {
      console.warn('Failed to switch track in playlist', err);
      if (playlist.length > 1 && index + 1 < playlist.length) {
        await selectTrack(index + 1);
      }
    }
    notifyPlaylistSubscribers();
  };

  const addFiles = (newFiles: File[]): void => {
    const valid = newFiles.filter(canProbablyPlay);
    for (const f of valid) {
      playlist.push({ name: f.name, file: f });
    }
    notifyPlaylistSubscribers();
  };

  const setLoopMode = (mode: 'playlist' | 'track' | 'none'): void => {
    loopMode = mode;
    if (handle) {
      handle.loopMode = mode;
    }
    notifyPlaylistSubscribers();
  };

  handle = {
    stream: streamDestination.stream,
    element,
    name: playlist[currentIndex].name,
    playlist,
    currentIndex,
    loopMode,
    nextTrack,
    previousTrack,
    selectTrack,
    addFiles,
    setLoopMode,
    dispose: () => {
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('play', notifyPlaylistSubscribers);
      element.removeEventListener('pause', notifyPlaylistSubscribers);
      element.pause();
      source.disconnect();
      streamDestination.disconnect();
      void context.close();
      element.removeAttribute('src');
      element.load();
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
      }
      notifyPlaylistSubscribers();
    },
  };

  return handle;
}

/**
 * The file currently feeding the engine, owned here rather than by a
 * component.
 *
 * It used to live in a ref inside `AudioSourcePanel`, disposed on unmount.
 * But that panel mounts twice — once in the home hero, which stays mounted
 * all session, and once in the Settings sheet, which is conditionally
 * rendered — so closing Settings tore down the graph and the context while
 * the engine's audio session, `routeState.audioSource` and `audioActive` all
 * carried on: the music stopped and the analyser flatlined, while the dock
 * still showed the file chip and the stage kept animating on silence.
 *
 * The mirror case was worse. From the home copy, which never unmounts,
 * "Stop audio" tore down the engine side and left this handle untouched — and
 * the element loops, so the track played on, audibly, forever, after the UI
 * said audio had stopped.
 *
 * Playback belongs to the audio session, so its lifetime is tied to the
 * session's: `setActiveFileAudio` on play, `disposeActiveFileAudio` when the
 * session stops or switches to another source.
 */
let activeFileAudio: FileAudioHandle | null = null;

type PlaylistListener = (snapshot: FilePlaylistSnapshot | null) => void;
const playlistListeners = new Set<PlaylistListener>();

function notifyPlaylistSubscribers(): void {
  const snapshot = getActiveFilePlaylist();
  for (const listener of playlistListeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error('Playlist listener threw', err);
    }
  }
}

/**
 * Adopts `handle` as the playing file, disposing whichever one it replaces.
 * One at a time: two live graphs would both feed the analyser and both be
 * audible.
 */
export function setActiveFileAudio(handle: FileAudioHandle | null): void {
  if (activeFileAudio && activeFileAudio !== handle) {
    activeFileAudio.dispose();
  }
  activeFileAudio = handle;
  notifyPlaylistSubscribers();
}

/** Stops and tears down the playing file, if any. Safe to call repeatedly. */
export function disposeActiveFileAudio(): void {
  setActiveFileAudio(null);
}

/**
 * The playing file's name, or null. Lets a freshly mounted copy of the audio
 * panel report what is actually playing instead of offering to pick a track
 * that is already playing.
 */
export function getActiveFileAudioName(): string | null {
  return activeFileAudio?.name ?? null;
}

/**
 * Get snapshot of the current playlist state, including tracks and active index.
 */
export function getActiveFilePlaylist(): FilePlaylistSnapshot | null {
  if (!activeFileAudio) return null;
  const playlist = activeFileAudio.playlist ?? [
    { name: activeFileAudio.name, file: {} as File },
  ];
  return {
    tracks: playlist.map((t) => ({
      name: t.name,
      size: (t.file as File).size ?? 0,
    })),
    currentIndex: activeFileAudio.currentIndex ?? 0,
    currentTrackName: activeFileAudio.name,
    totalTracks: playlist.length,
    loopMode: activeFileAudio.loopMode ?? 'playlist',
    isPaused: activeFileAudio.element?.paused ?? false,
  };
}

/**
 * Subscribe to playlist changes (track advance, pause/play, addition).
 */
export function subscribeFilePlaylist(listener: PlaylistListener): () => void {
  playlistListeners.add(listener);
  listener(getActiveFilePlaylist());
  return () => {
    playlistListeners.delete(listener);
  };
}

/**
 * Advance to next track in the playlist.
 */
export async function nextFileTrack(): Promise<void> {
  if (activeFileAudio?.nextTrack) {
    await activeFileAudio.nextTrack();
  }
}

/**
 * Go back to previous track in the playlist (or restart if past 3s).
 */
export async function previousFileTrack(): Promise<void> {
  if (activeFileAudio?.previousTrack) {
    await activeFileAudio.previousTrack();
  }
}

/**
 * Select a specific track by index.
 */
export async function selectFileTrack(index: number): Promise<void> {
  if (activeFileAudio?.selectTrack) {
    await activeFileAudio.selectTrack(index);
  }
}

/**
 * Set playlist loop mode ('playlist' | 'track' | 'none').
 */
export function setFileLoopMode(mode: 'playlist' | 'track' | 'none'): void {
  if (activeFileAudio?.setLoopMode) {
    activeFileAudio.setLoopMode(mode);
  }
}

/**
 * Pauses or resumes the playing file in step with the stage's pause. A file
 * is the one source whose sound this page produces, so holding the picture
 * while the track played on would read as the visuals having died.
 */
export function setActiveFileAudioPaused(paused: boolean): void {
  const element = activeFileAudio?.element;
  if (!element) return;
  if (paused) {
    element.pause();
    return;
  }
  void element.play().catch(() => {
    // Autoplay policy can refuse a play() that is not inside a gesture; the
    // stage resumes regardless and the next gesture retries through the
    // audio-handler's own resume path.
  });
}

/**
 * Start playing `file` or playlist of `files` as the live audio source.
 *
 * Shared because there are now two ways in — the audio panel's picker and
 * drop zone, and a file shared into the installed app from another app — and
 * the sequence is not obvious enough to retype: the route has to be committed
 * *and* handed on as `launchState`. Calling `startAudioSource` alone leaves
 * `routeState.audioSource` null, so the engine snapshot never reports the
 * source and nothing downstream reacts to it.
 *
 * Tears down whichever file was playing first: two handles feeding the
 * analyser at once is two tracks playing at once.
 */
export async function startFileAudio(
  files: File | File[],
  deps: {
    routeState: SessionRouteState;
    commitRoute: (route: SessionRouteState) => void;
    startAudioSource: (request: {
      source: 'file';
      stream: MediaStream;
      launchState: SessionRouteState;
    }) => Promise<void>;
  },
  options?: {
    startIndex?: number;
    loopMode?: 'playlist' | 'track' | 'none';
  },
): Promise<FileAudioHandle> {
  disposeActiveFileAudio();
  const handle = await createFileAudioStream(files, options);
  setActiveFileAudio(handle);
  const nextRoute: SessionRouteState = {
    ...deps.routeState,
    audioSource: 'file',
  };
  deps.commitRoute(nextRoute);
  await deps.startAudioSource({
    source: 'file',
    stream: handle.stream,
    launchState: nextRoute,
  });
  return handle;
}
