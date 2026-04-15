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
  clamp,
  color,
  MAIN_WAVE_FRAME_HISTORY_SIZE,
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
  const nextFrameIndex =
    (waveState.mainWaveFrameIndex + 1) % MAIN_WAVE_FRAME_HISTORY_SIZE;
  const built = buildMainWaveFrame({
    state,
    signals,
    detailScale,
    previousSamples: waveState.lastWaveSamples,
    previousMomentum: waveState.lastWaveMomentum,
    buffers: waveState.buffers,
    useProcedural: supportsProceduralWave(drawMode),
    reusableVisual: waveState.mainWaveVisualFrames[nextFrameIndex],
    reusableProcedural: waveState.proceduralMainWaveFrames[nextFrameIndex],
  });
  waveState.mainWaveFrameIndex = nextFrameIndex;
  waveState.mainWaveVisualFrames[nextFrameIndex] = built.visual;
  if (built.procedural) {
    waveState.proceduralMainWaveFrames[nextFrameIndex] = built.procedural;
  }
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
  const nextFrameIndex = (waveState.customWaveFrameIndex ^ 1) as 0 | 1;
  const waves = waveState.customWaveVisualFrames[nextFrameIndex];
  const proceduralWaves = waveState.proceduralCustomWaveFrames[nextFrameIndex];
  const channelSample = waveState.channelSample;
  let visualWaveCount = 0;
  let proceduralWaveCount = 0;

  for (let index = 0; index < preset.ir.customWaves.length; index += 1) {
    const wave = preset.ir.customWaves[index];
    if (!wave) {
      continue;
    }

    const frameLocals =
      waveState.customWaveLocals[index] ?? seedCustomWaveState(wave);
    runProgram(
      wave.programs.perFrame,
      createEnv(signals, frameLocals, { reuseExtraAsEnv: true }),
      frameLocals,
    );
    waveState.customWaveLocals[index] = frameLocals;

    if ((frameLocals.enabled ?? 0) < 0.5) {
      continue;
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
    const pointLocals: MutableState = { ...frameLocals };
    const pointEnv = useProcedural
      ? null
      : createEnv(signals, pointLocals, { reuseExtraAsEnv: true });
    const visualWave = waves[visualWaveCount] ?? {
      positions: [],
      color: waveColor,
      alpha: waveAlpha,
      thickness: 1,
      drawMode,
      additive,
      pointSize: 1,
      spectrum: false,
    };
    const positions = useProcedural ? null : visualWave.positions;
    if (positions) {
      positions.length = sampleCount * 3;
    } else {
      visualWave.positions.length = 0;
    }
    const proceduralWave = useProcedural
      ? (proceduralWaves[proceduralWaveCount] ?? {
          samples: [],
          sampleValues2: [],
          spectrum: false,
          centerX,
          centerY,
          scaling,
          mystery: 0,
          time: signals.time,
          sampleCount,
          signals: {
            time: 0,
            frame: 0,
            fps: 0,
            bass: 0,
            mid: 0,
            mids: 0,
            treble: 0,
            bassAtt: 0,
            midAtt: 0,
            midsAtt: 0,
            trebleAtt: 0,
            beat: 0,
            beatPulse: 0,
            rms: 0,
            vol: 0,
            music: 0,
            weightedEnergy: 0,
          },
          fieldProgram: null,
          color: waveColor,
          alpha: waveAlpha,
          additive,
          thickness: 1,
        })
      : null;
    const proceduralSamples = proceduralWave?.samples ?? null;
    const proceduralSampleValues2 = proceduralWave?.sampleValues2 ?? null;
    if (proceduralSamples) {
      proceduralSamples.length = sampleCount;
    }
    if (proceduralSampleValues2) {
      proceduralSampleValues2.length = sampleCount;
    }
    channelSample.sample = 0;
    channelSample.value = 0;
    channelSample.value1 = 0;
    channelSample.value2 = 0;

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

      if (proceduralSamples) {
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
        runProgram(wave.programs.perPoint, pointEnv, pointLocals);
      }
      const writeIndex = point * 3;
      if (positions) {
        positions[writeIndex] = pointLocals.x;
        positions[writeIndex + 1] = pointLocals.y;
        positions[writeIndex + 2] = 0.28;
      }
    }

    if (visualWave && (positions || useProcedural)) {
      visualWave.color = waveColor;
      visualWave.alpha = waveAlpha;
      visualWave.thickness = clamp(frameLocals.thick ?? 1, 1, 6);
      visualWave.drawMode = drawMode;
      visualWave.additive = additive;
      visualWave.pointSize = clamp((frameLocals.thick ?? 1) * 3.2, 1, 14);
      visualWave.spectrum = (frameLocals.spectrum ?? 0) >= 0.5;
      waves[visualWaveCount] = visualWave;
      visualWaveCount += 1;
    }

    if (proceduralWave && proceduralSamples && proceduralSampleValues2) {
      const fieldSignals =
        proceduralWave.signals as MilkdropGpuFieldSignalInputs;
      fieldSignals.time = signals.time;
      fieldSignals.frame = signals.frame;
      fieldSignals.fps = signals.fps;
      fieldSignals.bass = signals.bass;
      fieldSignals.mid = signals.mid;
      fieldSignals.mids = signals.mids;
      fieldSignals.treble = signals.treble;
      fieldSignals.bassAtt = signals.bassAtt;
      fieldSignals.midAtt = signals.mid_att;
      fieldSignals.midsAtt = signals.midsAtt;
      fieldSignals.trebleAtt = signals.trebleAtt;
      fieldSignals.beat = signals.beat;
      fieldSignals.beatPulse = signals.beatPulse;
      fieldSignals.rms = signals.rms;
      fieldSignals.vol = signals.vol;
      fieldSignals.music = signals.music;
      fieldSignals.weightedEnergy = signals.weightedEnergy;
      proceduralWave.spectrum = (frameLocals.spectrum ?? 0) >= 0.5;
      proceduralWave.centerX = centerX;
      proceduralWave.centerY = centerY;
      proceduralWave.scaling = scaling;
      proceduralWave.mystery = frameLocals.mystery ?? 0;
      proceduralWave.time = signals.time;
      proceduralWave.sampleCount = sampleCount;
      proceduralWave.fieldProgram = proceduralDescriptor?.fieldProgram ?? null;
      proceduralWave.color = waveColor;
      proceduralWave.alpha = waveAlpha;
      proceduralWave.additive = additive;
      proceduralWave.thickness = clamp(frameLocals.thick ?? 1, 1, 6);
      proceduralWaves[proceduralWaveCount] = proceduralWave;
      proceduralWaveCount += 1;
    }
  }

  waves.length = visualWaveCount;
  proceduralWaves.length = proceduralWaveCount;
  waveState.customWaveFrameIndex = nextFrameIndex;

  return {
    visual: waves,
    procedural: proceduralWaves,
  };
}
