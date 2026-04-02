import * as THREE from 'three';
import { queryMicrophonePermissionState as querySharedMicrophonePermissionState } from './services/microphone-permission-service.ts';

type AudioAccessReason = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

const FREQUENCY_ANALYSER_PROCESSOR = new URL(
  '../utils/frequency-analyser-processor.ts',
  import.meta.url,
);

const DEFAULT_FREQUENCY_BAND_RANGES = {
  bass: { minHz: 24, maxHz: 320 },
  mid: { minHz: 320, maxHz: 2800 },
  treble: { minHz: 2800, maxHz: 12000 },
} as const;
const DEFAULT_SAMPLE_RATE = 44_100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveBandIndexes(
  dataLength: number,
  sampleRate: number,
  range: { minHz: number; maxHz: number },
) {
  if (dataLength <= 0 || sampleRate <= 0) {
    return { start: 0, end: 0 };
  }

  const fftSize = dataLength * 2;
  const resolutionHz = sampleRate / fftSize;
  const nyquistHz = sampleRate / 2;
  const minHz = clamp(range.minHz, 0, nyquistHz);
  const maxHz = clamp(Math.max(minHz, range.maxHz), 0, nyquistHz);
  const start = clamp(Math.floor(minHz / resolutionHz), 0, dataLength - 1);
  const end = clamp(Math.ceil(maxHz / resolutionHz), start + 1, dataLength);

  return { start, end };
}

function getBandAverageForRange(
  data: Uint8Array,
  sampleRate: number,
  range: { minHz: number; maxHz: number },
  band: 'bass' | 'mid' | 'treble',
) {
  if (data.length === 0) return 0;

  const { start, end } = resolveBandIndexes(data.length, sampleRate, range);
  if (end <= start) return 0;

  let sum = 0;
  let weightTotal = 0;

  for (let index = start; index < end; index += 1) {
    const position =
      end - start <= 1 ? 0 : (index - start) / Math.max(1, end - start - 1);
    const weight =
      band === 'bass'
        ? 1.2 - position * 0.3
        : band === 'treble'
          ? 0.9 + position * 0.25
          : 1;
    sum += (data[index] ?? 0) * weight;
    weightTotal += weight;
  }

  return weightTotal > 0 ? sum / weightTotal : 0;
}

function getFrequencyBandLevels(data: Uint8Array, sampleRate: number) {
  if (data.length === 0) {
    return { bass: 0, mid: 0, treble: 0 };
  }

  return {
    bass:
      getBandAverageForRange(
        data,
        sampleRate,
        DEFAULT_FREQUENCY_BAND_RANGES.bass,
        'bass',
      ) / 255,
    mid:
      getBandAverageForRange(
        data,
        sampleRate,
        DEFAULT_FREQUENCY_BAND_RANGES.mid,
        'mid',
      ) / 255,
    treble:
      getBandAverageForRange(
        data,
        sampleRate,
        DEFAULT_FREQUENCY_BAND_RANGES.treble,
        'treble',
      ) / 255,
  };
}

export class FrequencyAnalyser {
  frequencyBinCount: number;
  private frequencyData: Uint8Array;
  private waveformData: Uint8Array;
  private rms = 0;
  private readonly historySize = 64;
  private energyHistory: { bass: number[]; mid: number[]; treble: number[] } = {
    bass: new Array(this.historySize).fill(0),
    mid: new Array(this.historySize).fill(0),
    treble: new Array(this.historySize).fill(0),
  };
  private historyIndex = 0;
  private historyCount = 0;
  private readonly sourceNode: MediaStreamAudioSourceNode;
  private readonly silentGain: GainNode;
  private readonly workletNode?: AudioWorkletNode;
  private readonly analyserNode?: AnalyserNode;
  private readonly sampleRate: number;
  private dataVersion = 0;
  private energyVersion = -1;
  private cachedEnergy = { bass: 0, mid: 0, treble: 0 };

  private constructor({
    sourceNode,
    workletNode,
    analyserNode,
    fftSize,
    silentGain,
    sampleRate,
  }: {
    sourceNode: MediaStreamAudioSourceNode;
    workletNode?: AudioWorkletNode;
    analyserNode?: AnalyserNode;
    fftSize: number;
    silentGain: GainNode;
    sampleRate: number;
  }) {
    this.sourceNode = sourceNode;
    this.workletNode = workletNode;
    this.analyserNode = analyserNode;
    this.sampleRate = sampleRate;
    this.frequencyBinCount = fftSize / 2;
    this.frequencyData = new Uint8Array(this.frequencyBinCount);
    this.waveformData = new Uint8Array(fftSize);
    this.waveformData.fill(128);
    this.silentGain = silentGain;

    if (this.workletNode) {
      this.workletNode.port.onmessage = (event: MessageEvent) => {
        const { frequencyData, waveformData, rms } = event.data ?? {};
        if (frequencyData) {
          const nextData =
            frequencyData instanceof Uint8Array
              ? frequencyData
              : new Uint8Array(frequencyData);
          if (this.frequencyData.length !== nextData.length) {
            this.frequencyData = new Uint8Array(nextData.length);
            this.frequencyBinCount = nextData.length;
          }
          this.frequencyData.set(nextData);
          this.dataVersion += 1;
          this.cachedEnergy = this.calculateMultiBandEnergy(this.frequencyData);
          this.energyVersion = this.dataVersion;
          this.updateEnergyHistory(this.cachedEnergy);
        }
        if (waveformData) {
          const nextWaveform =
            waveformData instanceof Uint8Array
              ? waveformData
              : new Uint8Array(waveformData);
          if (this.waveformData.length !== nextWaveform.length) {
            this.waveformData = new Uint8Array(nextWaveform.length);
            this.waveformData.fill(128);
          }
          this.waveformData.set(nextWaveform);
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
            processorOptions: {
              fftSize,
              messageEvery: fftSize >= 512 ? 2 : 1,
            },
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
          sampleRate:
            Number.isFinite(context.sampleRate) && context.sampleRate > 0
              ? context.sampleRate
              : DEFAULT_SAMPLE_RATE,
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
      sampleRate:
        Number.isFinite(context.sampleRate) && context.sampleRate > 0
          ? context.sampleRate
          : DEFAULT_SAMPLE_RATE,
    });
  }

  getFrequencyData() {
    if (this.analyserNode) {
      this.analyserNode.getByteFrequencyData(
        this.frequencyData as Uint8Array<ArrayBuffer>,
      );
      this.dataVersion += 1;
    }

    return this.frequencyData;
  }

  getWaveformData() {
    if (this.analyserNode) {
      if (this.waveformData.length !== this.analyserNode.fftSize) {
        this.waveformData = new Uint8Array(this.analyserNode.fftSize);
        this.waveformData.fill(128);
      }
      this.analyserNode.getByteTimeDomainData(
        this.waveformData as Uint8Array<ArrayBuffer>,
      );
    }

    return this.waveformData;
  }

  private calculateMultiBandEnergy(data: Uint8Array) {
    return getFrequencyBandLevels(data, this.sampleRate);
  }

  private updateEnergyHistory(energy = this.getMultiBandEnergy()) {
    const { bass, mid, treble } = energy;
    this.energyHistory.bass[this.historyIndex] = bass;
    this.energyHistory.mid[this.historyIndex] = mid;
    this.energyHistory.treble[this.historyIndex] = treble;
    this.historyIndex = (this.historyIndex + 1) % this.historySize;
    this.historyCount = Math.min(this.historyCount + 1, this.historySize);
  }

  getMultiBandEnergy() {
    const data = this.getFrequencyData();
    if (this.energyVersion !== this.dataVersion) {
      this.cachedEnergy = this.calculateMultiBandEnergy(data);
      this.energyVersion = this.dataVersion;
    }
    return this.cachedEnergy;
  }

  getEnergyAverages() {
    const avg = (arr: number[]) => {
      if (this.historyCount === 0) return 0;
      let total = 0;
      for (let i = 0; i < this.historyCount; i += 1) {
        total += arr[i] ?? 0;
      }
      return total / this.historyCount;
    };
    return {
      bass: avg(this.energyHistory.bass),
      mid: avg(this.energyHistory.mid),
      treble: avg(this.energyHistory.treble),
    };
  }

  getRmsLevel() {
    return this.rms;
  }

  getSampleRate() {
    return this.sampleRate;
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
  const state = await querySharedMicrophonePermissionState();
  if (state === 'unsupported' || state === 'unknown') {
    return undefined;
  }
  return state;
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
  monitorInput?: boolean;
};

export const DEFAULT_MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
  },
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

  const resume = async () => {
    if (context.state === 'running') {
      return;
    }
    await context.resume();
  };

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

  return { stream: destination.stream, cleanup, resume };
}

let cachedDemoAudio: {
  stream: MediaStream;
  teardown: () => Promise<void> | void;
  resume: () => Promise<void>;
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

  const resume = async () => {
    if (context.state === 'running') {
      return;
    }
    await context.resume();
  };

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

  return { stream: destination.stream, teardown: disconnect, resume };
}

export function getCachedDemoAudioStream() {
  if (!cachedDemoAudio) {
    cachedDemoAudio = createProceduralDemoAudio();
  }

  cachedDemoUsers += 1;
  let released = false;

  return {
    stream: cachedDemoAudio.stream,
    resume: () => cachedDemoAudio?.resume() ?? Promise.resolve(),
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
    monitorInput = false,
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

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new AudioAccessError(
      'unsupported',
      'This browser does not support microphone capture.',
    );
  }

  try {
    const activeListener = new THREE.AudioListener();
    listener = activeListener;
    if (activeListener.context.state === 'suspended') {
      await activeListener.context.resume();
    }
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
        constraints ?? DEFAULT_MICROPHONE_CONSTRAINTS,
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
    if (!monitorInput && 'setVolume' in audio) {
      (audio as THREE.Audio).setVolume(0);
    }
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
  const rawFrequencyData = analyser.getFrequencyData();

  return stylizeFrequencyData(rawFrequencyData.slice());
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
 * Shape live frequency data into a more presentation-friendly curve.
 * This keeps subtle bins visible, gives bass-led tracks more body, and
 * preserves enough treble sparkle that most toys feel more musical.
 */
export function stylizeFrequencyData(data: Uint8Array): Uint8Array {
  const len = data.length;
  if (len === 0) return data;

  let peak = 0;
  for (let i = 0; i < len; i += 1) {
    peak = Math.max(peak, data[i] ?? 0);
  }

  if (peak === 0) {
    return data;
  }

  const average = getAverageFrequency(data);
  const averageNormalized = average / 255;
  const activity = clamp((averageNormalized - 0.045) / 0.22, 0, 1);

  if (activity === 0 && peak < 26) {
    for (let i = 0; i < len; i += 1) {
      data[i] = Math.max(0, Math.round((data[i] ?? 0) * 0.55));
    }
    return data;
  }

  const peakNormalization = clamp(160 / Math.max(72, peak), 0.96, 1.38);
  const lowLift = 1 + activity * (0.22 + (1 - averageNormalized) * 0.08);
  const midLift = 1 + activity * (0.12 + (1 - averageNormalized) * 0.05);
  const highLift = 1 + activity * (0.12 + averageNormalized * 0.08);

  let previousValue = data[0] ?? 0;
  for (let i = 0; i < len; i += 1) {
    const raw = (data[i] ?? 0) / 255;
    const ratio = len > 1 ? i / (len - 1) : 0;
    const curve = raw ** (0.96 - activity * 0.16);
    const bucketLift =
      ratio < 0.12
        ? lowLift + activity * (1 - ratio / 0.12) * 0.12
        : ratio < 0.56
          ? midLift
          : highLift + activity * Math.max(0, ratio - 0.72) * 0.24;
    const transientLift =
      i === 0
        ? 0
        : clamp(
            (raw - previousValue / 255) * (0.22 + activity * 0.33),
            0,
            0.12,
          );
    const shaped = clamp(
      curve * (1 + (peakNormalization - 1) * activity) * bucketLift,
      0,
      1,
    );
    const blendAmount = 0.12 + activity * 0.54;
    const blended =
      raw * (1 - blendAmount) + shaped * blendAmount + transientLift;

    data[i] = Math.round(clamp(blended, 0, 1) * 255);
    previousValue = data[i];
  }

  return data;
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
