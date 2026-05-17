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
  sampleRate = 44100,
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

import type { AudioFrame, BandLevels, BeatState } from './audio';

interface StreamFrame extends Omit<AudioFrame, 'progress' | 'waveform'> {
  progress: number;
  waveform: Float64Array;
}

export async function* streamAudioFrames(
  sampleRate: number,
): AsyncGenerator<StreamFrame> {
  const { computeSpectrum } = await import('./fft');
  const FFT_SIZE = 1024;

  const smoothed: BandLevels & { sub: number } = {
    bass: 0,
    mid: 0,
    treble: 0,
    sub: 0,
  };
  const prevBands = { bass: 0, mid: 0, treble: 0 };
  const baselines = { bass: 0, mid: 0, treble: 0, energy: 0 };
  let beatIntensity = 0;
  let bassBeatIntensity = 0;
  let midBeatIntensity = 0;
  let trebleBeatIntensity = 0;
  let lastBeatMs = 0;
  let rmsSmooth = 0;
  let frameCount = 0;
  const startTime = Date.now();

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

      const bands: BandLevels = {
        bass: getBandAvg(spectrum, 0.0, 0.12),
        mid: getBandAvg(spectrum, 0.12, 0.5),
        treble: getBandAvg(spectrum, 0.5, 0.9),
      };

      const nowMs = Date.now();
      const deltaMs = Math.max(1, Math.min(50, 1000 / 30));

      smoothed.bass = smoothLevel(smoothed.bass, bands.bass, deltaMs, 34, 130);
      smoothed.mid = smoothLevel(smoothed.mid, bands.mid, deltaMs, 42, 110);
      smoothed.treble = smoothLevel(
        smoothed.treble,
        bands.treble,
        deltaMs,
        28,
        85,
      );
      rmsSmooth = smoothLevel(rmsSmooth, rms, deltaMs, 44, 180);

      const weightedEnergy =
        smoothed.bass * 0.58 + smoothed.mid * 0.27 + smoothed.treble * 0.15;

      const baselineCoeff = Math.exp(-deltaMs / 260);
      baselines.bass =
        baselines.bass * baselineCoeff + smoothed.bass * (1 - baselineCoeff);
      baselines.mid =
        baselines.mid * baselineCoeff + smoothed.mid * (1 - baselineCoeff);
      baselines.treble =
        baselines.treble * baselineCoeff +
        smoothed.treble * (1 - baselineCoeff);

      const bassRise = Math.max(0, bands.bass - prevBands.bass);
      const midRise = Math.max(0, bands.mid - prevBands.mid);
      const trebleRise = Math.max(0, bands.treble - prevBands.treble);
      prevBands.bass = bands.bass;
      prevBands.mid = bands.mid;
      prevBands.treble = bands.treble;

      const isBeatBass =
        bassRise > 0.016 && Math.max(0, smoothed.bass - baselines.bass) > 0.08;
      const isBeatMid = midRise > 0.011;
      const isBeatTreble = trebleRise > 0.008;
      const isBeat = isBeatBass || isBeatMid || isBeatTreble;

      if (isBeatBass) {
        bassBeatIntensity = Math.min(
          1,
          0.35 +
            Math.max(0, smoothed.bass - baselines.bass) * 2.1 +
            bassRise * 3.6,
        );
        lastBeatMs = nowMs;
      } else {
        bassBeatIntensity *= 0.88 ** Math.max(0.25, deltaMs / 16.67);
      }
      if (isBeatMid) {
        midBeatIntensity = Math.min(1, 0.35 + midRise * 2.8);
      } else {
        midBeatIntensity *= 0.88 ** Math.max(0.25, deltaMs / 16.67);
      }
      if (isBeatTreble) {
        trebleBeatIntensity = Math.min(1, 0.35 + trebleRise * 2.2);
      } else {
        trebleBeatIntensity *= 0.88 ** Math.max(0.25, deltaMs / 16.67);
      }
      beatIntensity = isBeat
        ? Math.max(bassBeatIntensity, midBeatIntensity, trebleBeatIntensity)
        : beatIntensity * 0.88 ** Math.max(0.25, deltaMs / 16.67);

      const beat: BeatState = {
        isBeat,
        isBeatBass,
        isBeatMid,
        isBeatTreble,
        beatIntensity,
        spectralFlux: (bassRise + midRise + trebleRise) / 3,
      };

      frameCount += 1;

      yield {
        time: (nowMs - startTime) / 1000,
        progress: 0,
        bands,
        smoothedBands: {
          bass: smoothed.bass,
          mid: smoothed.mid,
          treble: smoothed.treble,
        },
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

function getBandAvg(
  spectrum: Float64Array,
  startRatio: number,
  endRatio: number,
): number {
  const len = spectrum.length;
  const start = Math.floor(startRatio * len);
  const end = Math.min(Math.floor(endRatio * len), len);
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += spectrum[i] ?? 0;
  const avg = sum / (end - start);
  return Number.isFinite(avg) ? avg : 0;
}

function smoothLevel(
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
