import * as THREE from 'three';

type AudioAccessReason = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

const FREQUENCY_ANALYSER_PROCESSOR = new URL(
  './frequency-analyser-processor.ts',
  import.meta.url,
);

export class FrequencyAnalyser {
  frequencyBinCount: number;
  private frequencyData: Uint8Array;
  private rms = 0;
  private readonly historySize = 64;
  private energyHistory: { bass: number[]; mid: number[]; treble: number[] } = {
    bass: [],
    mid: [],
    treble: [],
  };
  private readonly sourceNode: MediaStreamAudioSourceNode;
  private readonly silentGain: GainNode;
  private readonly workletNode?: AudioWorkletNode;
  private readonly analyserNode?: AnalyserNode;

  private constructor({
    sourceNode,
    workletNode,
    analyserNode,
    fftSize,
    silentGain,
  }: {
    sourceNode: MediaStreamAudioSourceNode;
    workletNode?: AudioWorkletNode;
    analyserNode?: AnalyserNode;
    fftSize: number;
    silentGain: GainNode;
  }) {
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
          this.updateEnergyHistory();
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
    fftSize: number,
    smoothingTimeConstant?: number,
  ): Promise<FrequencyAnalyser> {
    const sourceNode = context.createMediaStreamSource(stream);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;

    if (context.audioWorklet?.addModule) {
      try {
        await context.audioWorklet.addModule(FREQUENCY_ANALYSER_PROCESSOR);

        const workletNode = new AudioWorkletNode(
          context,
          'frequency-analyser',
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: { fftSize },
          },
        );

        sourceNode.connect(workletNode);
        workletNode.connect(silentGain);
        silentGain.connect(context.destination);

        return new FrequencyAnalyser({
          sourceNode,
          workletNode,
          fftSize,
          silentGain,
        });
      } catch (error) {
        console.warn(
          'Falling back to AnalyserNode after AudioWorklet failure',
          error,
        );
      }
    }

    const analyserNode = context.createAnalyser();
    analyserNode.fftSize = fftSize;
    if (typeof smoothingTimeConstant === 'number') {
      analyserNode.smoothingTimeConstant = smoothingTimeConstant;
    }
    sourceNode.connect(analyserNode);
    analyserNode.connect(silentGain);
    silentGain.connect(context.destination);

    return new FrequencyAnalyser({
      sourceNode,
      analyserNode,
      fftSize,
      silentGain,
    });
  }

  getFrequencyData() {
    if (this.analyserNode) {
      // biome-ignore lint/suspicious/noExplicitAny: ArrayBuffer mismatch
      this.analyserNode.getByteFrequencyData(this.frequencyData as any);
    }

    return this.frequencyData;
  }

  private updateEnergyHistory() {
    const { bass, mid, treble } = this.getMultiBandEnergy();

    this.energyHistory.bass.push(bass);
    this.energyHistory.mid.push(mid);
    this.energyHistory.treble.push(treble);

    if (this.energyHistory.bass.length > this.historySize) {
      this.energyHistory.bass.shift();
      this.energyHistory.mid.shift();
      this.energyHistory.treble.shift();
    }
  }

  getMultiBandEnergy() {
    const data = this.getFrequencyData();
    const len = data.length;

    // Traditional bands: Bass (20-200Hz), Mid (200-2kHz), Treble (2k-20kHz)
    // Approximation based on index:
    const bassEnd = Math.floor(len * 0.1);
    const midEnd = Math.floor(len * 0.5);

    let bassSum = 0;
    for (let i = 0; i < bassEnd; i++) bassSum += data[i];

    let midSum = 0;
    for (let i = bassEnd; i < midEnd; i++) midSum += data[i];

    let trebleSum = 0;
    for (let i = midEnd; i < len; i++) trebleSum += data[i];

    return {
      bass: bassSum / (bassEnd || 1) / 255,
      mid: midSum / (midEnd - bassEnd || 1) / 255,
      treble: trebleSum / (len - midEnd || 1) / 255,
    };
  }

  getEnergyAverages() {
    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return {
      bass: avg(this.energyHistory.bass),
      mid: avg(this.energyHistory.mid),
      treble: avg(this.energyHistory.treble),
    };
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

async function queryMicrophonePermissionState(): Promise<
  PermissionState | undefined
> {
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
  smoothingTimeConstant?: number;
  camera?: THREE.Camera;
  positional?: boolean;
  object?: THREE.Object3D;
  constraints?: MediaStreamConstraints;
  stream?: MediaStream;
  fallbackToSynthetic?: boolean;
  preferSynthetic?: boolean;
  onCleanup?: (ctx: {
    analyser: FrequencyAnalyser;
    listener: THREE.AudioListener;
    audio: THREE.Audio | THREE.PositionalAudio;
    stream?: MediaStream;
  }) => void;
  stopStreamOnCleanup?: boolean;
  closeContextOnCleanup?: boolean;
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

let cachedDemoAudio: {
  stream: MediaStream;
  teardown: () => Promise<void> | void;
} | null = null;
let cachedDemoUsers = 0;

function createProceduralDemoAudio() {
  const context = new AudioContext();

  const carrier = context.createOscillator();
  carrier.type = 'triangle';
  carrier.frequency.value = 172;

  const harmonic = context.createOscillator();
  harmonic.type = 'sine';
  harmonic.frequency.value = 0.32;

  const harmonicGain = context.createGain();
  harmonicGain.gain.value = 110;
  harmonic.connect(harmonicGain);
  harmonicGain.connect(carrier.frequency);

  const wobble = context.createOscillator();
  wobble.type = 'sine';
  wobble.frequency.value = 2.25;

  const wobbleGain = context.createGain();
  wobbleGain.gain.value = 0.12;

  const mainGain = context.createGain();
  mainGain.gain.value = 0.14;

  wobble.connect(wobbleGain);
  wobbleGain.connect(mainGain.gain);

  const destination = context.createMediaStreamDestination();

  carrier.connect(mainGain);
  mainGain.connect(destination);

  carrier.start();
  harmonic.start();
  wobble.start();

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      carrier.stop();
      harmonic.stop();
      wobble.stop();
    } catch (error) {
      console.error('Error stopping procedural demo audio nodes', error);
    }
  };

  const disconnect = async () => {
    stop();
    carrier.disconnect();
    harmonic.disconnect();
    wobble.disconnect();
    harmonicGain.disconnect();
    wobbleGain.disconnect();
    mainGain.disconnect();
    try {
      await context.close();
    } catch (error) {
      console.error('Error closing procedural demo audio context', error);
    }
  };

  return { stream: destination.stream, teardown: disconnect };
}

export function getCachedDemoAudioStream() {
  if (!cachedDemoAudio) {
    cachedDemoAudio = createProceduralDemoAudio();
  }

  cachedDemoUsers += 1;
  let released = false;

  return {
    stream: cachedDemoAudio.stream,
    cleanup: async () => {
      if (released) return;
      released = true;
      cachedDemoUsers = Math.max(0, cachedDemoUsers - 1);
      if (cachedDemoUsers === 0 && cachedDemoAudio) {
        await cachedDemoAudio.teardown();
        cachedDemoAudio = null;
      }
    },
  };
}

export async function initAudio(options: AudioInitOptions = {}) {
  const {
    fftSize = 256,
    smoothingTimeConstant,
    camera,
    positional = false,
    object,
    constraints,
    stream,
    onCleanup,
    stopStreamOnCleanup = true,
    closeContextOnCleanup = true,
  } = options;

  let listener: THREE.AudioListener | null = null;
  let resolvedStream: MediaStream | null = null;
  let ownsStream = false;
  let permissionState: PermissionState | undefined;

  if (typeof navigator === 'undefined') {
    throw new AudioAccessError(
      'unsupported',
      'Audio capture is not available in this environment.',
    );
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new AudioAccessError(
      'unsupported',
      'This browser does not support microphone capture.',
    );
  }

  try {
    const activeListener = new THREE.AudioListener();
    listener = activeListener;
    if (camera) {
      camera.add(activeListener);
    }

    if (stream) {
      resolvedStream = stream;
    } else {
      permissionState = await queryMicrophonePermissionState();

      if (permissionState === 'denied') {
        throw new AudioAccessError(
          'denied',
          'Microphone access is blocked. Please allow microphone access in your browser settings and try again.',
        );
      }

      resolvedStream = await navigator.mediaDevices.getUserMedia(
        constraints ?? { audio: { echoCancellation: true } },
      );
      ownsStream = true;
      permissionState = permissionState ?? 'granted';
    }

    const streamSource = resolvedStream;
    if (!streamSource) {
      throw new AudioAccessError(
        'unavailable',
        'Microphone access is unavailable. Please check your device settings.',
      );
    }

    const audio = positional
      ? new THREE.PositionalAudio(activeListener)
      : new THREE.Audio(activeListener);
    audio.setMediaStreamSource(streamSource);
    if (positional && object) {
      object.add(audio);
    }
    const analyser = await FrequencyAnalyser.create(
      activeListener.context,
      streamSource,
      fftSize,
      smoothingTimeConstant,
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

      if (streamSource && stopStreamOnCleanup) {
        streamSource.getTracks().forEach((track) => track.stop());
      }

      if (camera && 'remove' in camera && listener) {
        (
          camera as THREE.Camera & { remove?: (obj: THREE.Object3D) => void }
        ).remove(listener);
      }

      if (listener?.context?.close && closeContextOnCleanup) {
        listener.context.close();
      }

      if (positional && object && 'remove' in object) {
        (
          object as THREE.Object3D & { remove?: (obj: THREE.Object3D) => void }
        ).remove?.(audio);
      }

      onCleanup?.({
        analyser,
        listener: activeListener,
        audio,
        stream: streamSource,
      });
    };

    const effectivePermissionState =
      permissionState ??
      (streamSource ? ('granted' as PermissionState) : undefined);

    return {
      analyser,
      listener: activeListener,
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

    if (listener?.context?.close && closeContextOnCleanup) {
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
        'Microphone access was denied by the user.',
      );
    }

    throw new AudioAccessError(
      'unavailable',
      'Microphone access is unavailable. Please check your device settings.',
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

/**
 * Compute a weighted, slightly boosted average that leans into bass/mid energy.
 * Useful for more expressive audio-driven motion.
 */
export function getWeightedAverageFrequency(data: Uint8Array): number {
  const len = data.length;
  if (len === 0) return 0;

  const bassEnd = Math.max(1, Math.floor(len * 0.12));
  const midEnd = Math.max(bassEnd + 1, Math.floor(len * 0.5));

  let bassSum = 0;
  for (let i = 0; i < bassEnd; i += 1) {
    bassSum += data[i];
  }

  let midSum = 0;
  for (let i = bassEnd; i < midEnd; i += 1) {
    midSum += data[i];
  }

  let trebleSum = 0;
  for (let i = midEnd; i < len; i += 1) {
    trebleSum += data[i];
  }

  const bassAvg = bassSum / bassEnd / 255;
  const midAvg = midSum / Math.max(1, midEnd - bassEnd) / 255;
  const trebleAvg = trebleSum / Math.max(1, len - midEnd) / 255;

  const weighted = bassAvg * 0.6 + midAvg * 0.25 + trebleAvg * 0.15;
  const boosted = Math.min(1, weighted ** 0.65 * 1.2);

  return boosted * 255;
}
