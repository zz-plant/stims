import Meyda, { type MeydaAudioFeature, type MeydaFeaturesObject } from 'meyda';
import type { Camera, Object3D } from 'three';
import { Audio, AudioListener, PositionalAudio } from 'three';
import workletSource from '../utils/audio/frequency-analyser-processor.ts?worklet';
import {
  createWaveformAutoGain,
  type FourBandTransientMetrics,
  getFourBandTransientMetrics,
  getFrequencyBandLevels,
} from '../utils/audio/reactivity.ts';
import { isInAppBrowser } from '../utils/browser/device-detect.ts';
import { createLogger } from './logger.ts';
import { queryMicrophonePermissionState as querySharedMicrophonePermissionState } from './services/microphone-permission-service.ts';
import { getMockAudioParams } from './url-params.ts';

export type WorkletBeatDetection = {
  isBeat: boolean;
  beatIntensity: number;
  beatBass: boolean;
  beatMid: boolean;
  beatTreble: boolean;
  bassBeatIntensity: number;
  midBeatIntensity: number;
  trebleBeatIntensity: number;
};

const logger = createLogger('AudioHandler');

type AudioAccessReason = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

const FREQUENCY_ANALYSER_PROCESSOR = URL.createObjectURL(
  new Blob([workletSource], { type: 'application/javascript' }),
);
const MEYDA_FEATURES = [
  'rms',
  'spectralCentroid',
  'spectralFlatness',
  'spectralRolloff',
] satisfies MeydaAudioFeature[];

type SpectralFeatureSnapshot = {
  rms: number;
  spectralCentroid: number;
  spectralFlatness: number;
  spectralRolloff: number;
};

const DEFAULT_SAMPLE_RATE = 44_100;
const stylizedFrequencyBuffers = new WeakMap<object, Uint8Array>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export function resolveAdaptiveFftSize(
  sampleRate: number,
  requestedFftSize?: number,
): number {
  if (typeof requestedFftSize === 'number' && requestedFftSize > 0) {
    return requestedFftSize;
  }
  if (sampleRate >= 176_400) return 4096;
  if (sampleRate >= 88_200) return 2048;
  return 1024;
}

export class FrequencyAnalyser {
  frequencyBinCount: number;
  private frequencyData: Uint8Array;
  private previousFrequencyData: Uint8Array | null = null;
  private waveformData: Uint8Array;
  private frequencyDataL: Uint8Array | null = null;
  private frequencyDataR: Uint8Array | null = null;
  private waveformDataL: Uint8Array | null = null;
  private waveformDataR: Uint8Array | null = null;
  private timeDomainData: Float32Array;
  private rms = 0;
  private zeroCrossingRate = 0;
  private spectralFlux = 0;
  private spectralCrest = 1;
  private stereoBalance = 0;
  private stereoWidth = 0;
  private spectralFeatures: SpectralFeatureSnapshot | null = null;
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
  private readonly analyserNodeL?: AnalyserNode;
  private readonly analyserNodeR?: AnalyserNode;
  private readonly sampleRate: number;
  private dataVersion = 0;
  private energyVersion = -1;
  private cachedEnergy = { bass: 0, mid: 0, treble: 0 };
  private cachedEnergyAverages: {
    bass: number;
    mid: number;
    treble: number;
  } | null = null;
  private cachedTransientMetrics: FourBandTransientMetrics | null = null;
  private cachedBeatDetection: WorkletBeatDetection | null = null;
  private readonly waveformAgc = createWaveformAutoGain();
  private waveformGain = 1;
  private normalizedWaveform: Uint8Array | null = null;
  private normalizedWaveformL: Uint8Array | null = null;
  private normalizedWaveformR: Uint8Array | null = null;

  private constructor({
    sourceNode,
    workletNode,
    analyserNode,
    analyserNodeL,
    analyserNodeR,
    fftSize,
    silentGain,
    sampleRate,
  }: {
    sourceNode: MediaStreamAudioSourceNode;
    workletNode?: AudioWorkletNode;
    analyserNode?: AnalyserNode;
    analyserNodeL?: AnalyserNode;
    analyserNodeR?: AnalyserNode;
    fftSize: number;
    silentGain: GainNode;
    sampleRate: number;
  }) {
    this.sourceNode = sourceNode;
    this.workletNode = workletNode;
    this.analyserNode = analyserNode;
    this.analyserNodeL = analyserNodeL;
    this.analyserNodeR = analyserNodeR;
    this.sampleRate = sampleRate;
    this.frequencyBinCount = fftSize / 2;
    this.frequencyData = new Uint8Array(this.frequencyBinCount);
    this.waveformData = new Uint8Array(fftSize);
    this.waveformData.fill(128);
    this.timeDomainData = new Float32Array(fftSize);
    this.silentGain = silentGain;

    if (this.workletNode) {
      this.workletNode.port.onmessage = (event: MessageEvent) => {
        const {
          frequencyData,
          waveformData,
          frequencyDataL,
          frequencyDataR,
          waveformDataL,
          waveformDataR,
          rms,
          zeroCrossingRate,
          spectralFlux,
          spectralCrest,
          stereoBalance,
          stereoWidth,
          timeDomainData,
          energy,
          energyAverages,
          beatDetection,
          transientMetrics,
        } = event.data ?? {};
        if (typeof rms === 'number') this.rms = rms;
        if (typeof zeroCrossingRate === 'number')
          this.zeroCrossingRate = zeroCrossingRate;
        if (typeof spectralFlux === 'number') this.spectralFlux = spectralFlux;
        if (typeof spectralCrest === 'number')
          this.spectralCrest = spectralCrest;
        if (typeof stereoBalance === 'number')
          this.stereoBalance = stereoBalance;
        if (typeof stereoWidth === 'number') this.stereoWidth = stereoWidth;
        if (frequencyData) {
          const nextFreq =
            frequencyData instanceof Uint8Array
              ? frequencyData
              : new Uint8Array(frequencyData);
          if (this.frequencyData.length !== nextFreq.length) {
            this.frequencyData = new Uint8Array(nextFreq.length);
            this.frequencyBinCount = nextFreq.length;
          }
          this.frequencyData.set(nextFreq);
          this.dataVersion += 1;
          if (energy && typeof energy.bass === 'number') {
            this.cachedEnergy = energy;
            this.energyVersion = this.dataVersion;
          } else {
            this.cachedEnergy = this.calculateMultiBandEnergy(
              this.frequencyData,
            );
            this.energyVersion = this.dataVersion;
          }
          this.updateEnergyHistory(this.cachedEnergy);
        }
        if (energyAverages && typeof energyAverages.bass === 'number') {
          this.cachedEnergyAverages = energyAverages;
        }
        if (
          transientMetrics &&
          typeof transientMetrics.subBassEnv === 'number'
        ) {
          this.cachedTransientMetrics = transientMetrics;
        }
        if (beatDetection && typeof beatDetection.beatIntensity === 'number') {
          this.cachedBeatDetection = beatDetection;
        }
        if (waveformData) {
          const nextWave =
            waveformData instanceof Uint8Array
              ? waveformData
              : new Uint8Array(waveformData);
          if (this.waveformData.length !== nextWave.length) {
            this.waveformData = new Uint8Array(nextWave.length);
            this.waveformData.fill(128);
          }
          this.waveformData.set(nextWave);
        }
        if (frequencyDataL && frequencyDataR) {
          this.frequencyDataL = toUint8Array(frequencyDataL);
          this.frequencyDataR = toUint8Array(frequencyDataR);
        } else {
          this.frequencyDataL = null;
          this.frequencyDataR = null;
        }
        if (waveformDataL && waveformDataR) {
          this.waveformDataL = toUint8Array(waveformDataL);
          this.waveformDataR = toUint8Array(waveformDataR);
        } else {
          this.waveformDataL = null;
          this.waveformDataR = null;
        }
        if (timeDomainData) {
          const nextTimeDomain =
            timeDomainData instanceof Float32Array
              ? timeDomainData
              : new Float32Array(timeDomainData);
          if (this.timeDomainData.length !== nextTimeDomain.length) {
            this.timeDomainData = new Float32Array(nextTimeDomain.length);
          }
          this.timeDomainData.set(nextTimeDomain);
          this.updateSpectralFeatures();
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
    fftSize?: number,
    smoothingTimeConstant?: number,
  ): Promise<FrequencyAnalyser> {
    const sourceNode = context.createMediaStreamSource(stream);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    const sampleRate =
      Number.isFinite(context.sampleRate) && context.sampleRate > 0
        ? context.sampleRate
        : DEFAULT_SAMPLE_RATE;
    const effectiveFftSize = resolveAdaptiveFftSize(sampleRate, fftSize);

    let workletNode: AudioWorkletNode | undefined;
    if (context.audioWorklet?.addModule) {
      try {
        // Ensure the AudioContext is running before registering the worklet.
        // Browsers suspend it until a user gesture has been processed, and
        // addModule() or the resulting node may fail silently if suspended.
        if (context.state === 'suspended') {
          await context.resume();
        }
        await context.audioWorklet.addModule(FREQUENCY_ANALYSER_PROCESSOR);
        workletNode = new AudioWorkletNode(context, 'frequency-analyser', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: {
            fftSize: effectiveFftSize,
            sampleRate,
            messageEvery:
              effectiveFftSize >= 1024 ? 4 : effectiveFftSize >= 512 ? 2 : 1,
          },
        });
        sourceNode.connect(workletNode);
      } catch (error) {
        console.warn(
          'AudioWorklet failed, falling back to AnalyserNode',
          error,
        );
      }
    }

    const hasStereoTrack =
      typeof stream.getAudioTracks === 'function' &&
      stream
        .getAudioTracks()
        .some((track) => (track.getSettings().channelCount ?? 1) >= 2);
    let analyserNodeL: AnalyserNode | undefined;
    let analyserNodeR: AnalyserNode | undefined;
    const analyserNode = workletNode
      ? undefined
      : (() => {
          const node = context.createAnalyser();
          node.fftSize = effectiveFftSize;
          if (typeof smoothingTimeConstant === 'number') {
            node.smoothingTimeConstant = smoothingTimeConstant;
          }
          sourceNode.connect(node);

          if (hasStereoTrack) {
            const splitter = context.createChannelSplitter(2);
            analyserNodeL = context.createAnalyser();
            analyserNodeR = context.createAnalyser();
            analyserNodeL.fftSize = effectiveFftSize;
            analyserNodeR.fftSize = effectiveFftSize;
            if (typeof smoothingTimeConstant === 'number') {
              analyserNodeL.smoothingTimeConstant = smoothingTimeConstant;
              analyserNodeR.smoothingTimeConstant = smoothingTimeConstant;
            }
            sourceNode.connect(splitter);
            splitter.connect(analyserNodeL, 0);
            splitter.connect(analyserNodeR, 1);
          }

          return node;
        })();

    const audioNode = workletNode ?? analyserNode;
    if (!audioNode) throw new Error('No audio node available');
    audioNode.connect(silentGain);
    silentGain.connect(context.destination);

    // iOS Safari re-suspends the AudioContext across the awaits above (stream
    // acquisition, worklet addModule). Resume once more now that the graph is
    // fully wired, while we may still be inside the originating user gesture —
    // otherwise the mic is granted but no samples ever flow.
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch (error) {
        console.warn('Failed to resume AudioContext after graph setup', error);
      }
    }

    return new FrequencyAnalyser({
      sourceNode,
      workletNode,
      analyserNode,
      analyserNodeL,
      analyserNodeR,
      fftSize: effectiveFftSize,
      silentGain,
      sampleRate,
    });
  }

  getFrequencyData() {
    this.updateTimeDomainData();
    if (this.frequencyData.length > 0) {
      if (
        !this.previousFrequencyData ||
        this.previousFrequencyData.length !== this.frequencyData.length
      ) {
        this.previousFrequencyData = new Uint8Array(this.frequencyData.length);
      }
      this.previousFrequencyData.set(this.frequencyData);
    }
    if (this.analyserNode) {
      this.analyserNode.getByteFrequencyData(
        this.frequencyData as Uint8Array<ArrayBuffer>,
      );
      this.dataVersion += 1;
      this.updateSpectralFeatures();
    }

    return this.frequencyData;
  }

  getTransientMetrics(
    data?: Uint8Array,
    previousData?: Uint8Array,
  ): FourBandTransientMetrics {
    if (data) {
      return getFourBandTransientMetrics(data, previousData, this.sampleRate);
    }
    if (this.workletNode && this.cachedTransientMetrics) {
      return this.cachedTransientMetrics;
    }
    const current = this.getFrequencyData();
    return getFourBandTransientMetrics(
      current,
      this.previousFrequencyData ?? undefined,
      this.sampleRate,
    );
  }

  getWorkletBeatDetection(): WorkletBeatDetection | null {
    return this.workletNode ? this.cachedBeatDetection : null;
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

    // Quiet sources (the demo track, soft microphones) park every byte near
    // 128, and presets draw that as a flat line. Normalize toward full scale
    // for the visualizer; the raw buffer stays untouched so the gain never
    // compounds across calls.
    this.waveformGain = this.waveformAgc.measure(this.waveformData);
    if (this.waveformGain <= 1) {
      return this.waveformData;
    }
    if (this.normalizedWaveform?.length !== this.waveformData.length) {
      this.normalizedWaveform = new Uint8Array(this.waveformData.length);
    }
    this.waveformAgc.apply(
      this.waveformData,
      this.normalizedWaveform,
      this.waveformGain,
    );
    return this.normalizedWaveform;
  }

  getZeroCrossingRate() {
    return this.zeroCrossingRate;
  }

  getSpectralFlux() {
    return this.spectralFlux;
  }

  getSpectralCrest() {
    return this.spectralCrest;
  }

  getStereoBalance() {
    return this.stereoBalance;
  }

  getStereoWidth() {
    return this.stereoWidth;
  }

  getFrequencyDataL() {
    if (this.analyserNodeL && this.analyserNodeR) {
      if (
        this.frequencyDataL?.length !== this.analyserNodeL.frequencyBinCount
      ) {
        this.frequencyDataL = new Uint8Array(
          this.analyserNodeL.frequencyBinCount,
        );
      }
      this.analyserNodeL.getByteFrequencyData(
        this.frequencyDataL as Uint8Array<ArrayBuffer>,
      );
    }

    return this.frequencyDataL;
  }

  getFrequencyDataR() {
    if (this.analyserNodeL && this.analyserNodeR) {
      if (
        this.frequencyDataR?.length !== this.analyserNodeR.frequencyBinCount
      ) {
        this.frequencyDataR = new Uint8Array(
          this.analyserNodeR.frequencyBinCount,
        );
      }
      this.analyserNodeR.getByteFrequencyData(
        this.frequencyDataR as Uint8Array<ArrayBuffer>,
      );
    }

    return this.frequencyDataR;
  }

  getWaveformDataL() {
    if (this.analyserNodeL && this.analyserNodeR) {
      if (this.waveformDataL?.length !== this.analyserNodeL.fftSize) {
        this.waveformDataL = new Uint8Array(this.analyserNodeL.fftSize);
        this.waveformDataL.fill(128);
      }
      this.analyserNodeL.getByteTimeDomainData(
        this.waveformDataL as Uint8Array<ArrayBuffer>,
      );
    }

    if (!this.waveformDataL || this.waveformGain <= 1) {
      return this.waveformDataL;
    }
    // Reuse the mono AGC gain so both channels scale identically.
    if (this.normalizedWaveformL?.length !== this.waveformDataL.length) {
      this.normalizedWaveformL = new Uint8Array(this.waveformDataL.length);
    }
    this.waveformAgc.apply(
      this.waveformDataL,
      this.normalizedWaveformL,
      this.waveformGain,
    );
    return this.normalizedWaveformL;
  }

  getWaveformDataR() {
    if (this.analyserNodeL && this.analyserNodeR) {
      if (this.waveformDataR?.length !== this.analyserNodeR.fftSize) {
        this.waveformDataR = new Uint8Array(this.analyserNodeR.fftSize);
        this.waveformDataR.fill(128);
      }
      this.analyserNodeR.getByteTimeDomainData(
        this.waveformDataR as Uint8Array<ArrayBuffer>,
      );
    }

    if (!this.waveformDataR || this.waveformGain <= 1) {
      return this.waveformDataR;
    }
    if (this.normalizedWaveformR?.length !== this.waveformDataR.length) {
      this.normalizedWaveformR = new Uint8Array(this.waveformDataR.length);
    }
    this.waveformAgc.apply(
      this.waveformDataR,
      this.normalizedWaveformR,
      this.waveformGain,
    );
    return this.normalizedWaveformR;
  }

  getSpectralFeatures() {
    this.updateTimeDomainData();
    this.updateSpectralFeatures();
    return this.spectralFeatures;
  }

  getSampleRate() {
    return this.sampleRate;
  }

  private updateTimeDomainData() {
    if (!this.analyserNode) {
      return;
    }

    if (typeof this.analyserNode.getFloatTimeDomainData === 'function') {
      this.analyserNode.getFloatTimeDomainData(
        this.timeDomainData as Float32Array<ArrayBuffer>,
      );
      return;
    }

    if (typeof this.analyserNode.getByteTimeDomainData === 'function') {
      const byteData = new Uint8Array(this.timeDomainData.length);
      this.analyserNode.getByteTimeDomainData(byteData);
      for (let i = 0; i < byteData.length; i += 1) {
        this.timeDomainData[i] = (byteData[i] - 128) / 128;
      }
    }
  }

  private updateSpectralFeatures() {
    if (this.timeDomainData.length === 0) {
      return;
    }

    try {
      Meyda.bufferSize = this.timeDomainData.length;
      Meyda.sampleRate = this.sampleRate;
      const features = Meyda.extract(
        MEYDA_FEATURES,
        this.timeDomainData,
      ) as Partial<MeydaFeaturesObject> | null;

      if (!features) {
        return;
      }

      this.spectralFeatures = {
        rms:
          typeof features.rms === 'number' && Number.isFinite(features.rms)
            ? features.rms
            : this.rms,
        spectralCentroid:
          typeof features.spectralCentroid === 'number' &&
          Number.isFinite(features.spectralCentroid)
            ? features.spectralCentroid
            : 0,
        spectralFlatness:
          typeof features.spectralFlatness === 'number' &&
          Number.isFinite(features.spectralFlatness)
            ? features.spectralFlatness
            : 0,
        spectralRolloff:
          typeof features.spectralRolloff === 'number' &&
          Number.isFinite(features.spectralRolloff)
            ? features.spectralRolloff
            : 0,
      };
    } catch {
      // Ignore feature extraction failures and keep the last usable snapshot.
    }
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

  getMultiBandEnergy(data?: Uint8Array) {
    if (data && data !== this.frequencyData) {
      return this.calculateMultiBandEnergy(data);
    }
    const resolvedData = data ?? this.getFrequencyData();
    if (this.energyVersion !== this.dataVersion) {
      this.cachedEnergy = this.calculateMultiBandEnergy(resolvedData);
      this.energyVersion = this.dataVersion;
    }
    return this.cachedEnergy;
  }

  getEnergyAverages() {
    if (this.workletNode && this.cachedEnergyAverages) {
      return this.cachedEnergyAverages;
    }
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
    return this.spectralFeatures?.rms ?? this.rms;
  }

  disconnect() {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
    }
    if (this.analyserNode) {
      this.analyserNode.disconnect();
    }
    if (this.analyserNodeL) {
      this.analyserNodeL.disconnect();
    }
    if (this.analyserNodeR) {
      this.analyserNodeR.disconnect();
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

/**
 * Maps a raw getUserMedia rejection (a DOMException) to an AudioAccessError
 * with an actionable message. Shared by every getUserMedia call site so a
 * denied/busy/missing microphone is always classified the same way,
 * regardless of whether the stream came from initAudio or a pooled stream.
 */
export function classifyAudioAccessError(error: unknown): AudioAccessError {
  if (error instanceof AudioAccessError) {
    return error;
  }

  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    ((error as Error).name === 'NotAllowedError' ||
      (error as Error).name === 'PermissionDeniedError')
  ) {
    return new AudioAccessError(
      'denied',
      'Microphone access was denied. If site permissions are allowed, check OS Privacy Settings (macOS Privacy & Security / Windows Privacy Settings).',
    );
  }

  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as Error).name === 'NotFoundError'
  ) {
    return new AudioAccessError(
      'unavailable',
      'No microphone hardware was found. Please connect a microphone and try again.',
    );
  }

  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    ((error as Error).name === 'NotReadableError' ||
      (error as Error).name === 'TrackStartError')
  ) {
    return new AudioAccessError(
      'unavailable',
      'Microphone hardware is currently in use by another application (e.g. Zoom, Teams, Discord). Please close other apps and try again.',
    );
  }

  return new AudioAccessError(
    'unavailable',
    'Microphone access is unavailable. Please check your device settings.',
  );
}

export type AudioInitOptions = {
  fftSize?: number;
  deviceId?: string;
  smoothingTimeConstant?: number;
  camera?: Camera;
  positional?: boolean;
  object?: Object3D;
  constraints?: MediaStreamConstraints;
  stream?: MediaStream;
  fallbackToSynthetic?: boolean;
  preferSynthetic?: boolean;
  onCleanup?: (ctx: {
    analyser: FrequencyAnalyser;
    listener: AudioListener;
    audio: Audio | PositionalAudio;
    stream?: MediaStream;
  }) => void;
  /**
   * Invoked when the underlying stream's audio track ends unexpectedly
   * (mic permission revoked, device unplugged, tab/display share or
   * YouTube capture stopped from the browser's native UI). Not called for
   * intentional teardown via `cleanup()` — `MediaStreamTrack.stop()` does
   * not fire the browser's `ended` event.
   */
  onStreamEnded?: () => void;
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

const activeContexts = new Set<AudioContext>();
const activeStreams = new Set<MediaStream>();
const unmuteHandlerTracks = new WeakSet<MediaStreamTrack>();

let resumeOnVisibleInstalled = false;

function tryResumeAllActiveContexts() {
  for (const context of activeContexts) {
    if (context.state === 'suspended') {
      context.resume().catch((err) => {
        logger.log('Failed to resume AudioContext on user interaction:', err);
      });
    }
  }
}

const handleTrackUnmute = () => {
  logger.log('Microphone track unmuted; resuming active audio contexts.');
  tryResumeAllActiveContexts();
};

/**
 * Mobile browsers (iOS Safari, Android Chrome/Samsung Internet) suspend
 * AudioContexts until an explicit user gesture or when tab visibility changes.
 * Attempt to resume every registered context on visibility change or user tap.
 */
function installResumeOnVisible() {
  if (resumeOnVisibleInstalled) return;
  if (typeof document === 'undefined' || !document.addEventListener) return;
  resumeOnVisibleInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    tryResumeAllActiveContexts();
  });

  const handleUserGesture = () => {
    tryResumeAllActiveContexts();
  };

  document.addEventListener('pointerdown', handleUserGesture, {
    capture: true,
    passive: true,
  });
  document.addEventListener('touchstart', handleUserGesture, {
    capture: true,
    passive: true,
  });
  document.addEventListener('keydown', handleUserGesture, {
    capture: true,
    passive: true,
  });
}

// ── AudioContext / stream lifecycle ──────────────────────────────────
// The ordering invariants (no leak, permission-before-mount, generation
// race) are formalised in `audio-lifecycle.ts`. See that module and
// `tests/unit/audio-lifecycle.test.ts` for the contract.

export function registerAudioContext(context: AudioContext) {
  activeContexts.add(context);
  installResumeOnVisible();
}

export function unregisterAudioContext(context: AudioContext) {
  activeContexts.delete(context);
}

export function registerMediaStream(stream: MediaStream) {
  activeStreams.add(stream);

  if (typeof stream.getAudioTracks === 'function') {
    for (const track of stream.getAudioTracks()) {
      track.onunmute = handleTrackUnmute;
      unmuteHandlerTracks.add(track);
    }
  }
}

export function unregisterMediaStream(stream: MediaStream) {
  activeStreams.delete(stream);

  if (typeof stream.getAudioTracks === 'function') {
    for (const track of stream.getAudioTracks()) {
      if (
        unmuteHandlerTracks.delete(track) &&
        track.onunmute === handleTrackUnmute
      ) {
        track.onunmute = null;
      }
    }
  }
}

export function stopAllAudioForBfcache() {
  for (const stream of activeStreams) {
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      logger.log(
        'Failed to stop active stream track during bfcache teardown:',
        err,
      );
    }
  }
  activeStreams.clear();

  for (const context of activeContexts) {
    try {
      if (context.state !== 'closed') {
        context.close();
      }
    } catch (err) {
      logger.log(
        'Failed to close active AudioContext during bfcache teardown:',
        err,
      );
    }
  }
  activeContexts.clear();

  if (cachedDemoAudio) {
    try {
      cachedDemoAudio.teardown();
    } catch (err) {
      logger.log(
        'Failed to teardown cached demo audio during bfcache teardown:',
        err,
      );
    }
    cachedDemoAudio = null;
    cachedDemoUsers = 0;
  }
}

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
  registerAudioContext(context);

  const oscillator = context.createOscillator();
  oscillator.frequency.value = frequency;
  oscillator.type = type;

  const gainNode = context.createGain();
  gainNode.gain.value = gain;

  const destination = context.createMediaStreamDestination();
  registerMediaStream(destination.stream);

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
    unregisterMediaStream(destination.stream);
    unregisterAudioContext(context);
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
  registerAudioContext(context);

  const mainGain = context.createGain();
  mainGain.gain.value = 0.12;
  const destination = context.createMediaStreamDestination();
  registerMediaStream(destination.stream);
  mainGain.connect(destination);

  // ── Arpeggiator ──────────────────────────────────────────────
  // Cycles through notes of a chord at 8th-note tempo.
  // Each step retunes the oscillator and shapes with a quick envelope.
  const voice = context.createOscillator();
  voice.type = 'triangle';
  voice.frequency.value = 220;

  const voiceEnv = context.createGain();
  voiceEnv.gain.value = 0;
  voice.connect(voiceEnv);
  voiceEnv.connect(mainGain);

  const chord = [220, 277.2, 329.6, 440, 554.4]; // A3, C#4, E4, A4, C#5
  const bpm = 112;
  const stepMs = (60 / bpm) * 1000 * 0.5; // 8th notes
  const attackMs = 8;
  const releaseMs = 80;
  let stepIndex = 0;

  const scheduleStep = () => {
    const now = context.currentTime;
    const hz = chord[stepIndex % chord.length];
    voice.frequency.setValueAtTime(hz, now);
    voiceEnv.gain.cancelScheduledValues(now);
    voiceEnv.gain.setValueAtTime(0, now);
    voiceEnv.gain.linearRampToValueAtTime(0.55, now + attackMs / 1000);
    voiceEnv.gain.linearRampToValueAtTime(0, now + releaseMs / 1000);
    stepIndex += 1;
  };

  let intervalId: ReturnType<typeof setInterval> | null = setInterval(
    scheduleStep,
    stepMs,
  );

  // ── Drums ─────────────────────────────────────────────────────
  // Kick on beats 1 & 3. Hi-hat on every 8th note.
  // Pre-built noise buffer for hats (reused per hit).
  const noiseBuffer = (() => {
    const len = context.sampleRate * 0.1;
    const buf = context.createBuffer(1, len, context.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    return buf;
  })();

  // Patch the scheduleStep to add drums.
  const originalSchedule = scheduleStep;
  const patchedStep = () => {
    const now = context.currentTime;
    const beat = stepIndex; // snapshot before arp increments it

    originalSchedule();

    // Kick: sine with fast pitch drop on 1 and 3
    if (beat % 4 === 0 || beat % 4 === 2) {
      const kick = context.createOscillator();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(120, now);
      kick.frequency.exponentialRampToValueAtTime(30, now + 0.08);
      const kickGain = context.createGain();
      kickGain.gain.setValueAtTime(0.45, now);
      kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      kick.connect(kickGain);
      kickGain.connect(mainGain);
      kick.start(now);
      kick.stop(now + 0.2);
    }

    // Hi-hat: noise burst, short decay, on every step
    const hat = context.createBufferSource();
    hat.buffer = noiseBuffer;
    const hipass = context.createBiquadFilter();
    hipass.type = 'highpass';
    hipass.frequency.value = 8000;
    const hatGain = context.createGain();
    hatGain.gain.setValueAtTime(0.1, now);
    hatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    hat.connect(hipass);
    hipass.connect(hatGain);
    hatGain.connect(mainGain);
    hat.start(now);
    hat.stop(now + 0.08);
  };

  if (intervalId !== null) {
    clearInterval(intervalId);
  }
  intervalId = setInterval(patchedStep, stepMs);

  // ── Sub drone ────────────────────────────────────────────────
  // A quiet 55 Hz sine anchors the low end so the visualizer's
  // bass band always has signal, even between arpeggiator notes.
  const sub = context.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 55;
  const subGain = context.createGain();
  subGain.gain.value = 0.18;
  sub.connect(subGain);
  subGain.connect(mainGain);

  voice.start();
  sub.start();

  // ── Teardown ─────────────────────────────────────────────────
  const resume = async () => {
    if (context.state === 'running') return;
    await context.resume();
  };

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    try {
      voice.stop();
      sub.stop();
    } catch (err) {
      logger.log('Failed to stop demo audio oscillators:', err);
    }
  };

  const disconnect = async () => {
    stop();
    voice.disconnect();
    voiceEnv.disconnect();
    sub.disconnect();
    subGain.disconnect();
    mainGain.disconnect();
    unregisterMediaStream(destination.stream);
    unregisterAudioContext(context);
    try {
      await context.close();
    } catch (err) {
      logger.log('Failed to close demo audio context during disconnect:', err);
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
    fftSize = 1024,
    smoothingTimeConstant,
    camera,
    positional = false,
    object,
    constraints,
    stream,
    onCleanup,
    onStreamEnded,
    stopStreamOnCleanup = true,
    closeContextOnCleanup = true,
    monitorInput = false,
  } = options;

  const mockParams = getMockAudioParams();
  const mockAudioType = mockParams.type;
  let mockCleanup: (() => void | Promise<void>) | undefined;

  let listener: AudioListener | null = null;
  let resolvedStream: MediaStream | null = null;
  let ownsStream = false;
  let permissionState: PermissionState | undefined;

  if (!mockAudioType || stream) {
    if (typeof navigator === 'undefined') {
      throw new AudioAccessError(
        'unsupported',
        'Audio capture is not available in this environment.',
      );
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const isHttpInsecure =
        typeof window !== 'undefined' && window.isSecureContext === false;
      const isAppBrowser = isInAppBrowser();
      const reasonMsg = isHttpInsecure
        ? 'Microphone access requires HTTPS or localhost. Non-secure HTTP addresses (e.g. LAN IPs) block audio capture.'
        : isAppBrowser
          ? "In-app browsers (Instagram, TikTok, Twitter) may block microphone capture. Tap '...' and select 'Open in Safari/Chrome'."
          : 'This browser does not support microphone capture.';
      throw new AudioAccessError('unsupported', reasonMsg);
    }
  }

  try {
    const activeListener = new AudioListener();
    listener = activeListener;
    registerAudioContext(activeListener.context);
    if (activeListener.context.state === 'suspended') {
      await activeListener.context.resume();
    }
    if (camera) {
      camera.add(activeListener);
    }

    if (stream) {
      resolvedStream = stream;
    } else if (mockAudioType) {
      if (mockAudioType === 'demo') {
        const demo = getCachedDemoAudioStream();
        resolvedStream = demo.stream;
        mockCleanup = demo.cleanup;
        await demo.resume();
      } else {
        const type = ['sine', 'square', 'sawtooth', 'triangle'].includes(
          mockAudioType,
        )
          ? mockAudioType
          : 'sawtooth';
        const frequency = mockParams.frequency ?? 220;
        const synth = createSyntheticAudioStream({
          frequency,
          type: type as OscillatorType,
        });
        resolvedStream = synth.stream;
        mockCleanup = synth.cleanup;
        await synth.resume();
      }
      ownsStream = true;
      permissionState = 'granted';
    } else if (options.preferSynthetic) {
      // Use the procedural demo track (arpeggio + kick + sub drone), not a
      // bare oscillator: a constant sawtooth has a frozen spectrum, so every
      // band level and beat detector flatlines and presets stop reacting.
      const demo = getCachedDemoAudioStream();
      resolvedStream = demo.stream;
      mockCleanup = demo.cleanup;
      await demo.resume();
      ownsStream = true;
      permissionState = 'granted';
    } else {
      permissionState = await queryMicrophonePermissionState();

      if (permissionState === 'denied') {
        if (options.fallbackToSynthetic) {
          const demo = getCachedDemoAudioStream();
          resolvedStream = demo.stream;
          mockCleanup = demo.cleanup;
          await demo.resume();
          ownsStream = true;
          permissionState = 'granted';
        } else {
          throw new AudioAccessError(
            'denied',
            'Microphone access is blocked. Allow microphone access in site settings and OS Privacy Settings (macOS Privacy & Security / Windows Privacy Settings).',
          );
        }
      } else {
        const effectiveConstraints: MediaStreamConstraints = constraints ?? {
          audio: {
            ...(typeof DEFAULT_MICROPHONE_CONSTRAINTS.audio === 'object'
              ? DEFAULT_MICROPHONE_CONSTRAINTS.audio
              : {}),
            ...(options.deviceId
              ? { deviceId: { exact: options.deviceId } }
              : {}),
          },
        };

        try {
          resolvedStream =
            await navigator.mediaDevices.getUserMedia(effectiveConstraints);
          ownsStream = true;
          permissionState = permissionState ?? 'granted';
        } catch (error) {
          if (options.fallbackToSynthetic) {
            const demo = getCachedDemoAudioStream();
            resolvedStream = demo.stream;
            mockCleanup = demo.cleanup;
            await demo.resume();
            ownsStream = true;
            permissionState = 'granted';
          } else {
            throw error;
          }
        }
      }
    }

    const streamSource = resolvedStream;
    if (!streamSource) {
      throw new AudioAccessError(
        'unavailable',
        'Microphone access is unavailable. Please check your device settings.',
      );
    }
    registerMediaStream(streamSource);

    // Detect the stream dying out from under us (mic permission revoked,
    // device unplugged, tab/display share or YouTube capture stopped from
    // the browser's native chrome) so callers can recover instead of
    // silently animating on frozen/zero audio data forever. `stop()` does
    // not fire `ended`, so this only fires for unexpected termination.
    let cleanedUp = false;
    let streamEndedNotified = false;
    const audioTracks = streamSource.getAudioTracks?.() ?? [];
    const handleStreamTrackEnded = () => {
      if (cleanedUp || streamEndedNotified) return;
      streamEndedNotified = true;
      onStreamEnded?.();
    };
    for (const track of audioTracks) {
      track.addEventListener('ended', handleStreamTrackEnded);
    }

    const audio = positional
      ? new PositionalAudio(activeListener)
      : new Audio(activeListener);
    audio.setMediaStreamSource(streamSource);
    if (!monitorInput && 'setVolume' in audio) {
      (audio as Audio).setVolume(0);
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

    const cleanup = async () => {
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
        for (const track of audioTracks) {
          track.removeEventListener('ended', handleStreamTrackEnded);
        }
        unregisterMediaStream(streamSource);
        if (stopStreamOnCleanup) {
          streamSource.getTracks().forEach((track) => track.stop());
        }
      }

      if (mockCleanup) {
        try {
          await mockCleanup();
        } catch (err) {
          logger.log('Failed to execute mockCleanup:', err);
        }
      }

      if (camera && 'remove' in camera && listener) {
        (camera as Camera & { remove?: (obj: Object3D) => void }).remove(
          listener,
        );
      }

      if (listener?.context) {
        unregisterAudioContext(listener.context);
        if (closeContextOnCleanup && listener.context.close) {
          listener.context.close();
        }
      }

      if (positional && object && 'remove' in object) {
        (object as Object3D & { remove?: (obj: Object3D) => void }).remove?.(
          audio,
        );
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
      cleanup: cleanup as () => void | Promise<void>,
      permissionState: effectivePermissionState,
    };
  } catch (error) {
    console.error('Error accessing audio:', error);

    if (mockCleanup) {
      try {
        await mockCleanup();
      } catch (err) {
        logger.log(
          'Failed to execute mockCleanup during setup error handling:',
          err,
        );
      }
    }

    if (resolvedStream) {
      unregisterMediaStream(resolvedStream);
      if (ownsStream) {
        resolvedStream.getTracks().forEach((track) => track.stop());
      }
    }

    if (listener?.context) {
      unregisterAudioContext(listener.context);
      if (closeContextOnCleanup && listener.context.close) {
        listener.context.close();
      }
    }

    if (camera && 'remove' in camera && listener) {
      (camera as Camera & { remove?: (obj: Object3D) => void }).remove(
        listener,
      );
    }

    throw classifyAudioAccessError(error);
  }
}

export function getFrequencyData(analyser: FrequencyAnalyser) {
  const rawFrequencyData = analyser.getFrequencyData();
  const key = analyser as unknown as object;
  let stylized = stylizedFrequencyBuffers.get(key);
  if (!stylized || stylized.length !== rawFrequencyData.length) {
    stylized = new Uint8Array(rawFrequencyData.length);
    stylizedFrequencyBuffers.set(key, stylized);
  }
  stylized.set(rawFrequencyData);

  return stylizeFrequencyData(stylized);
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
