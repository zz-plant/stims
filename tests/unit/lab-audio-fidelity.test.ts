/**
 * lab:audio-fidelity's pieces that run without a browser: the frame
 * comparison, the calibration that finds where a live worklet's analysis
 * windows fall in the file, and the lead-in/delay options calibration feeds
 * back into the offline reader.
 */
import { describe, expect, test } from 'bun:test';
import { buildAudioFileInputs } from '../../scripts/audio-file-inputs.ts';
import {
  calibrateLive,
  compareAudioFrames,
} from '../../scripts/lab-audio-fidelity.ts';
import type { FrameInputs } from '../../scripts/preset-lab-replay.ts';
import {
  analyseBlockBytes,
  buildHannWindow,
  buildTwiddleTable,
} from '../../src/js/utils/audio/analyser-core.ts';

const sampleRate = 44100;

/** Noise over a slow chirp: every window's spectrum is distinct. */
function music(seconds: number) {
  let seed = 11;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return (seed / 2 ** 31) * 2 - 1;
  };
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    samples[i] =
      0.3 * Math.sin(2 * Math.PI * (200 + 400 * t) * t) + 0.05 * random();
  }
  return samples;
}

function frame(signals: Record<string, number>, spectrum: number[]) {
  return {
    time: 0,
    deltaMs: 16,
    frequencyData: spectrum,
    waveformData: [],
    signals,
  } satisfies FrameInputs;
}

describe('compareAudioFrames', () => {
  test('identical recordings score perfectly and report their range', () => {
    const frames = [0.5, 1.5, 1, 2].map((bass, i) =>
      frame({ bass }, [i, i + 1]),
    );
    const report = compareAudioFrames(frames, frames);
    expect(report.spectrum.identical).toBe(4);
    const bass = report.signals.find((row) => row.signal === 'bass');
    expect(bass).toMatchObject({ meanAbsDiff: 0, correlation: 1 });
    expect(bass?.liveRange).toEqual([0.5, 2]);
  });

  test('a live frame still showing the previous analysis is counted as late', () => {
    const offline = [frame({}, [1]), frame({}, [2]), frame({}, [3])];
    const live = [frame({}, [1]), frame({}, [1]), frame({}, [3])];
    const report = compareAudioFrames(live, offline);
    expect(report.spectrum.identical).toBe(2);
    expect(report.spectrum.oneMessageBehind).toBe(1);
  });

  test('unrelated signals correlate poorly', () => {
    const live = [1, 2, 3, 4, 5].map((v) => frame({ mid: v }, []));
    const offline = [3, 1, 5, 2, 4].map((v) => frame({ mid: v }, []));
    const mid = compareAudioFrames(live, offline).signals.find(
      (row) => row.signal === 'mid',
    );
    expect(mid?.correlation).toBeLessThan(0.5);
    expect(mid?.maxAbsDiff).toBe(2);
  });
});

// calibrateLive runs one 1024-point analysis per sample it walks back from a
// frame, so these fixtures keep each walk short: the work is frames × delay,
// or the whole search range when nothing matches.
describe('calibrateLive', () => {
  test('recovers the block phase, message phase and delay of a live run', () => {
    const samples = music(1);
    const window = buildHannWindow(1024);
    const twiddles = buildTwiddleTable(1024);
    const scratch = {
      real: new Float32Array(1024),
      imag: new Float32Array(1024),
    };
    // A live worklet whose message windows end at samples ≡ 1777 (mod 4096).
    // 1777 ≡ 753 (mod 1024), so the two phases differ. Each window is
    // displayed 128, 160 or 192 samples after it ends, the first one late, so
    // only the minimum gap reads 128.
    const phase = 1777;
    const delay = 128;
    // Plus one frame that matches nothing in the file and must not count.
    const frames = [{ audioTime: 0.03, rawSpectrum: new Array(512).fill(7) }];
    for (let end = 4096 + phase; end < samples.length; end += 4096) {
      const bytes = new Uint8Array(512);
      analyseBlockBytes(
        samples.slice(end - 1024, end),
        window,
        twiddles,
        bytes,
        scratch,
      );
      frames.push({
        audioTime: (end + delay + ((frames.length + 1) % 3) * 32) / sampleRate,
        rawSpectrum: [...bytes],
      });
    }
    const calibration = calibrateLive(frames, samples, sampleRate, 4096);
    expect(calibration).toMatchObject({
      phase: phase % 1024,
      messagePhase: phase,
      messagePeriod: 4096,
      delaySamples: delay,
      located: frames.length - 1,
    });
  });

  test('returns null when nothing in the file matches', () => {
    // Near the start of the file the search stops at the first full window:
    // ~300 analyses instead of the ~15,000 a frame mid-file would cost.
    const frames = [{ audioTime: 0.03, rawSpectrum: new Array(512).fill(7) }];
    expect(calibrateLive(frames, music(1), sampleRate, 4096)).toBeNull();
  });
});

describe('buildAudioFileInputs lead-in', () => {
  const audio = { sampleRate, channels: [music(1.5)] };
  const spectra = async (leadInSamples: number) =>
    (await buildAudioFileInputs(audio, { frames: 60, leadInSamples })).map(
      (input) => input.frequencyData.join(','),
    );

  test('a whole message period of lead-in keeps the window phase', async () => {
    const plain = await spectra(0);
    expect((await spectra(4096)).slice(20)).toEqual(plain.slice(20));
  });

  test('a partial lead-in moves the analysis windows', async () => {
    const plain = await spectra(0);
    const shifted = await spectra(2048);
    const same = shifted.filter((spectrum, i) => spectrum === plain[i]);
    expect(same.length).toBeLessThan(10);
  });
});
