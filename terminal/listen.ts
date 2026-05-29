export interface ListenSetup {
  platform: string;
  deviceName: string;
  command: string[];
  hint: string;
}

function detectPlatform(): string {
  const plat = process.platform;
  if (plat === 'darwin') return 'macos';
  if (plat === 'linux') return 'linux';
  return 'unknown';
}

function detectBlackHole(): string | null {
  try {
    const result = Bun.spawnSync(
      ['ffmpeg', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const output = new TextDecoder().decode(result.stderr);
    for (const line of output.split('\n')) {
      if (line.includes('BlackHole')) {
        const match = line.match(/\[(\d+)\]\s+(.+)$/);
        if (match) return match[2]!.trim();
      }
    }
  } catch {}
  return null;
}

function detectPulseSource(): string | null {
  try {
    const result = Bun.spawnSync(['pactl', 'list', 'sources', 'short'], {
      stdout: 'pipe',
      stderr: 'null',
    });
    const output = new TextDecoder().decode(result.stdout);
    for (const line of output.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[1] ?? '';
        if (name.includes('monitor')) return name;
      }
    }
  } catch {}
  return null;
}

export function detectListenSetup(): ListenSetup {
  const platform = detectPlatform();

  if (platform === 'macos') {
    const blackhole = detectBlackHole();
    if (blackhole) {
      return {
        platform: 'macos',
        deviceName: blackhole,
        command: [
          'ffmpeg',
          '-f',
          'avfoundation',
          '-i',
          `:${blackhole}`,
          '-f',
          's16le',
          '-ar',
          '44100',
          '-ac',
          '1',
          'pipe:1',
        ],
        hint: `Capturing from: ${blackhole}`,
      };
    }
    return {
      platform: 'macos',
      deviceName: 'BlackHole (not found)',
      command: [],
      hint:
        'No BlackHole detected. Install: brew install blackhole-2ch\n' +
        'Then set BlackHole as your system output in Audio MIDI Setup\n' +
        'and use the multi-output device to hear audio while capturing.',
    };
  }

  if (platform === 'linux') {
    const source = detectPulseSource();
    if (source) {
      return {
        platform: 'linux',
        deviceName: source,
        command: [
          'ffmpeg',
          '-f',
          'pulse',
          '-i',
          source,
          '-f',
          's16le',
          '-ar',
          '44100',
          '-ac',
          '1',
          'pipe:1',
        ],
        hint: `Capturing from: ${source}`,
      };
    }
    return {
      platform: 'linux',
      deviceName: 'pulse monitor (not found)',
      command: [],
      hint:
        'No PulseAudio monitor source found.\n' +
        'Try: pactl load-module module-loopback\n' +
        'Or use --loopback with an existing monitor source name.',
    };
  }

  return {
    platform: 'unknown',
    deviceName: 'unsupported',
    command: [],
    hint: `System audio capture is not supported on ${process.platform}.`,
  };
}

export async function* readPcmFromStdin(
  _sampleRate = 44100,
): AsyncGenerator<Float64Array> {
  const reader = Bun.stdin.stream().getReader();
  const buffer = new Int16Array(4096);
  const buf = new Uint8Array(buffer.buffer);
  let bufOff = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    let chunkOff = 0;
    while (chunkOff < value.length) {
      const remaining = buf.length - bufOff;
      const copyLen = Math.min(remaining, value.length - chunkOff);
      buf.set(value.subarray(chunkOff, chunkOff + copyLen), bufOff);
      bufOff += copyLen;
      chunkOff += copyLen;

      if (bufOff === buf.length) {
        const samples = new Float64Array(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
          samples[i] = (buffer[i] ?? 0) / 32768;
        }
        bufOff = 0;
        yield samples;
      }
    }
  }
}

import type { BeatTrackerUpdate } from '../assets/js/utils/audio-beat';
import { createBeatTracker } from '../assets/js/utils/audio-beat';
import {
  getBandLevels,
  getWeightedEnergy,
} from '../assets/js/utils/audio-reactivity';
import type { AudioFrame, BeatState } from './audio';

interface StreamFrame extends Omit<AudioFrame, 'progress' | 'waveform'> {
  progress: number;
  waveform: Float64Array;
}

function toUint8Spectrum(spectrum: Float64Array): Uint8Array {
  const out = new Uint8Array(spectrum.length);
  for (let i = 0; i < spectrum.length; i++) {
    out[i] = Math.min(255, Math.max(0, Math.round((spectrum[i] ?? 0) * 21.25)));
  }
  return out;
}

function smoothValue(
  current: number,
  next: number,
  deltaMs: number,
  attackMs: number,
  releaseMs: number,
): number {
  const tc = next > current ? attackMs : releaseMs;
  const coeff = Math.exp(-Math.max(0, deltaMs) / tc);
  return current * coeff + next * (1 - coeff);
}

function beatUpdateToState(u: BeatTrackerUpdate): BeatState {
  return {
    isBeat: u.isBeat,
    isBeatBass: u.beatBass,
    isBeatMid: u.beatMid,
    isBeatTreble: u.beatTreble,
    beatIntensity: u.beatIntensity,
    spectralFlux: u.spectralFlux,
  };
}

export async function* streamAudioFrames(
  sampleRate: number,
): AsyncGenerator<StreamFrame> {
  const { computeSpectrum } = await import('./fft');
  const FFT_SIZE = 1024;

  let rmsSmooth = 0;
  let _frameCount = 0;
  let prevFrameMs = 0;
  const startTime = Date.now();

  const beatTracker = createBeatTracker();

  let sampleBuffer = new Float64Array(0);

  for await (const chunk of readPcmFromStdin(sampleRate)) {
    sampleBuffer = concatFloat64(sampleBuffer, chunk);

    while (sampleBuffer.length >= FFT_SIZE) {
      const window = new Float64Array(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) {
        window[i] = sampleBuffer[i] ?? 0;
      }
      sampleBuffer = sampleBuffer.subarray(FFT_SIZE);

      const { spectrum, rms } = computeSpectrum(window, FFT_SIZE);

      const bands = getBandLevels({ data: toUint8Spectrum(spectrum) });

      const weightedEnergy = getWeightedEnergy(bands);

      const nowMs = Date.now();
      const deltaMs = prevFrameMs
        ? Math.max(1, Math.min(50, nowMs - prevFrameMs))
        : 1000 / 30;
      prevFrameMs = nowMs;

      rmsSmooth = smoothValue(rmsSmooth, rms, deltaMs, 44, 180);

      const trackerResult = beatTracker.update(
        { bands, weightedEnergy, deltaMs },
        nowMs,
      );

      const beat = beatUpdateToState(trackerResult);

      _frameCount += 1;

      yield {
        time: (nowMs - startTime) / 1000,
        progress: 0,
        bands,
        smoothedBands: trackerResult.smoothedBands,
        spectrum,
        waveform: window,
        rms,
        rmsSmoothed: rmsSmooth,
        beat,
        weightedEnergy,
      };
    }
  }
}

function concatFloat64(a: Float64Array, b: Float64Array): Float64Array {
  const c = new Float64Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}
