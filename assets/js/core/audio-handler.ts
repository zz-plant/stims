import Meyda, { type MeydaAudioFeature, type MeydaFeaturesObject } from 'meyda';
import type { Camera, Object3D } from 'three';
import { Audio, AudioListener, PositionalAudio } from 'three';
import { getFrequencyBandLevels } from '../utils/audio-reactivity.ts';
import { queryMicrophonePermissionState as querySharedMicrophonePermissionState } from './services/microphone-permission-service.ts';

type AudioAccessReason = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

const FREQUENCY_ANALYSER_PROCESSOR = new URL(
  '../utils/frequency-analyser-processor.ts',
  import.meta.url,
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

export class FrequencyAnalyser {
  frequencyBinCount: number;
  private frequencyData: Uint8Array;
  private waveformData: Uint8Array;
  private frequencyDataL: Uint8Array | null = null;
  private frequencyDataR: Uint8Array | null = null;
  private waveformDataL: Uint8Array | null = null;
  private waveformDataR: Uint8Array | null = null;
  private timeDomainData: Float32Array;
  private rms = 0;
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
          timeDomainData,
        } = event.data ?? {};
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
          this.cachedEnergy = this.calculateMultiBandEnergy(this.frequencyData);
          this.energyVersion = this.dataVersion;
          this.updateEnergyHistory(this.cachedEnergy);
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
    fftSize: number,
    smoothingTimeConstant?: number,
  ): Promise<FrequencyAnalyser> {
    const sourceNode = context.createMediaStreamSource(stream);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    const sampleRate =
      Number.isFinite(context.sampleRate) && context.sampleRate > 0
        ? context.sampleRate
        : DEFAULT_SAMPLE_RATE;

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
            fftSize,
            messageEvery: fftSize >= 1024 ? 4 : fftSize >= 512 ? 2 : 1,
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
          node.fftSize = fftSize;
          if (typeof smoothingTimeConstant === 'number') {
            node.smoothingTimeConstant = smoothingTimeConstant;
          }
          sourceNode.connect(node);

          if (hasStereoTrack) {
            const splitter = context.createChannelSplitter(2);
            analyserNodeL = context.createAnalyser();
            analyserNodeR = context.createAnalyser();
            analyserNodeL.fftSize = fftSize;
            analyserNodeR.fftSize = fftSize;
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

    return new FrequencyAnalyser({
      sourceNode,
      workletNode,
      analyserNode,
      analyserNodeL,
      analyserNodeR,
      fftSize,
      silentGain,
      sampleRate,
    });
  }

  getFrequencyData() {
    this.updateTimeDomainData();
    if (this.analyserNode) {
      this.analyserNode.getByteFrequencyData(
        this.frequencyData as Uint8Array<ArrayBuffer>,
      );
      this.dataVersion += 1;
      this.updateSpectralFeatures();
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

    return this.waveformDataL;
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

    return this.waveformDataR;
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

export type AudioInitOptions = {
  fftSize?: number;
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

export function registerAudioContext(context: AudioContext) {
  activeContexts.add(context);
}

export function unregisterAudioContext(context: AudioContext) {
  activeContexts.delete(context);
}

export function registerMediaStream(stream: MediaStream) {
  activeStreams.add(stream);
}

export function unregisterMediaStream(stream: MediaStream) {
  activeStreams.delete(stream);
}

export function stopAllAudioForBfcache() {
  for (const stream of activeStreams) {
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch (_) {}
  }
  activeStreams.clear();

  for (const context of activeContexts) {
    try {
      if (context.state !== 'closed') {
        context.close();
      }
    } catch (_) {}
  }
  activeContexts.clear();

  if (cachedDemoAudio) {
    try {
      cachedDemoAudio.teardown();
    } catch (_) {}
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
    } catch (_) {}
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
    } catch (_) {}
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
    stopStreamOnCleanup = true,
    closeContextOnCleanup = true,
    monitorInput = false,
  } = options;

  const urlParams =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null;
  const mockAudioType = urlParams?.get('mockAudio');
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
      throw new AudioAccessError(
        'unsupported',
        'This browser does not support microphone capture.',
      );
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
        const mockFreqVal = urlParams?.get('mockFrequency');
        const frequency = mockFreqVal ? parseFloat(mockFreqVal) : 220;
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
    registerMediaStream(streamSource);

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

    let cleanedUp = false;
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
        unregisterMediaStream(streamSource);
        if (stopStreamOnCleanup) {
          streamSource.getTracks().forEach((track) => track.stop());
        }
      }

      if (mockCleanup) {
        try {
          await mockCleanup();
        } catch (_) {}
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
      } catch (_) {}
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
