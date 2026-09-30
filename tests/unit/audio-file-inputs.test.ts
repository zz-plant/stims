/**
 * lab:replay's audio-file path: WAV decoding, and running real audio through
 * the live analyser stack offline.
 *
 * The property that matters is fidelity to the browser: spectra must be the
 * bytes the worklet would post (same code, same bins), and the merged
 * signals must respond to the music the way a live session's do (bass
 * energy lands in bass, a steady tone lands in its own bin, silence is
 * silent). Determinism matters too, because these traces are replayed
 * bit-for-bit.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildAudioFileInputs,
  type DecodedAudio,
  decodeWav,
} from '../../scripts/audio-file-inputs.ts';
import { runTrace } from '../../scripts/preset-lab-replay.ts';
import {
  analyseBlockBytes,
  buildHannWindow,
  buildTwiddleTable,
} from '../../src/js/utils/audio/analyser-core.ts';

/** Builds a WAV file in memory. */
function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  encoding: { code: 1 | 3; bits: 8 | 16 | 24 | 32 },
  extensible = false,
): Uint8Array {
  const bytesPerSample = encoding.bits / 8;
  const blockAlign = channels.length * bytesPerSample;
  const frames = channels[0]?.length ?? 0;
  const fmtSize = extensible ? 40 : 16;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(12 + 8 + fmtSize + 8 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < 4; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, extensible ? 0xfffe : encoding.code, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, encoding.bits, true);
  if (extensible) {
    view.setUint16(36, 22, true);
    view.setUint16(38, encoding.bits, true);
    view.setUint16(44, encoding.code, true); // subformat GUID, first 2 bytes
  }
  const dataOffset = 20 + fmtSize;
  writeText(dataOffset, 'data');
  view.setUint32(dataOffset + 4, dataSize, true);
  let at = dataOffset + 8;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of channels) {
      const value = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      if (encoding.code === 3) {
        view.setFloat32(at, value, true);
      } else if (encoding.bits === 8) {
        view.setUint8(at, Math.round(value * 127) + 128);
      } else if (encoding.bits === 16) {
        view.setInt16(at, Math.round(value * 32767), true);
      } else if (encoding.bits === 24) {
        const raw = Math.round(value * 8388607);
        view.setUint8(at, raw & 0xff);
        view.setUint8(at + 1, (raw >> 8) & 0xff);
        view.setInt8(at + 2, raw >> 16);
      } else {
        view.setInt32(at, Math.round(value * 2147483647), true);
      }
      at += bytesPerSample;
    }
  }
  return new Uint8Array(buffer);
}

/**
 * A sine at `amplitude`. Spectrum tests use a quiet one: the byte mapping
 * tops out at -30 dBFS, so a loud tone saturates its neighbours at 255 too
 * and the peak bin is no longer unique.
 */
function tone(
  frequency: number,
  seconds: number,
  sampleRate: number,
  amplitude = 0.5,
) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] =
      amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }
  return samples;
}

/** A 120 BPM kick drum: a pitch-dropping sine burst every half second. */
function kicks(seconds: number, sampleRate: number) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    const phase = (index / sampleRate) % 0.5;
    samples[index] =
      0.8 *
      Math.exp(-phase * 12) *
      Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-phase * 30)) * phase);
  }
  return samples;
}

describe('decodeWav', () => {
  const sampleRate = 22050;
  const left = tone(441, 0.05, sampleRate);
  const right = tone(882, 0.05, sampleRate);

  for (const encoding of [
    { code: 1, bits: 8, tolerance: 1 / 64 },
    { code: 1, bits: 16, tolerance: 1e-4 },
    { code: 1, bits: 24, tolerance: 1e-6 },
    { code: 1, bits: 32, tolerance: 1e-6 },
    { code: 3, bits: 32, tolerance: 1e-7 },
  ] as const) {
    test(`reads ${encoding.bits}-bit ${encoding.code === 3 ? 'float' : 'PCM'} stereo`, () => {
      const decoded = decodeWav(encodeWav([left, right], sampleRate, encoding));
      expect(decoded.sampleRate).toBe(sampleRate);
      expect(decoded.channels).toHaveLength(2);
      expect(decoded.channels[0]?.length).toBe(left.length);
      for (const index of [0, 7, 100, left.length - 1]) {
        expect(
          Math.abs((decoded.channels[0]?.[index] ?? 0) - (left[index] ?? 0)),
        ).toBeLessThan(encoding.tolerance);
        expect(
          Math.abs((decoded.channels[1]?.[index] ?? 0) - (right[index] ?? 0)),
        ).toBeLessThan(encoding.tolerance);
      }
    });
  }

  test('unwraps WAVE_FORMAT_EXTENSIBLE', () => {
    const decoded = decodeWav(
      encodeWav([left], sampleRate, { code: 1, bits: 16 }, true),
    );
    expect(decoded.channels).toHaveLength(1);
    expect(decoded.channels[0]?.[5]).toBeCloseTo(left[5] ?? 0, 3);
  });

  test('rejects non-WAV input and unsupported encodings', () => {
    expect(() => decodeWav(new TextEncoder().encode('ID3 not a wav'))).toThrow(
      'Not a RIFF/WAVE',
    );
    const alaw = encodeWav([left], sampleRate, { code: 1, bits: 16 });
    new DataView(alaw.buffer).setUint16(20, 6, true); // A-law
    expect(() => decodeWav(alaw)).toThrow('Unsupported WAV encoding');
  });
});

describe('analyseBlockBytes', () => {
  test('a pure tone peaks in its own bin', () => {
    const size = 1024;
    const sampleRate = 44100;
    const bin = 40;
    const block = tone(
      (bin * sampleRate) / size,
      size / sampleRate,
      sampleRate,
      0.02,
    );
    const out = new Uint8Array(size / 2);
    analyseBlockBytes(
      block,
      buildHannWindow(size),
      buildTwiddleTable(size),
      out,
      { real: new Float32Array(size), imag: new Float32Array(size) },
    );
    const peak = out.indexOf(Math.max(...out));
    expect(peak).toBe(bin);
    expect(out[bin]).toBeGreaterThan(200);
    expect(out[bin + 20]).toBeLessThan(out[bin] as number);
  });
});

function bandMean(bytes: number[], from: number, to: number) {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += bytes[index] ?? 0;
  return sum / (to - from);
}

describe('buildAudioFileInputs', () => {
  const sampleRate = 44100;

  test('produces the live bin count and one frame per 1/fps of audio', async () => {
    const audio: DecodedAudio = {
      sampleRate,
      channels: [tone(1000, 1, sampleRate)],
    };
    const inputs = await buildAudioFileInputs(audio, { fps: 30 });
    expect(inputs).toHaveLength(30);
    // The milkdrop engine asks for fftSize 1024 → 512 spectrum bins.
    expect(inputs[10]?.frequencyData).toHaveLength(512);
    expect(inputs[10]?.waveformData).toHaveLength(1024);
    expect(inputs[1]?.time).toBeCloseTo(1 / 30, 10);
    expect(inputs[1]?.deltaMs).toBeCloseTo(1000 / 30, 10);
    for (const input of inputs) {
      expect(input.signals).toBeDefined();
    }
  });

  test('a steady tone lands in its own spectrum bin', async () => {
    // 1024-point FFT at 44.1 kHz: bin width ≈ 43 Hz, so 2 kHz ≈ bin 46.
    const audio: DecodedAudio = {
      sampleRate,
      channels: [tone(2000, 1, sampleRate, 0.02)],
    };
    const inputs = await buildAudioFileInputs(audio, { frames: 40 });
    const spectrum = inputs[39]?.frequencyData ?? [];
    const peak = spectrum.indexOf(Math.max(...spectrum));
    expect(
      Math.abs(peak - Math.round((2000 * 1024) / sampleRate)),
    ).toBeLessThanOrEqual(1);
  });

  test('kick drums drive bass, not treble, and trigger beats', async () => {
    const audio: DecodedAudio = {
      sampleRate,
      channels: [kicks(4, sampleRate)],
    };
    const inputs = await buildAudioFileInputs(audio);
    const late = inputs.slice(60);
    let low = 0;
    let high = 0;
    for (const input of late) {
      low += bandMean(input.frequencyData, 1, 8);
      high += bandMean(input.frequencyData, 200, 400);
    }
    expect(low).toBeGreaterThan(high * 1.5);
    const beats = late.filter((input) => input.signals?.beat === 1).length;
    expect(beats).toBeGreaterThan(0);
    const bassAtt = late.map((input) => Number(input.signals?.bass_att));
    expect(Math.max(...bassAtt) - Math.min(...bassAtt)).toBeGreaterThan(0.1);
  });

  test('stereo input exposes separate left and right spectra', async () => {
    const audio: DecodedAudio = {
      sampleRate,
      channels: [
        tone(500, 1, sampleRate, 0.02),
        tone(5000, 1, sampleRate, 0.02),
      ],
    };
    const inputs = await buildAudioFileInputs(audio, { frames: 40 });
    const arrays = inputs[39]?.arrays ?? {};
    const leftSpectrum = arrays.frequencyDataL?.values ?? [];
    const rightSpectrum = arrays.frequencyDataR?.values ?? [];
    expect(leftSpectrum.indexOf(Math.max(...leftSpectrum))).toBeLessThan(20);
    expect(rightSpectrum.indexOf(Math.max(...rightSpectrum))).toBeGreaterThan(
      100,
    );
  });

  test('--start skips into the file', async () => {
    const silenceThenTone = new Float32Array(sampleRate * 2);
    silenceThenTone.set(tone(2000, 1, sampleRate), sampleRate);
    const audio: DecodedAudio = { sampleRate, channels: [silenceThenTone] };
    const fromStart = await buildAudioFileInputs(audio, { frames: 30 });
    const skipped = await buildAudioFileInputs(audio, {
      frames: 30,
      startSeconds: 1,
    });
    expect(Number(fromStart[29]?.signals?.rms)).toBeLessThan(0.01);
    expect(Number(skipped[29]?.signals?.rms)).toBeGreaterThan(0.05);
  });

  test('is deterministic and replays through the VM bit-for-bit', async () => {
    const audio: DecodedAudio = {
      sampleRate,
      channels: [kicks(1, sampleRate)],
    };
    const first = await buildAudioFileInputs(audio);
    const second = await buildAudioFileInputs(audio);
    expect(second).toEqual(first);
    const preset = `[preset00]
per_frame_1=zoom = 1 + bass_att*0.05;
per_frame_2=q1 = beat_pulse;
`;
    const recorded = runTrace(preset, 'audio-test', first);
    const replayed = runTrace(
      preset,
      'audio-test',
      JSON.parse(JSON.stringify(first)),
    );
    expect(replayed.map((frame) => frame.digest)).toEqual(
      recorded.map((frame) => frame.digest),
    );
    const zooms = recorded.map((frame) => frame.variables?.zoom ?? 0);
    expect(Math.max(...zooms) - Math.min(...zooms)).toBeGreaterThan(0.01);
  });
});

describe("audio-handler.ts's `?worklet` import", () => {
  const repoPath = (path: string) =>
    resolve(import.meta.dirname, '../..', path);
  const workletSpecifier = `${repoPath('src/js/utils/audio/frequency-analyser-processor.ts')}?worklet`;

  test('keeps the test preload mock for later test files', async () => {
    await buildAudioFileInputs(
      { sampleRate: 44100, channels: [new Float32Array(4410)] },
      { frames: 2 },
    );
    const { default: source } = await import(
      '../../src/js/utils/audio/frequency-analyser-processor.ts?worklet'
    );
    expect(source).toContain("registerProcessor('frequency-analyser'");
  });

  // audio-handler.ts is over the 50KB threshold of Bun's on-disk transpiler
  // cache, so what a lab run writes there is what the next process loads.
  test('a lab run leaves no cache entry that breaks a later process', () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'stims-transpiler-cache-'));
    const run = (script: string) => {
      const result = Bun.spawnSync({
        cmd: [process.execPath, '-e', script],
        env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: cacheDir },
      });
      return (
        new TextDecoder().decode(result.stdout) +
        new TextDecoder().decode(result.stderr)
      );
    };
    try {
      expect(
        run(`
          import { buildAudioFileInputs } from ${JSON.stringify(repoPath('scripts/audio-file-inputs.ts'))};
          const frames = await buildAudioFileInputs(
            { sampleRate: 44100, channels: [new Float32Array(4410)] },
            { frames: 2 },
          );
          console.log(frames.length);
        `),
      ).toBe('2\n');
      expect(readdirSync(cacheDir).length).toBeGreaterThan(0);
      // What tests/setup.ts does for every test process.
      expect(
        run(`
          import { mock } from 'bun:test';
          mock.module(${JSON.stringify(workletSpecifier)}, () => ({ default: '' }));
          const handler = await import(${JSON.stringify(repoPath('src/js/core/audio-handler.ts'))});
          console.log(typeof handler.FrequencyAnalyser);
        `),
      ).toBe('function\n');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 30_000);
});
