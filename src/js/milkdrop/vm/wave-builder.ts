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
  MAIN_WAVE_FRAME_HISTORY_SIZE,
  MAX_TRAILS,
  type MutableState,
  sampleCustomWaveChannels,
  type WaveBuilderState,
} from './shared';

const BALANCED_CUSTOM_WAVE_SAMPLE_LIMIT = 1024;
const HIGH_DETAIL_CUSTOM_WAVE_SAMPLE_LIMIT = 2048;
const HIGH_DETAIL_WAVE_THRESHOLD = 1.5;

export function getCustomWaveSampleLimit(detailScale: number) {
  return detailScale >= HIGH_DETAIL_WAVE_THRESHOLD
    ? HIGH_DETAIL_CUSTOM_WAVE_SAMPLE_LIMIT
    : BALANCED_CUSTOM_WAVE_SAMPLE_LIMIT;
}

const toRendererWaveX = (value: number) => (value - 0.5) * 2;
const toRendererWaveY = (value: number) => (0.5 - value) * 2;

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

function pushTrailInPlace<T>(trails: T[], item: T) {
  const len = Math.min(trails.length + 1, MAX_TRAILS);
  trails.length = len;
  for (let i = len - 1; i > 0; i--) {
    trails[i] = trails[i - 1];
  }
  trails[0] = item;
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
    pushTrailInPlace(waveState.trails, waveState.lastWaveform);
  }
  if (waveState.lastProceduralWave) {
    pushTrailInPlace(
      waveState.proceduralTrailWaves,
      waveState.lastProceduralWave,
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

    // Reload base values from wave definition each frame
    const baseLocals = seedCustomWaveState(wave);
    const frameLocals =
      waveState.customWaveLocals[index] ?? baseLocals;

    // Merge base values into frame locals (preserves per-frame user vars)
    for (const key in baseLocals) {
      frameLocals[key] = baseLocals[key];
    }

    // Restore t1-t8 from post-init snapshot
    const tAfterInit = waveState.customWaveTAfterInit[index];
    if (tAfterInit) {
      for (let t = 1; t <= 8; t += 1) {
        frameLocals[`t${t}`] = tAfterInit[`t${t}`] ?? 0;
      }
    }

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
      getCustomWaveSampleLimit(detailScale),
    );
    const centerX = ((frameLocals.x ?? 0.5) - 0.5) * 2;
    const centerY = (0.5 - (frameLocals.y ?? 0.5)) * 2;
    const scaling = frameLocals.scaling ?? 1;
    const drawMode = (frameLocals.usedots ?? 0) >= 0.5 ? 'dots' : 'line';
    const additive = (frameLocals.additive ?? 0) >= 0.5;
    const waveAlpha = clamp(frameLocals.a ?? 0.4, 0.02, 1);

    const visualWave = waveState.customWaveVisualPool[visualWaveCount] ?? {
      positions: new Float32Array(0),
      color: { r: 1, g: 1, b: 1, a: 1 },
      alpha: waveAlpha,
      thickness: 1,
      drawMode,
      additive,
      pointSize: 1,
      spectrum: false,
    };
    waveState.customWaveVisualPool[visualWaveCount] = visualWave;
    if (!visualWave.color) {
      visualWave.color = { r: 1, g: 1, b: 1, a: 1 };
    }
    const waveColor = visualWave.color;
    waveColor.r = clamp(frameLocals.r ?? 1, 0, 1);
    waveColor.g = clamp(frameLocals.g ?? 1, 0, 1);
    waveColor.b = clamp(frameLocals.b ?? 1, 0, 1);
    waveColor.a = clamp(frameLocals.a ?? 0.4, 0, 1);

    const proceduralDescriptor = getProceduralCustomWaveDescriptor(
      wave,
      drawMode,
    );
    const useProcedural = proceduralDescriptor !== null;
    const perPointWritesX = wave.programs.perPoint.statements.some(
      (statement) => statement.target === 'x',
    );
    const perPointWritesY = wave.programs.perPoint.statements.some(
      (statement) => statement.target === 'y',
    );
    const pointLocals = { ...frameLocals };
    waveState.pointLocalsScratch = pointLocals;
    const pointEnv = useProcedural
      ? null
      : createEnv(signals, pointLocals, { reuseExtraAsEnv: true });

    let positions = useProcedural ? null : visualWave.positions;
    const visualWaveWithColorCache = visualWave as MilkdropWaveVisual & {
      _colorsCache?: number[] | Float32Array;
    };
    let pointColors = useProcedural
      ? null
      : visualWaveWithColorCache._colorsCache;
    if (!useProcedural && !pointColors) {
      pointColors = new Float32Array(0);
      visualWaveWithColorCache._colorsCache = pointColors;
    }
    let hasPerPointColors = false;

    if (positions) {
      const targetLength = sampleCount * 3;
      if (positions instanceof Float32Array) {
        if (positions.length !== targetLength) {
          positions = new Float32Array(targetLength);
          visualWave.positions = positions;
        }
      } else if (Array.isArray(positions)) {
        if (positions.length !== targetLength) {
          positions.length = targetLength;
        }
      } else {
        positions = new Float32Array(targetLength);
        visualWave.positions = positions;
      }
    }

    if (pointColors) {
      const targetLength = sampleCount * 3;
      if (pointColors instanceof Float32Array) {
        if (pointColors.length !== targetLength) {
          pointColors = new Float32Array(targetLength);
          visualWaveWithColorCache._colorsCache = pointColors;
        }
      } else if (Array.isArray(pointColors)) {
        if (pointColors.length !== targetLength) {
          pointColors.length = targetLength;
        }
      } else {
        pointColors = new Float32Array(targetLength);
        visualWaveWithColorCache._colorsCache = pointColors;
      }
    }

    const proceduralWave = useProcedural
      ? (waveState.proceduralCustomWavePool[proceduralWaveCount] ?? {
          samples: new Float32Array(0),
          sampleValues2: new Float32Array(0),
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
          color: { r: 1, g: 1, b: 1, a: 1 },
          alpha: waveAlpha,
          additive,
          thickness: 1,
        })
      : null;
    if (useProcedural && proceduralWave) {
      waveState.proceduralCustomWavePool[proceduralWaveCount] = proceduralWave;
    }
    let proceduralSamples = proceduralWave?.samples ?? null;
    let proceduralSampleValues2 = proceduralWave?.sampleValues2 ?? null;
    if (proceduralSamples) {
      if (
        !(proceduralSamples instanceof Float32Array) ||
        proceduralSamples.length !== sampleCount
      ) {
        proceduralSamples = new Float32Array(sampleCount);
        if (proceduralWave) {
          proceduralWave.samples = proceduralSamples;
        }
      }
    }
    if (proceduralSampleValues2) {
      if (
        !(proceduralSampleValues2 instanceof Float32Array) ||
        proceduralSampleValues2.length !== sampleCount
      ) {
        proceduralSampleValues2 = new Float32Array(sampleCount);
        if (proceduralWave) {
          proceduralWave.sampleValues2 = proceduralSampleValues2;
        }
      }
    }
    channelSample.sample = 0;
    channelSample.value = 0;
    channelSample.value1 = 0;
    channelSample.value2 = 0;

    // Initialize per-point locals from frame locals (t/v carry point-to-point)
    pointLocals.t1 = frameLocals.t1 ?? 0;
    pointLocals.t2 = frameLocals.t2 ?? 0;
    pointLocals.t3 = frameLocals.t3 ?? 0;
    pointLocals.t4 = frameLocals.t4 ?? 0;
    pointLocals.t5 = frameLocals.t5 ?? 0;
    pointLocals.t6 = frameLocals.t6 ?? 0;
    pointLocals.t7 = frameLocals.t7 ?? 0;
    pointLocals.t8 = frameLocals.t8 ?? 0;
    pointLocals.v1 = frameLocals.v1 ?? 0;
    pointLocals.v2 = frameLocals.v2 ?? 0;
    pointLocals.v3 = frameLocals.v3 ?? 0;
    pointLocals.v4 = frameLocals.v4 ?? 0;
    pointLocals.v5 = frameLocals.v5 ?? 0;
    pointLocals.v6 = frameLocals.v6 ?? 0;
    pointLocals.v7 = frameLocals.v7 ?? 0;
    pointLocals.v8 = frameLocals.v8 ?? 0;

    for (let point = 0; point < sampleCount; point += 1) {
      const sample = point / Math.max(1, sampleCount - 1);
      const waveChannels = sampleCustomWaveChannels(
        signals,
        sample,
        (frameLocals.spectrum ?? 0) >= 0.5 ? 'spectrum' : 'waveform',
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

      // Update audio-sample-driven and geometry values per point
      // (t/v already initialized above and carry between points)
      pointLocals.sample = waveChannels.sample;
      pointLocals.value = waveChannels.value;
      pointLocals.value1 = waveChannels.value1;
      pointLocals.value2 = waveChannels.value2;
      pointLocals.x = centerX + (-1 + sample * 2);
      pointLocals.y =
        (frameLocals.spectrum ?? 0) >= 0.5
          ? baseY
          : centerY + waveChannels.value * scaling;
      pointLocals.a = waveAlpha;
      pointLocals.rad = Math.sqrt(
        pointLocals.x * pointLocals.x + pointLocals.y * pointLocals.y,
      );
      pointLocals.ang = Math.atan2(pointLocals.y, pointLocals.x);
      if (pointEnv) {
        runProgram(wave.programs.perPoint, pointEnv, pointLocals);
      }
      const writeIndex = point * 3;
      if (positions) {
        positions[writeIndex] = perPointWritesX
          ? toRendererWaveX(pointLocals.x)
          : pointLocals.x;
        positions[writeIndex + 1] = perPointWritesY
          ? toRendererWaveY(pointLocals.y)
          : pointLocals.y;
        positions[writeIndex + 2] = 0.28;
      }
      if (pointColors) {
        const pointR = clamp(pointLocals.r ?? waveColor.r, 0, 1);
        const pointG = clamp(pointLocals.g ?? waveColor.g, 0, 1);
        const pointB = clamp(pointLocals.b ?? waveColor.b, 0, 1);
        pointColors[writeIndex] = pointR;
        pointColors[writeIndex + 1] = pointG;
        pointColors[writeIndex + 2] = pointB;
        hasPerPointColors ||=
          pointR !== waveColor.r ||
          pointG !== waveColor.g ||
          pointB !== waveColor.b;
      }
    }

    if (visualWave && (positions || useProcedural)) {
      visualWave.alpha = waveAlpha;
      visualWave.thickness = clamp(frameLocals.thick ?? 1, 1, 6);
      visualWave.drawMode = drawMode;
      visualWave.additive = additive;
      visualWave.pointSize = clamp((frameLocals.thick ?? 1) * 3.2, 1, 14);
      visualWave.spectrum = (frameLocals.spectrum ?? 0) >= 0.5;
      if (hasPerPointColors && pointColors) {
        visualWave.colors = pointColors;
      } else {
        visualWave.colors = undefined;
      }
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
      if (!proceduralWave.color) {
        proceduralWave.color = { r: 1, g: 1, b: 1, a: 1 };
      }
      proceduralWave.color.r = waveColor.r;
      proceduralWave.color.g = waveColor.g;
      proceduralWave.color.b = waveColor.b;
      proceduralWave.color.a = waveColor.a;
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
