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

export type FileAudioHandle = {
  stream: MediaStream;
  element: HTMLAudioElement;
  /** File name, for status copy and the transport label. */
  name: string;
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
  file: File,
): Promise<FileAudioHandle> {
  const objectUrl = URL.createObjectURL(file);
  const element = new Audio(objectUrl);
  element.loop = true;
  element.crossOrigin = 'anonymous';

  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Web Audio is unavailable in this browser.');
  }
  const context = new AudioContextCtor();

  // Surface a decode failure as a rejected promise rather than a stream that
  // silently never carries samples.
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(
        new Error(
          `${file.name} could not be decoded — the format may not be supported.`,
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
  }).catch((error) => {
    URL.revokeObjectURL(objectUrl);
    void context.close();
    throw error;
  });

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

  return {
    stream: streamDestination.stream,
    element,
    name: file.name,
    dispose: () => {
      element.pause();
      source.disconnect();
      streamDestination.disconnect();
      void context.close();
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(objectUrl);
    },
  };
}
