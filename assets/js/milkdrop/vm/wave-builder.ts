import type {
  MilkdropCompiledPreset,
  MilkdropProceduralCustomWaveVisual,
  MilkdropRuntimeSignals,
  MilkdropWaveDefinition,
  MilkdropWaveVisual,
} from '../types';
import { buildMainWaveFrame } from './frame-generation';
import {
  clamp,
  color,
  MAX_TRAILS,
  type MutableState,
  sampleCustomWaveChannels,
  type WaveBuilderState,
} from './shared';

function syncSamples(target: number[], samples: number[], count: number) {
  target.length = count;
  for (let index = 0; index < count; index += 1) {
    target[index] = samples[index] ?? 0;
  }
}

export function buildMainWave({
  state,
  signals,
  detailScale,
  waveState,
  supportsProceduralWave,
}: {
  state: MutableState;
  signals: MilkdropRuntimeSignals;
  detailScale: number;
  waveState: WaveBuilderState;
  supportsProceduralWave: (drawMode: 'line' | 'dots') => boolean;
}) {
  const drawMode = (state.wave_usedots ?? 0) >= 0.5 ? 'dots' : 'line';
  const built = buildMainWaveFrame({
    state,
    signals,
    detailScale,
    previousSamples: waveState.lastWaveSamples,
    previousMomentum: waveState.lastWaveMomentum,
    useProcedural: supportsProceduralWave(drawMode),
  });
  syncSamples(
    waveState.lastWaveSamples,
    built.nextSamples,
    built.nextSamples.length,
  );
  syncSamples(
    waveState.lastWaveMomentum,
    built.nextMomentum,
    built.nextMomentum.length,
  );
  return {
    visual: built.visual,
    procedural: built.procedural,
  };
}

export function commitMainWaveFrame({
  waveState,
  mainWave,
  proceduralMainWave,
}: {
  waveState: WaveBuilderState;
  mainWave: MilkdropWaveVisual;
  proceduralMainWave: import('../types').MilkdropProceduralWaveVisual | null;
}) {
  if (waveState.lastWaveform) {
    waveState.trails.unshift(waveState.lastWaveform);
    waveState.trails = waveState.trails.slice(0, MAX_TRAILS);
  }
  if (waveState.lastProceduralWave) {
    waveState.proceduralTrailWaves.unshift(waveState.lastProceduralWave);
    waveState.proceduralTrailWaves = waveState.proceduralTrailWaves.slice(
      0,
      MAX_TRAILS,
    );
  }
  waveState.lastWaveform = mainWave;
  waveState.lastProceduralWave = proceduralMainWave;
}

export function buildCustomWaves({
  preset,
  signals,
  detailScale,
  waveState,
  runProgram,
  createEnv,
  seedCustomWaveState,
  supportsProceduralCustomWave,
}: {
  preset: MilkdropCompiledPreset;
  signals: MilkdropRuntimeSignals;
  detailScale: number;
  waveState: WaveBuilderState;
  runProgram: (
    block: MilkdropCompiledPreset['ir']['programs']['init'],
    env: MutableState,
    locals?: MutableState | null,
  ) => void;
  createEnv: (
    signals: MilkdropRuntimeSignals,
    extra?: Record<string, number>,
  ) => MutableState;
  seedCustomWaveState: (wave: MilkdropWaveDefinition) => MutableState;
  supportsProceduralCustomWave: (
    wave: MilkdropWaveDefinition,
    drawMode: 'line' | 'dots',
  ) => boolean;
}): {
  visual: MilkdropWaveVisual[];
  procedural: MilkdropProceduralCustomWaveVisual[];
} {
  const waves: MilkdropWaveVisual[] = [];
  const proceduralWaves: MilkdropProceduralCustomWaveVisual[] = [];

  preset.ir.customWaves.forEach((wave, index) => {
    const persistent =
      waveState.customWaveLocals[index] ?? seedCustomWaveState(wave);
    const frameLocals = { ...persistent };
    runProgram(
      wave.programs.perFrame,
      createEnv(signals, frameLocals),
      frameLocals,
    );
    waveState.customWaveLocals[index] = { ...frameLocals };

    if ((frameLocals.enabled ?? 0) < 0.5) {
      return;
    }

    const sampleCount = clamp(
      Math.round((frameLocals.samples ?? 64) * detailScale),
      8,
      256,
    );
    const centerX = ((frameLocals.x ?? 0.5) - 0.5) * 2;
    const centerY = (0.5 - (frameLocals.y ?? 0.5)) * 2;
    const scaling = frameLocals.scaling ?? 1;
    const drawMode = (frameLocals.usedots ?? 0) >= 0.5 ? 'dots' : 'line';
    const additive = (frameLocals.additive ?? 0) >= 0.5;
    const waveColor = color(
      frameLocals.r ?? 1,
      frameLocals.g ?? 1,
      frameLocals.b ?? 1,
      frameLocals.a ?? 0.4,
    );
    const waveAlpha = clamp(frameLocals.a ?? 0.4, 0.02, 1);
    const useProcedural = supportsProceduralCustomWave(wave, drawMode);
    const positions = useProcedural ? [] : new Array<number>(sampleCount * 3);
    const proceduralSamples = useProcedural
      ? new Array<number>(sampleCount)
      : null;
    const pointLocals: MutableState = { ...frameLocals };

    for (let point = 0; point < sampleCount; point += 1) {
      const sample = point / Math.max(1, sampleCount - 1);
      const waveChannels = sampleCustomWaveChannels(signals, sample);
      const spectrumValue = waveChannels.value1;
      const baseY =
        centerY +
        (spectrumValue - 0.5) *
          0.55 *
          scaling *
          (1 + (frameLocals.mystery ?? 0) * 0.25);

      if (useProcedural && proceduralSamples) {
        proceduralSamples[point] = spectrumValue;
        continue;
      }

      Object.assign(pointLocals, frameLocals, {
        ...waveChannels,
        x: centerX + (-1 + sample * 2) * 0.85,
        y:
          (frameLocals.spectrum ?? 0) >= 0.5
            ? baseY
            : centerY +
              Math.sin(
                sample * Math.PI * 2 * (1 + (frameLocals.mystery ?? 0)) +
                  signals.time,
              ) *
                0.18 *
                scaling,
      });
      pointLocals.rad = Math.sqrt(
        pointLocals.x * pointLocals.x + pointLocals.y * pointLocals.y,
      );
      pointLocals.ang = Math.atan2(pointLocals.y, pointLocals.x);
      runProgram(
        wave.programs.perPoint,
        createEnv(signals, pointLocals),
        pointLocals,
      );
      const writeIndex = point * 3;
      positions[writeIndex] = pointLocals.x;
      positions[writeIndex + 1] = pointLocals.y;
      positions[writeIndex + 2] = 0.28;
    }

    waves.push({
      positions,
      color: waveColor,
      alpha: waveAlpha,
      thickness: clamp(frameLocals.thick ?? 1, 1, 6),
      drawMode,
      additive,
      pointSize: clamp((frameLocals.thick ?? 1) * 3.2, 1, 14),
      spectrum: (frameLocals.spectrum ?? 0) >= 0.5,
    });

    if (useProcedural) {
      proceduralWaves.push({
        samples: proceduralSamples ?? [],
        spectrum: (frameLocals.spectrum ?? 0) >= 0.5,
        centerX,
        centerY,
        scaling,
        mystery: frameLocals.mystery ?? 0,
        time: signals.time,
        color: waveColor,
        alpha: waveAlpha,
        additive,
      });
    }
  });

  return {
    visual: waves,
    procedural: proceduralWaves,
  };
}
