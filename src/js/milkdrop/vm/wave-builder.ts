/**
 * Wave Visual & Geometry Builder — generates main oscilloscope ribbons, multi-trail history buffers,
 * and custom per-point waveform samples driven by EEL2 equations and audio signal spectrum buffers.
 */

import type {
  MilkdropCompiledPreset,
  MilkdropGpuFieldSignalInputs,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveDescriptorPlan,
  MilkdropRuntimeSignals,
  MilkdropWaveDefinition,
  MilkdropWaveVisual,
} from '../types';
import {
  fillCustomWaveSampleValues,
  getMilkdropWaveChannels,
  MILKDROP_WAVE_ARRAY_LENGTH,
} from './custom-wave-samples';
import { buildMainWaveFrame } from './frame-generation';
import {
  clamp,
  MAIN_WAVE_FRAME_HISTORY_SIZE,
  MAX_TRAILS,
  type MutableState,
  type WaveBuilderState,
} from './shared';

/**
 * MilkDrop's custom-wave arrays are 512 long and a preset never gets more,
 * whatever it asks for. The detail scale may only reduce this — it used to
 * MULTIPLY the preset's `samples`, which is harmless retessellation for a line
 * wave but a direct light multiplier for a dot one.
 */
function getCustomWaveSampleLimit(detailScale: number) {
  return Math.max(
    8,
    Math.round(MILKDROP_WAVE_ARRAY_LENGTH * Math.min(1, detailScale)),
  );
}

/**
 * Grow-only scratch for one wave's value1/value2. Waves are built one at a time
 * within a frame, so a single pair is enough and the hot path stays
 * allocation-free.
 */
let customWaveSampleBuffers: {
  value1: Float32Array;
  value2: Float32Array;
} | null = null;

function ensureCustomWaveSampleBuffers(sampleCount: number) {
  if (
    !customWaveSampleBuffers ||
    customWaveSampleBuffers.value1.length < sampleCount
  ) {
    customWaveSampleBuffers = {
      value1: new Float32Array(sampleCount),
      value2: new Float32Array(sampleCount),
    };
  }
  return customWaveSampleBuffers;
}

/** projectM's custom-wave dot footprint, in device pixels. */
const MILKDROP_CUSTOM_WAVE_DOT_SIZE = 1;

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

/** Copies only the frame-constant registers the lowered per-point program
 * reads (`registerInputs`), into a pooled object so a steady preset does not
 * allocate one map per wave per frame. */
function collectCustomWaveFieldRegisters(
  frameLocals: MutableState,
  program: { registerInputs?: readonly string[] } | null | undefined,
  reuse: MilkdropProceduralCustomWaveVisual['registers'],
): MilkdropProceduralCustomWaveVisual['registers'] {
  const inputs = program?.registerInputs;
  if (!inputs || inputs.length === 0) {
    return undefined;
  }
  const registers: Partial<Record<string, number>> = reuse ?? {};
  for (const name of inputs) {
    registers[name] = frameLocals[name] ?? 0;
  }
  return registers;
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
  seedCustomWaveState: (
    wave: MilkdropWaveDefinition,
    target?: MutableState,
  ) => MutableState;
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
  let visualWaveCount = 0;
  let proceduralWaveCount = 0;

  for (let index = 0; index < preset.ir.customWaves.length; index += 1) {
    const wave = preset.ir.customWaves[index];
    if (!wave) {
      continue;
    }

    // Reload base values from wave definition each frame, writing into a
    // pooled object (one per wave slot) instead of allocating a fresh ~21-key
    // locals per wave per frame. Every key is overwritten in the same order, so
    // the merge below sees identical contents to a fresh seed.
    const baseLocals = seedCustomWaveState(
      wave,
      waveState.customWaveBaseLocalsPool[index],
    );
    // Never let a pooled seed become the persistent locals object (that would
    // alias two waves' state on the rare path where the slot is unseeded).
    const frameLocals = waveState.customWaveLocals[index] ?? {};

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

    // MilkDrop honours the preset's `samples` verbatim (capped at its 512-long
    // arrays) and then draws `samples - sep` points. We used to multiply it by
    // the quality detail scale, which is harmless retessellation for a line
    // wave but a direct light multiplier for a dot one — it drew ~2x the dots
    // the preset asked for. The detail scale may still cap DOWNWARD on a
    // constrained device; it must never scale up past what the preset wants.
    const requestedSamples = clamp(
      Math.round(frameLocals.samples ?? 512),
      1,
      MILKDROP_WAVE_ARRAY_LENGTH,
    );
    const separation = Math.max(0, Math.floor(frameLocals.sep ?? 0));
    const sampleCount = Math.max(
      1,
      Math.min(
        requestedSamples - separation,
        getCustomWaveSampleLimit(detailScale),
      ),
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
    // Non-reuse createEnv builds the copy with Object.create(signalEnv) so
    // the object is BORN with the right prototype. The previous
    // `{...frameLocals}` + reuseExtraAsEnv path guaranteed a
    // Object.setPrototypeOf on a fresh object every wave every frame — the
    // exact V8 deopt the reuse path's comment warns about — right before a
    // several-hundred-iteration per-point loop reads from it.
    const pointEnv = useProcedural ? null : createEnv(signals, frameLocals);
    const pointLocals = pointEnv ?? { ...frameLocals };
    waveState.pointLocalsScratch = pointLocals;

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
    let hasPerPointAlpha = false;

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
      // Four floats per point, not three: the per-point block's alpha rides in
      // the fourth slot (see MilkdropWaveVisual.colors).
      const targetLength = sampleCount * 4;
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
    // MilkDrop's value1/value2 are the LEFT and RIGHT channel samples, with
    // separation, stride, a two-pass smoothing and a scale applied — see
    // custom-wave-samples.ts. They have to be built for the whole wave up
    // front because the backward smoothing pass reads ahead.
    const waveSpectrum = (frameLocals.spectrum ?? 0) >= 0.5;
    const sampleValues = ensureCustomWaveSampleBuffers(sampleCount);
    fillCustomWaveSampleValues(
      getMilkdropWaveChannels(signals, waveSpectrum),
      {
        sampleCount,
        separation,
        spectrum: waveSpectrum,
        scaling,
        smoothing: frameLocals.smoothing ?? 0,
      },
      sampleValues.value1,
      sampleValues.value2,
    );

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
      const pointValue1 = sampleValues.value1[point] ?? 0;
      const pointValue2 = sampleValues.value2[point] ?? 0;

      if (proceduralSamples) {
        proceduralSamples[point] = pointValue1;
        if (proceduralSampleValues2) {
          proceduralSampleValues2[point] = pointValue2;
        }
        continue;
      }

      // Update audio-sample-driven and geometry values per point
      // (t/v already initialized above and carry between points)
      pointLocals.sample = sample;
      // MilkDrop has no separate `value` for custom waves; keep it aliased to
      // the left channel so a preset that reads it still gets something sane.
      pointLocals.value = pointValue1;
      pointLocals.value1 = pointValue1;
      pointLocals.value2 = pointValue2;
      // MilkDrop's default position, straight from the port: the block is
      // handed x/y already offset by the two channels, and 1016 of the 1018
      // presets with a per-point block overwrite both anyway.
      const milkdropX = 0.5 + pointValue1;
      const milkdropY = 0.5 + pointValue2;
      const rendererPointX = toRendererWaveX(milkdropX);
      const rendererPointY = toRendererWaveY(milkdropY);
      // Per-point code reads (and may write) x/y in MilkDrop [0,1] space
      // (y-down), matching the mesh per-pixel convention; rad/ang measure
      // distance from screen center in renderer (zero-centered) space.
      pointLocals.x = milkdropX;
      pointLocals.y = milkdropY;
      pointLocals.a = waveAlpha;
      pointLocals.rad = Math.sqrt(
        rendererPointX * rendererPointX + rendererPointY * rendererPointY,
      );
      pointLocals.ang = Math.atan2(rendererPointY, rendererPointX);
      if (pointEnv) {
        runProgram(wave.programs.perPoint, pointEnv, pointLocals);
      }
      const writeIndex = point * 3;
      if (positions) {
        positions[writeIndex] = toRendererWaveX(pointLocals.x);
        positions[writeIndex + 1] = toRendererWaveY(pointLocals.y);
        positions[writeIndex + 2] = 0.28;
      }
      if (pointColors) {
        const colorIndex = point * 4;
        const pointR = clamp(pointLocals.r ?? waveColor.r, 0, 1);
        const pointG = clamp(pointLocals.g ?? waveColor.g, 0, 1);
        const pointB = clamp(pointLocals.b ?? waveColor.b, 0, 1);
        // `pointLocals.a` was seeded with waveAlpha before the block ran, so
        // a block that never touches `a` reads back unchanged and the wave
        // keeps its authored alpha. A block that does write `a` — 629 of the
        // 2686 bundled presets — used to have that write thrown away, which
        // drew every point at full wave alpha and over-injected the feedback
        // loop by orders of magnitude.
        const pointA = clamp(pointLocals.a ?? waveAlpha, 0, 1);
        pointColors[colorIndex] = pointR;
        pointColors[colorIndex + 1] = pointG;
        pointColors[colorIndex + 2] = pointB;
        pointColors[colorIndex + 3] = pointA;
        hasPerPointColors ||=
          pointR !== waveColor.r ||
          pointG !== waveColor.g ||
          pointB !== waveColor.b;
        hasPerPointAlpha ||= pointA !== waveAlpha;
      }
    }

    // Only waves that actually built CPU geometry belong in the visual list.
    // A wave on the procedural path used to be pushed here too, as an entry
    // with zero positions — the renderer then had to skip it every frame, and
    // because syncWaveObject disposes on an empty wave it disposed and rebuilt
    // the NEXT wave's objects on every frame instead.
    if (visualWave && positions) {
      visualWave.alpha = waveAlpha;
      visualWave.thickness = clamp(frameLocals.thick ?? 1, 1, 6);
      visualWave.drawMode = drawMode;
      visualWave.additive = additive;
      // projectM rasterises a custom-wave dot at 2 device pixels and ignores
      // bDrawThick entirely (measured: thin and thick captures were identical,
      // 2px per dot both times). The old `thick * 3.2` spread each dot over
      // ~10px, so a dot wave injected an order of magnitude too much light.
      visualWave.pointSize = MILKDROP_CUSTOM_WAVE_DOT_SIZE;
      visualWave.spectrum = (frameLocals.spectrum ?? 0) >= 0.5;
      if ((hasPerPointColors || hasPerPointAlpha) && pointColors) {
        visualWave.colors = pointColors;
        visualWave.perPointAlpha = hasPerPointAlpha;
      } else {
        visualWave.colors = undefined;
        visualWave.perPointAlpha = false;
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
      // Frame constants the lowered block reads, copied by name. `frameLocals`
      // is prototyped onto the signal env (and through it the q register
      // bank), so one lookup resolves the wave's own t registers and per-frame
      // user variables as well as q1..q32.
      proceduralWave.registers = collectCustomWaveFieldRegisters(
        frameLocals,
        proceduralWave.fieldProgram,
        proceduralWave.registers,
      );
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
