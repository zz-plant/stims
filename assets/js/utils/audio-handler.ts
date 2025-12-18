import * as THREE from 'three';

type AudioAccessReason = 'unsupported' | 'denied' | 'unavailable';

const FREQUENCY_ANALYSER_PROCESSOR = new URL(
  './frequency-analyser-processor.ts',
  import.meta.url
);

export class FrequencyAnalyser {
  frequencyBinCount: number;
  private frequencyData: Uint8Array;
  private rms = 0;
  private readonly context: AudioContext;
  private readonly sourceNode: MediaStreamAudioSourceNode;
  private readonly silentGain: GainNode;
  private readonly workletNode?: AudioWorkletNode;
  private readonly analyserNode?: AnalyserNode;

  private constructor({
    context,
    sourceNode,
    workletNode,
    analyserNode,
    fftSize,
    silentGain,
  }: {
    context: AudioContext;
    sourceNode: MediaStreamAudioSourceNode;
    workletNode?: AudioWorkletNode;
    analyserNode?: AnalyserNode;
    fftSize: number;
    silentGain: GainNode;
  }) {
    this.context = context;
    this.sourceNode = sourceNode;
    this.workletNode = workletNode;
    this.analyserNode = analyserNode;
    this.frequencyBinCount = fftSize / 2;
    this.frequencyData = new Uint8Array(this.frequencyBinCount);
    this.silentGain = silentGain;

    if (this.workletNode) {
      this.workletNode.port.onmessage = (event: MessageEvent) => {
        const { frequencyData, rms } = event.data ?? {};
        if (frequencyData) {
          this.frequencyData = new Uint8Array(frequencyData);
        }
        if (typeof rms === 'number') {
          this.rms = rms;
        }
      };
    }
  }

  static async create(
    context: AudioContext,
    stream: MediaStream,
    fftSize: number
  ): Promise<FrequencyAnalyser> {
    const sourceNode = context.createMediaStreamSource(stream);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;

    if (context.audioWorklet?.addModule) {
      try {
        await context.audioWorklet.addModule(FREQUENCY_ANALYSER_PROCESSOR);

        const workletNode = new AudioWorkletNode(context, 'frequency-analyser', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: { fftSize },
        });

        sourceNode.connect(workletNode);
        workletNode.connect(silentGain);
        silentGain.connect(context.destination);

        return new FrequencyAnalyser({
          context,
          sourceNode,
          workletNode,
          fftSize,
          silentGain,
        });
      } catch (error) {
        console.warn('Falling back to AnalyserNode after AudioWorklet failure', error);
      }
    }

    const analyserNode = context.createAnalyser();
    analyserNode.fftSize = fftSize;
    sourceNode.connect(analyserNode);
    analyserNode.connect(silentGain);
    silentGain.connect(context.destination);

    return new FrequencyAnalyser({
      context,
      sourceNode,
      analyserNode,
      fftSize,
      silentGain,
    });
  }

  getFrequencyData() {
    if (this.analyserNode) {
      this.analyserNode.getByteFrequencyData(this.frequencyData);
    }

    return this.frequencyData;
  }

  getRmsLevel() {
    return this.rms;
  }

  disconnect() {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
    }
    if (this.analyserNode) {
      this.analyserNode.disconnect();
    }
    this.sourceNode.disconnect();
    this.silentGain.disconnect();
  }
}

async function queryMicrophonePermissionState(): Promise<PermissionState | undefined> {
  if (typeof navigator === 'undefined') return undefined;
  if (!navigator.permissions?.query) return undefined;

  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });

    return status.state;
  } catch (error) {
    console.warn('Unable to query microphone permission status', error);
    return undefined;
  }
}

export async function getMicrophonePermissionState() {
  return queryMicrophonePermissionState();
}

export class AudioAccessError extends Error {
  reason: AudioAccessReason;

  constructor(reason: AudioAccessReason, message: string) {
    super(message);
    this.name = 'AudioAccessError';
    this.reason = reason;
  }
}

export type AudioInitOptions = {
  fftSize?: number;
  camera?: THREE.Camera;
  positional?: boolean;
  object?: THREE.Object3D;
  constraints?: MediaStreamConstraints;
  stream?: MediaStream;
  onCleanup?: (ctx: {
    analyser: FrequencyAnalyser;
    listener: THREE.AudioListener;
    audio: THREE.Audio | THREE.PositionalAudio;
    stream?: MediaStream;
  }) => void;
};

export function createSyntheticAudioStream({
  frequency = 220,
  type = 'sawtooth',
  gain = 0.12,
}: {
  frequency?: number;
  type?: OscillatorType;
  gain?: number;
} = {}) {
  const context = new AudioContext();

  const oscillator = context.createOscillator();
  oscillator.frequency.value = frequency;
  oscillator.type = type;

  const gainNode = context.createGain();
  gainNode.gain.value = gain;

  const destination = context.createMediaStreamDestination();

  oscillator.connect(gainNode);
  gainNode.connect(destination);

  oscillator.start();

  const cleanup = () => {
    try {
      oscillator.stop();
    } catch (error) {
      console.error('Error stopping synthetic oscillator', error);
    }

    oscillator.disconnect();
    gainNode.disconnect();
    context.close();
  };

  return { stream: destination.stream, cleanup };
}

export async function initAudio(options: AudioInitOptions = {}) {
  const {
    fftSize = 256,
    camera,
    positional = false,
    object,
    constraints,
    stream,
    onCleanup,
  } = options;

  let listener: THREE.AudioListener | null = null;
  let resolvedStream: MediaStream | null = null;
  let ownsStream = false;
  let permissionState: PermissionState | undefined;

  if (typeof navigator === 'undefined') {
    throw new AudioAccessError(
      'unsupported',
      'Audio capture is not available in this environment.'
    );
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new AudioAccessError(
      'unsupported',
      'This browser does not support microphone capture.'
    );
  }

  try {
    listener = new THREE.AudioListener();
    if (camera) {
      camera.add(listener);
    }

    if (stream) {
      resolvedStream = stream;
    } else {
      permissionState = await queryMicrophonePermissionState();

      if (permissionState === 'denied') {
        throw new AudioAccessError(
          'denied',
          'Microphone access is blocked. Please allow microphone access in your browser settings and try again.'
        );
      }

      resolvedStream = await navigator.mediaDevices.getUserMedia(
        constraints ?? { audio: { echoCancellation: true } }
      );
      ownsStream = true;
      permissionState = permissionState ?? 'granted';
    }

    const streamSource = resolvedStream;
    if (!streamSource) {
      throw new AudioAccessError(
        'unavailable',
        'Microphone access is unavailable. Please check your device settings.'
      );
    }

    const audio = positional
      ? new THREE.PositionalAudio(listener)
      : new THREE.Audio(listener);
    audio.setMediaStreamSource(streamSource);
    if (positional && object) {
      object.add(audio);
    }
    const analyser = await FrequencyAnalyser.create(
      listener.context,
      streamSource,
      fftSize
    );

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;

      if (audio && 'stop' in audio && typeof audio.stop === 'function') {
        audio.stop();
      }

      if (
        audio &&
        'disconnect' in audio &&
        typeof audio.disconnect === 'function'
      ) {
        audio.disconnect();
      }

      analyser?.disconnect();

      if (streamSource) {
        streamSource.getTracks().forEach((track) => track.stop());
      }

      if (camera && 'remove' in camera && listener) {
        (
          camera as THREE.Camera & { remove?: (obj: THREE.Object3D) => void }
        ).remove(listener);
      }

      if (listener?.context?.close) {
        listener.context.close();
      }

      if (positional && object && 'remove' in object) {
        (object as THREE.Object3D & { remove?: (obj: THREE.Object3D) => void })
          .remove?.(audio);
      }

      onCleanup?.({ analyser, listener, audio, stream: streamSource });
    };

    const effectivePermissionState =
      permissionState ?? (streamSource ? ('granted' as PermissionState) : undefined);

    return {
      analyser,
      listener,
      audio,
      stream: streamSource,
      cleanup,
      permissionState: effectivePermissionState,
    };
  } catch (error) {
    console.error('Error accessing audio:', error);

    if (resolvedStream && ownsStream) {
      resolvedStream.getTracks().forEach((track) => track.stop());
    }

    if (listener?.context?.close) {
      listener.context.close();
    }

    if (camera && 'remove' in camera && listener) {
      (
        camera as THREE.Camera & { remove?: (obj: THREE.Object3D) => void }
      ).remove(listener);
    }

    if (error instanceof AudioAccessError) {
      throw error;
    }

    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      ((error as Error).name === 'NotAllowedError' ||
        (error as Error).name === 'PermissionDeniedError')
    ) {
      throw new AudioAccessError(
        'denied',
        'Microphone access was denied by the user.'
      );
    }

    throw new AudioAccessError(
      'unavailable',
      'Microphone access is unavailable. Please check your device settings.'
    );
  }
}

export function getFrequencyData(analyser: FrequencyAnalyser) {
  return analyser.getFrequencyData();
}

/**
 * Compute the average value of frequency data.
 * Replaces the repeated inline `data.reduce((a, b) => a + b, 0) / data.length` pattern.
 */
export function getAverageFrequency(data: Uint8Array): number {
  if (data.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum += data[i];
  }

  return sum / data.length;
}
