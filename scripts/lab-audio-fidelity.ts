/**
 * Lab audio fidelity: plays a WAV through the real audio stack in Chromium and diffs it, frame by frame, against the offline audio-file reader.
 *
 * `lab:replay --audio` and `lab:dataset --audio` claim that a WAV analysed
 * offline (scripts/audio-file-inputs.ts) yields what the visualizer would
 * have produced live. This tool measures that claim end to end instead of
 * assuming it:
 *
 *   live     a page on the Vite dev server imports the app's own modules,
 *            plays the file through a real AudioContext at the file's sample
 *            rate into FrequencyAnalyser.create() (so the AudioWorklet runs on
 *            the audio thread and its messages cross a real message port), and
 *            at every animation frame records the audio position together
 *            with the spectrum, waveform and merged signals, calling
 *            getContextFrequencyData and the signal tracker as the frame loop
 *            does.
 *   offline  buildAudioFileInputs on the same samples, evaluated at exactly
 *            the audio positions the browser rendered at.
 *
 * It reports, per signal, the mean and max absolute difference and the
 * correlation, plus how many spectra matched byte for byte. The one
 * difference expected by construction is message timing: the browser
 * delivers a worklet message a little after the audio thread posts it, so a
 * live frame can still hold the previous analysis. The report counts those
 * frames separately ("one message behind") rather than hiding them.
 *
 *   bun run lab:audio-fidelity -- --audio song.wav [--seconds 10] [--start 0]
 *   bun run lab:audio-fidelity -- --audio song.wav --out report.json
 *
 * Exits 1 when a core band signal correlates below --min-correlation
 * (default 0.98). Runs in real time: 10 s of audio takes ~10 s plus startup.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  analyseBlockBytes,
  buildHannWindow,
  buildTwiddleTable,
} from 'audio-reactive';
import { buildAudioFileInputs, decodeWav } from './audio-file-inputs.ts';
import { ensureDevServer } from './dev-server.ts';
import type { FrameInputs } from './preset-lab-replay.ts';

const PORT = 5197;
/** Lead time before playback starts, so the first frames are not racing it. */
const START_DELAY_SECONDS = 0.25;

/** Signals the report compares; the first six are the gate's core bands. */
export const FIDELITY_SIGNALS = [
  'bass',
  'mid',
  'treb',
  'bass_att',
  'mid_att',
  'treb_att',
  'rms',
  'vol',
  'beat',
  'beat_pulse',
] as const;
const CORE_SIGNALS = FIDELITY_SIGNALS.slice(0, 6);

export type SignalFidelity = {
  signal: string;
  meanAbsDiff: number;
  maxAbsDiff: number;
  correlation: number;
  /** [min, max] of the live values: a perfect score over a flat line proves nothing. */
  liveRange: [number, number];
};

export type FidelityReport = {
  frames: number;
  spectrum: {
    /** Frames whose spectrum bytes match offline exactly. */
    identical: number;
    /** Frames that match offline's previous frame instead: a late message. */
    oneMessageBehind: number;
    meanAbsByteDiff: number;
  };
  signals: SignalFidelity[];
};

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 1;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[i] as number;
    meanB += b[i] as number;
  }
  meanA /= n;
  meanB /= n;
  let covariance = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (a[i] as number) - meanA;
    const db = (b[i] as number) - meanB;
    covariance += da * db;
    varA += da * da;
    varB += db * db;
  }
  // Two constant series agree perfectly when equal, not at all otherwise.
  if (varA === 0 || varB === 0) {
    return a.every((value, i) => value === b[i]) ? 1 : 0;
  }
  return covariance / Math.sqrt(varA * varB);
}

function sameBytes(a: readonly number[], b: readonly number[] | undefined) {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Frame-by-frame comparison of a live recording against offline inputs. */
export function compareAudioFrames(
  live: readonly FrameInputs[],
  offline: readonly FrameInputs[],
): FidelityReport {
  const frames = Math.min(live.length, offline.length);
  let identical = 0;
  let oneMessageBehind = 0;
  let byteDiff = 0;
  let byteCount = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const liveBytes = (live[frame] as FrameInputs).frequencyData;
    const offlineBytes = (offline[frame] as FrameInputs).frequencyData;
    if (sameBytes(liveBytes, offlineBytes)) {
      identical += 1;
    } else if (sameBytes(liveBytes, offline[frame - 1]?.frequencyData)) {
      oneMessageBehind += 1;
    }
    for (let bin = 0; bin < liveBytes.length; bin += 1) {
      byteDiff += Math.abs(
        (liveBytes[bin] as number) - (offlineBytes[bin] ?? 0),
      );
      byteCount += 1;
    }
  }
  const signals = FIDELITY_SIGNALS.map((signal) => {
    const read = (inputs: readonly FrameInputs[]) =>
      inputs
        .slice(0, frames)
        .map((input) => Number(input.signals?.[signal] ?? 0));
    const liveValues = read(live);
    const offlineValues = read(offline);
    let sum = 0;
    let max = 0;
    liveValues.forEach((value, i) => {
      const diff = Math.abs(value - (offlineValues[i] as number));
      sum += diff;
      max = Math.max(max, diff);
    });
    return {
      signal,
      meanAbsDiff: frames ? sum / frames : 0,
      maxAbsDiff: max,
      correlation: pearson(liveValues, offlineValues),
      liveRange: [
        Math.min(...liveValues, Number.POSITIVE_INFINITY),
        Math.max(...liveValues, Number.NEGATIVE_INFINITY),
      ] as [number, number],
    };
  });
  return {
    frames,
    spectrum: {
      identical,
      oneMessageBehind,
      meanAbsByteDiff: byteCount ? byteDiff / byteCount : 0,
    },
    signals,
  };
}

type LiveFrame = FrameInputs & { audioTime: number; rawSpectrum: number[] };

const FFT_SIZE = 1024;

export type Calibration = {
  /** Frames whose raw spectrum was located exactly in the file. */
  located: number;
  /** Block phase: live analysis windows end at samples ≡ phase (mod 1024). */
  phase: number;
  /** Message phase: windows posted as messages end at ≡ this (mod the message period). */
  messagePhase: number;
  messagePeriod: number;
  /** Smallest gap, in samples, between a window's end and the frame that showed it. */
  delaySamples: number;
};

/**
 * Finds where in the file each sampled live frame's raw spectrum came from,
 * by recomputing the worklet's analysis (analyseBlockBytes, the same code)
 * over every window end in a search range and taking exact byte matches.
 * The window ends give the live worklet's block phase and message phase;
 * the smallest gap between a window's end and the frame that displayed it
 * gives the constant part of the delivery delay.
 */
export function calibrateLive(
  frames: ReadonlyArray<{ audioTime: number; rawSpectrum: number[] }>,
  samples: Float32Array,
  sampleRate: number,
  messagePeriod: number,
): Calibration | null {
  const window = buildHannWindow(FFT_SIZE);
  const twiddles = buildTwiddleTable(FFT_SIZE);
  const block = new Float32Array(FFT_SIZE);
  const out = new Uint8Array(FFT_SIZE / 2);
  const scratch = {
    real: new Float32Array(FFT_SIZE),
    imag: new Float32Array(FFT_SIZE),
  };
  const ends: Array<{ end: number; gap: number }> = [];
  // Sample frames spread over the clip, skipping silence (every window of
  // silence matches every other).
  const candidates = frames.filter((frame) =>
    frame.rawSpectrum.some((value) => value > 0),
  );
  const step = Math.max(1, Math.floor(candidates.length / 12));
  for (let index = 0; index < candidates.length; index += step) {
    const frame = candidates[index] as (typeof candidates)[number];
    const position = Math.round(frame.audioTime * sampleRate);
    // A frame shows a window that ended before it: at most one message
    // period of staleness plus a generous allowance for delivery latency.
    const lowest = position - messagePeriod - Math.round(sampleRate * 0.25);
    for (let end = position; end >= Math.max(FFT_SIZE, lowest); end -= 1) {
      for (let i = 0; i < FFT_SIZE; i += 1) {
        block[i] = samples[end - FFT_SIZE + i] ?? 0;
      }
      analyseBlockBytes(block, window, twiddles, out, scratch);
      let same = true;
      for (let bin = 0; bin < out.length; bin += 1) {
        if (out[bin] !== frame.rawSpectrum[bin]) {
          same = false;
          break;
        }
      }
      if (same) {
        ends.push({ end, gap: position - end });
        break;
      }
    }
  }
  if (ends.length === 0) return null;
  const mod = (value: number, base: number) => ((value % base) + base) % base;
  const first = ends[0] as { end: number };
  return {
    located: ends.length,
    phase: mod(first.end, FFT_SIZE),
    messagePhase: mod(first.end, messagePeriod),
    messagePeriod,
    delaySamples: Math.min(...ends.map((entry) => entry.gap)),
  };
}

/** Plays `channels` through the real audio stack in Chromium. */
async function recordLive(
  channels: Float32Array[],
  sampleRate: number,
  seconds: number,
): Promise<LiveFrame[]> {
  const { chromium } = await import('playwright');
  const server = await ensureDevServer(PORT, process.cwd());
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage();
    if (process.env.LAB_DEBUG) {
      page.on('framenavigated', (f) => console.log('NAV', f.url()));
      page.on('console', (m) =>
        console.log('PAGE', m.type(), m.text().slice(0, 160)),
      );
      page.on('pageerror', (e) => console.log('PAGEERR', e.message));
    }
    // A static same-origin document, not the app: the visualizer's own
    // render loop would compete for animation frames (and on a software
    // rasteriser starve them), and the harness only needs the dev server to
    // serve the audio modules.
    await page.goto(`http://127.0.0.1:${PORT}/robots.txt`, {
      waitUntil: 'load',
    });
    // The first import of these modules can make Vite optimise a dependency
    // and reload the page, which would kill a recording mid-way. Import them
    // once up front and let any reload settle before recording.
    const warm = () =>
      page.evaluate(async () => {
        await Promise.all(
          [
            'core/audio-handler.ts',
            'core/animation-loop.ts',
            'milkdrop/runtime-signals.ts',
            'milkdrop/trace-capture.ts',
          ].map((file) => import(`/src/js/${file}`)),
        );
      });
    await warm().catch(() => undefined);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await warm();
    return (await page.evaluate(
      async ({ channelData, sampleRate, seconds, startDelay }) => {
        // Dev-server-relative specifiers, kept dynamic so the CLI's own
        // typecheck doesn't try to resolve them as Node modules.
        const load = (file: string) => import(`/src/js/${file}`);
        const [audioHandler, animationLoop, runtimeSignals, traceCapture] =
          await Promise.all([
            load('core/audio-handler.ts'),
            load('core/animation-loop.ts'),
            load('milkdrop/runtime-signals.ts'),
            load('milkdrop/trace-capture.ts'),
          ]);
        const context = new AudioContext({ sampleRate });
        await context.resume();
        const buffer = context.createBuffer(
          channelData.length,
          channelData[0].length,
          sampleRate,
        );
        channelData.forEach((data: number[], channel: number) => {
          buffer.copyToChannel(Float32Array.from(data), channel);
        });
        const source = context.createBufferSource();
        source.buffer = buffer;
        const destination = context.createMediaStreamDestination();
        // Match the file's channel count, or a mono file arrives upmixed to
        // stereo and takes the worklet's stereo path.
        destination.channelCount = channelData.length;
        destination.channelCountMode = 'explicit';
        source.connect(destination);
        const analyser = await audioHandler.FrequencyAnalyser.create(
          context,
          destination.stream,
          1024,
        );
        const tracker = runtimeSignals.createMilkdropSignalTracker();
        const startAt = context.currentTime + startDelay;
        source.start(startAt);
        const frames: unknown[] = [];
        let previous: number | null = null;
        await new Promise<void>((resolve) => {
          const tick = () => {
            const audioTime = context.currentTime - startAt;
            if (audioTime >= seconds) {
              resolve();
              return;
            }
            if (audioTime >= 0 && audioTime !== previous) {
              const deltaMs =
                previous === null ? 1000 / 60 : (audioTime - previous) * 1000;
              previous = audioTime;
              // The worklet's own bytes, before getContextFrequencyData
              // stylizes them: calibration matches these against windows.
              const rawSpectrum = Array.from(analyser.getFrequencyData());
              const frequencyData = animationLoop.getContextFrequencyData({
                toy: null,
                analyser,
                time: audioTime,
                realTimeMs: audioTime * 1000,
              });
              const waveformData = analyser.getWaveformData();
              const signals = tracker.update({
                time: audioTime,
                deltaMs,
                analyser,
                frequencyData,
                waveformData,
              });
              frames.push({
                ...traceCapture.snapshotFrameInputs({
                  time: audioTime,
                  deltaMs,
                  frequencyData,
                  waveformData,
                  signals,
                }),
                audioTime,
                rawSpectrum,
              });
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        source.stop();
        analyser.disconnect();
        await context.close();
        return frames;
      },
      {
        channelData: channels.map((channel) => Array.from(channel)),
        sampleRate,
        seconds,
        startDelay: START_DELAY_SECONDS,
      },
    )) as LiveFrame[];
  } finally {
    await browser.close();
    server.close();
  }
}

function formatReport(report: FidelityReport): string {
  const lines = [
    `${report.frames} frames compared`,
    `spectrum: ${report.spectrum.identical} identical, ${report.spectrum.oneMessageBehind} one message behind, mean |Δbyte| ${report.spectrum.meanAbsByteDiff.toFixed(2)}`,
    'signal        mean|Δ|    max|Δ|     corr   live range',
  ];
  for (const row of report.signals) {
    lines.push(
      `${row.signal.padEnd(12)} ${row.meanAbsDiff.toFixed(4).padStart(8)} ${row.maxAbsDiff.toFixed(4).padStart(9)} ${row.correlation.toFixed(4).padStart(8)}   ${row.liveRange[0].toFixed(2)}…${row.liveRange[1].toFixed(2)}`,
    );
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const audioPath = get('--audio');
  if (!audioPath) {
    throw new Error(
      'Usage: bun run lab:audio-fidelity -- --audio song.wav [--seconds 10] [--start 0] [--out report.json] [--min-correlation 0.98]',
    );
  }
  const seconds = Number(get('--seconds') ?? 10);
  const start = Number(get('--start') ?? 0);
  const minCorrelation = Number(get('--min-correlation') ?? 0.98);
  const audio = decodeWav(
    new Uint8Array(fs.readFileSync(path.resolve(audioPath))),
  );
  const from = Math.round(start * audio.sampleRate);
  const to = from + Math.round(seconds * audio.sampleRate);
  const clip = audio.channels.map((channel) => channel.slice(from, to));
  if ((clip[0]?.length ?? 0) < audio.sampleRate / 2) {
    throw new Error('Need at least 0.5 s of audio after --start.');
  }

  console.log(
    `Playing ${((clip[0]?.length ?? 0) / audio.sampleRate).toFixed(1)} s of ${path.basename(audioPath)} through Chromium (${audio.sampleRate} Hz, ${clip.length} ch)…`,
  );
  const live = await recordLive(
    clip,
    audio.sampleRate,
    (clip[0]?.length ?? 0) / audio.sampleRate,
  );
  // The live worklet posts every 4th block at fftSize 1024 (the rule in
  // FrequencyAnalyser.create), so messages recur every 4096 samples.
  const messagePeriod = FFT_SIZE * 4;
  const calibration = calibrateLive(
    live,
    clip[0] as Float32Array,
    audio.sampleRate,
    messagePeriod,
  );
  if (calibration) {
    console.log(
      `calibration: ${calibration.located} frames located; block phase ${calibration.phase}, message phase ${calibration.messagePhase}/${messagePeriod}, delay ≥ ${calibration.delaySamples} samples (${((calibration.delaySamples / audio.sampleRate) * 1000).toFixed(1)} ms)`,
    );
  } else {
    console.log(
      'calibration: no live spectrum matched any window of the file; comparing uncalibrated.',
    );
  }
  const offline = await buildAudioFileInputs(
    { sampleRate: audio.sampleRate, channels: clip },
    {
      timeline: live.map((frame) => ({
        time: frame.audioTime,
        deltaMs: frame.deltaMs,
      })),
      // Offline windows end at processed ≡ 0 (mod period); with a lead-in L
      // that is file sample ≡ -L, so L ≡ -messagePhase.
      leadInSamples: calibration
        ? (messagePeriod - calibration.messagePhase) % messagePeriod
        : 0,
      analysisDelaySamples: calibration?.delaySamples ?? 0,
    },
  );
  const report = { ...compareAudioFrames(live, offline), calibration };
  console.log(formatReport(report));
  const outPath = get('--out');
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(report, null, 2));
  }
  const failing = report.signals.filter(
    (row) =>
      (CORE_SIGNALS as readonly string[]).includes(row.signal) &&
      row.correlation < minCorrelation,
  );
  if (failing.length) {
    console.error(
      `✗ below --min-correlation ${minCorrelation}: ${failing.map((row) => row.signal).join(', ')}`,
    );
    process.exit(1);
  }
  console.log(
    `✔ core bands correlate ≥ ${minCorrelation} with the live stack.`,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
