// Fast in-browser audio-reactivity probe for generated presets.
//
// The measurement labs (`bun run lab:reactivity`) give per-variable verdicts
// offline; this probe answers one question cheaply enough to run right after
// generation: do the preset's per-frame equations respond to audio at all?
// It steps the VM twice over identical frame timelines — once silent, once
// with a strongly beat-pulsed synthetic spectrum — and compares tracked
// per-frame variables between the passes. Any divergence can only come from
// the audio inputs. The main and custom waves are deliberately not tracked:
// they follow the raw waveform no matter what the equations do, so they
// would mark every preset reactive.

import type { MilkdropCompiledPreset } from './types.ts';
import { createMilkdropSignalTracker } from './runtime-signals.ts';
import { createMilkdropVM } from './vm.ts';

export type ReactivityProbeVerdict = 'reactive' | 'static' | 'unknown';

export type ReactivityProbeResult = {
  verdict: ReactivityProbeVerdict;
  // Largest relative audio-vs-silence divergence seen across tracked
  // variables; 0 when nothing responded.
  score: number;
  respondingVariables: string[];
};

const SPECTRUM_BINS = 128;
const WARMUP_FRAMES = 30;
const SAMPLE_FRAMES = 120;
const FPS = 60;
// Relative divergence below this is numeric noise, not reactivity.
const RESPONSE_THRESHOLD = 1e-3;

const TRACKED_VARIABLES = [
  'zoom',
  'rot',
  'warp',
  'decay',
  'cx',
  'cy',
  'dx',
  'dy',
  'sx',
  'sy',
  'wave_r',
  'wave_g',
  'wave_b',
  'wave_a',
  'wave_x',
  'wave_y',
  'wave_mystery',
  'echo_zoom',
  'gamma',
  'q1',
  'q2',
  'q3',
  'q4',
] as const;

function fillAudioFrame(
  frequencyData: Uint8Array,
  waveformData: Uint8Array,
  timeMs: number,
) {
  // 2 Hz beat pulse over a broadband, bass-weighted spectrum.
  const beat = Math.sin((2 * Math.PI * timeMs) / 500) ** 2;
  for (let i = 0; i < frequencyData.length; i += 1) {
    frequencyData[i] = Math.round(
      (0.35 + 0.65 * beat) * 255 * Math.exp(-i / 48),
    );
  }
  for (let i = 0; i < waveformData.length; i += 1) {
    waveformData[i] =
      128 + Math.round(100 * beat * Math.sin(i * 0.35 + timeMs * 0.02));
  }
}

function runPass(
  preset: MilkdropCompiledPreset,
  withAudio: boolean,
): Map<string, number[]> {
  const vm = createMilkdropVM(preset);
  const tracker = createMilkdropSignalTracker();
  const frequencyData = new Uint8Array(SPECTRUM_BINS);
  const waveformData = new Uint8Array(SPECTRUM_BINS);
  waveformData.fill(128);
  const deltaMs = 1000 / FPS;
  const series = new Map<string, number[]>(
    TRACKED_VARIABLES.map((name) => [name, []]),
  );

  for (let frame = 0; frame < WARMUP_FRAMES + SAMPLE_FRAMES; frame += 1) {
    const timeMs = frame * deltaMs;
    if (withAudio) {
      fillAudioFrame(frequencyData, waveformData, timeMs);
    }
    const signals = tracker.update({
      time: timeMs / 1000,
      deltaMs,
      analyser: null,
      frequencyData,
      waveformData,
    });
    const frameState = vm.step(signals);
    if (frame < WARMUP_FRAMES) {
      continue;
    }
    for (const name of TRACKED_VARIABLES) {
      const value = frameState.variables[name];
      series
        .get(name)
        ?.push(typeof value === 'number' && Number.isFinite(value) ? value : 0);
    }
  }

  return series;
}

function relativeDivergence(silent: number[], audio: number[]): number {
  let sumDiff = 0;
  let sumScale = 0;
  const count = Math.min(silent.length, audio.length);
  for (let i = 0; i < count; i += 1) {
    sumDiff += Math.abs(audio[i] - silent[i]);
    sumScale += Math.max(Math.abs(silent[i]), Math.abs(audio[i]), 1);
  }
  return sumScale === 0 ? 0 : sumDiff / sumScale;
}

export function probePresetReactivity(
  preset: MilkdropCompiledPreset,
): ReactivityProbeResult {
  try {
    const silentSeries = runPass(preset, false);
    const audioSeries = runPass(preset, true);

    let score = 0;
    const respondingVariables: string[] = [];
    for (const name of TRACKED_VARIABLES) {
      const divergence = relativeDivergence(
        silentSeries.get(name) ?? [],
        audioSeries.get(name) ?? [],
      );
      if (divergence > RESPONSE_THRESHOLD) {
        respondingVariables.push(name);
      }
      score = Math.max(score, divergence);
    }

    return {
      verdict: respondingVariables.length > 0 ? 'reactive' : 'static',
      score,
      respondingVariables,
    };
  } catch {
    // The probe is advisory; a VM failure must never block generation.
    return { verdict: 'unknown', score: 0, respondingVariables: [] };
  }
}
