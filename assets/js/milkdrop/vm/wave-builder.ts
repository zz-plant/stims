import type {
  MilkdropCompiledPreset,
  MilkdropGpuFieldSignalInputs,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveDescriptorPlan,
  MilkdropRuntimeSignals,
  MilkdropWaveDefinition,
  MilkdropWaveVisual,
} from '../types';
import { buildMainWaveFrame } from './frame-generation';
import {
  type CustomWaveChannelSample,
  clamp,
  color,
  MAX_TRAILS,
  type MutableState,
  sampleCustomWaveChannels,
  type WaveBuilderState,
} from './shared';

const MAX_CUSTOM_WAVE_SAMPLES = 512;

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
    buffers: waveState.buffers,
    useProcedural: supportsProceduralWave(drawMode),
  });
  waveState.lastWaveSamples = built.nextSamples;
  waveState.lastWaveMomentum = built.nextMomentum;
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
    if (waveState.trails.length > MAX_TRAILS) {
      waveState.trails.length = MAX_TRAILS;
    }
  }
  if (waveState.lastProceduralWave) {
    waveState.proceduralTrailWaves.unshift(waveState.lastProceduralWave);
    if (waveState.proceduralTrailWaves.length > MAX_TRAILS) {
      waveState.proceduralTrailWaves.length = MAX_TRAILS;
    }
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
  getProceduralCustomWaveDescriptor,
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
    options?: {
      reuseExtraAsEnv?: boolean;
    },
  ) => MutableState;
  seedCustomWaveState: (wave: MilkdropWaveDefinition) => MutableState;
  getProceduralCustomWaveDescriptor: (
    wave: MilkdropWaveDefinition,
    drawMode: 'line' | 'dots',
  ) => MilkdropProceduralWaveDescriptorPlan | null;
}): {
  visual: MilkdropWaveVisual[];
  procedural: MilkdropProceduralCustomWaveVisual[];
} {
  const waves: MilkdropWaveVisual[] = [];
  const proceduralWaves: MilkdropProceduralCustomWaveVisual[] = [];

  preset.ir.customWaves.forEach((wave, index) => {
    const frameLocals =
      waveState.customWaveLocals[index] ?? seedCustomWaveState(wave);
    runProgram(
      wave.programs.perFrame,
      createEnv(signals, frameLocals),
      frameLocals,
    );
    waveState.customWaveLocals[index] = frameLocals;

    if ((frameLocals.enabled ?? 0) < 0.5) {
      return;
    }

    const sampleCount = clamp(
      Math.round((frameLocals.samples ?? 64) * detailScale),
      8,
      MAX_CUSTOM_WAVE_SAMPLES,
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
    const proceduralDescriptor = getProceduralCustomWaveDescriptor(
      wave,
      drawMode,
    );
    const useProcedural = proceduralDescriptor !== null;
    const positions = useProcedural ? [] : new Array<number>(sampleCount * 3);
    const proceduralSamples = useProcedural
      ? new Array<number>(sampleCount)
      : null;
    const proceduralSampleValues2 = useProcedural
      ? new Array<number>(sampleCount)
      : null;
    const pointLocals: MutableState = { ...frameLocals };
    const pointEnv = useProcedural ? null : createEnv(signals, pointLocals);
    const channelSample: CustomWaveChannelSample = {
      sample: 0,
      value: 0,
      value1: 0,
      value2: 0,
    };

    for (let point = 0; point < sampleCount; point += 1) {
      const sample = point / Math.max(1, sampleCount - 1);
      const waveChannels = sampleCustomWaveChannels(
        signals,
        sample,
        channelSample,
      );
      const spectrumValue = waveChannels.value1;
      const baseY =
        centerY +
        (spectrumValue - 0.5) *
          0.55 *
          scaling *
          (1 + (frameLocals.mystery ?? 0) * 0.25);

      if (useProcedural && proceduralSamples) {
        proceduralSamples[point] = spectrumValue;
        if (proceduralSampleValues2) {
          proceduralSampleValues2[point] = waveChannels.value2;
        }
        continue;
      }

      Object.assign(pointLocals, frameLocals, {
        sample: waveChannels.sample,
        value: waveChannels.value,
        value1: waveChannels.value1,
        value2: waveChannels.value2,
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
      if (pointEnv) {
        Object.assign(pointEnv, pointLocals);
        runProgram(wave.programs.perPoint, pointEnv, pointLocals);
      }
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
      const fieldSignals: MilkdropGpuFieldSignalInputs = {
        time: signals.time,
        frame: signals.frame,
        fps: signals.fps,
        bass: signals.bass,
        mid: signals.mid,
        mids: signals.mids,
        treble: signals.treble,
        bassAtt: signals.bassAtt,
        midAtt: signals.mid_att,
        midsAtt: signals.midsAtt,
        trebleAtt: signals.trebleAtt,
        beat: signals.beat,
        beatPulse: signals.beatPulse,
        rms: signals.rms,
        vol: signals.vol,
        music: signals.music,
        weightedEnergy: signals.weightedEnergy,
      };
      proceduralWaves.push({
        samples: proceduralSamples ?? [],
        sampleValues2: proceduralSampleValues2 ?? [],
        spectrum: (frameLocals.spectrum ?? 0) >= 0.5,
        centerX,
        centerY,
        scaling,
        mystery: frameLocals.mystery ?? 0,
        time: signals.time,
        sampleCount,
        signals: fieldSignals,
        fieldProgram: proceduralDescriptor?.fieldProgram ?? null,
        color: waveColor,
        alpha: waveAlpha,
        additive,
        thickness: clamp(frameLocals.thick ?? 1, 1, 6),
      });
    }
  });

  return {
    visual: waves,
    procedural: proceduralWaves,
  };
}
