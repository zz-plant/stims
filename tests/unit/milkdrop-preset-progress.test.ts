/**
 * MilkDrop's `progress` is how far the current preset is through its display
 * slot: 0 when it starts, 1 when the next preset is due (MilkDrop 2's
 * (now - presetStart) / (nextPresetTime - presetStart); projectM's
 * TimeKeeper::PresetProgressA, clamped at 1). Stims used to publish the
 * frame count under that name, so a preset ramping on it overshot within a
 * frame — rovastar-virtual-horizons-jelly-v3's `sy = sy + 0.05*progress`
 * stretched the picture sixteenfold in five seconds.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { lowerGpuFieldProgram } from 'milkdrop-toolchain/src/compiler/gpu-field-planner.ts';
import { generateGlslFromShaderStatements } from 'milkdrop-toolchain/src/compiler/shader-analysis-glsl.ts';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { parseMilkdropStatement } from 'milkdrop-toolchain/src/expression.ts';
import { __setJitAvailableForTests } from 'milkdrop-toolchain/src/expression-jit.ts';
import { MILKDROP_WGSL_SIGNAL_FIELDS } from 'milkdrop-toolchain/src/wgsl-signal-layout.ts';
import { applyCompositeUniformState } from '../../src/js/milkdrop/feedback-manager-shared.ts';
import { buildFeedbackCompositeState } from '../../src/js/milkdrop/renderer-helpers/feedback-composite.ts';
import { autoAdvanceDwellSeconds } from '../../src/js/milkdrop/runtime/lifecycle.ts';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';
import { DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS } from '../../src/js/milkdrop/webgpu-optimization-flags.ts';

const FPS = 60;
/** Stims' default autoplay dwell — what `progress` ramps over by default. */
const SLOT_SECONDS = 30;
/** The host clock is global (it does not restart per preset), so start the
 * preset well into it: a `progress` derived from raw `time` cannot pass. */
const SESSION_START = 1234.5;

function makeSignals(time: number): MilkdropRuntimeSignals {
  return {
    time,
    deltaMs: 1000 / FPS,
    frame: Math.round(time * FPS),
    fps: FPS,
    bass: 1,
    mid: 1,
    mids: 1,
    treb: 1,
    treble: 1,
    bassAtt: 1,
    midAtt: 1,
    midsAtt: 1,
    trebleAtt: 1,
    bass_att: 1,
    mid_att: 1,
    mids_att: 1,
    treb_att: 1,
    treble_att: 1,
    rms: 0.5,
    vol: 1,
    music: 0.5,
    beat: 0,
    beatPulse: 0,
    beat_pulse: 0,
    weightedEnergy: 0.5,
    frequencyData: new Uint8Array(64),
    waveformData: new Uint8Array(64).fill(128),
  } as unknown as MilkdropRuntimeSignals;
}

function compile(lines: string[], id = 'progress-probe') {
  return compileMilkdropPresetSource(lines.join('\n'), { id });
}

const PER_FRAME_PROBE = ['[preset00]', 'per_frame_1=q1 = progress;'];

type Vm = ReturnType<typeof createMilkdropVM>;

/** `progress` depends only on the host clock, so stepping four times a
 * second covers the same ground as 60 fps without 5k full frame builds. */
const STEP_SECONDS = 0.25;

/** Steps `vm` from `from` to `to` seconds of host time and returns the last
 * frame's `q1`. */
function runUntil(vm: Vm, from: number, to: number) {
  let q1 = Number.NaN;
  for (let step = 0; from + step * STEP_SECONDS <= to + 1e-9; step += 1) {
    q1 = vm.step(makeSignals(from + step * STEP_SECONDS)).variables.q1;
  }
  return q1;
}

afterEach(() => __setJitAvailableForTests(null));

describe('MilkDrop progress', () => {
  test.each([
    ['JIT', true],
    ['interpreter', false],
  ])('ramps 0 to 1 over the preset slot and holds at 1 (%s)', (_tier, jit) => {
    __setJitAvailableForTests(jit);
    // A fresh compile per tier: compiled programs are cached per block.
    const vm = createMilkdropVM(compile(PER_FRAME_PROBE, `progress-${jit}`));

    expect(runUntil(vm, SESSION_START, SESSION_START)).toBe(0);
    expect(
      runUntil(vm, SESSION_START + STEP_SECONDS, SESSION_START + 7.5),
    ).toBeCloseTo(0.25, 6);
    expect(
      runUntil(vm, SESSION_START + 7.5 + STEP_SECONDS, SESSION_START + 15),
    ).toBeCloseTo(0.5, 6);
    expect(
      runUntil(vm, SESSION_START + 15 + STEP_SECONDS, SESSION_START + 30),
    ).toBeCloseTo(1, 6);
    // Autoplay off: the preset outlives its slot and stays at its end state.
    expect(
      runUntil(vm, SESSION_START + 30 + STEP_SECONDS, SESSION_START + 90),
    ).toBe(1);
  });

  test('the default slot is the autoplay dwell', () => {
    expect(autoAdvanceDwellSeconds(2.5)).toBe(SLOT_SECONDS);
    expect(autoAdvanceDwellSeconds(40)).toBe(46);
  });

  test('restarts when a preset is applied, on the slot set at that moment', () => {
    const vm = createMilkdropVM(compile(PER_FRAME_PROBE));
    runUntil(vm, SESSION_START, SESSION_START + 10);

    // A longer blend lengthens the dwell, but a running preset keeps the
    // slot it started with, as in MilkDrop and projectM.
    vm.setPresetDuration(60);
    expect(
      runUntil(vm, SESSION_START + 10 + STEP_SECONDS, SESSION_START + 15),
    ).toBeCloseTo(0.5, 6);

    vm.setPreset(compile(PER_FRAME_PROBE, 'next-preset'));
    const restart = SESSION_START + 20;
    expect(runUntil(vm, restart, restart)).toBe(0);
    expect(runUntil(vm, restart + STEP_SECONDS, restart + 15)).toBeCloseTo(
      0.25,
      6,
    );
  });

  test('each crossfade deck keeps its own preset clock', () => {
    const host = createMilkdropVM(compile(PER_FRAME_PROBE, 'outgoing'));
    runUntil(host, SESSION_START, SESSION_START + 12);

    const outgoing = host.handOffRunningPreset(
      compile(PER_FRAME_PROBE, 'incoming'),
    );
    // Both decks step on one shared signals object, as in the frame loop.
    const signals = makeSignals(SESSION_START + 15);
    expect(outgoing.step(signals).variables.q1).toBeCloseTo(0.5, 6);
    expect(host.step(signals).variables.q1).toBe(0);
  });

  test('a custom wave or shape that assigns progress still sees it ramp', () => {
    // MilkDrop reloads progress (with time, bass, …) into every wave and
    // shape before its per-frame code; imus-and-rovastar-the-shroomery-
    // psilobellum zeroes it in wave init and fades its red with it per point.
    const vm = createMilkdropVM(
      compile([
        '[preset00]',
        'wavecode_0_enabled=1',
        'wave_0_init1=progress = 0;',
        'wave_0_per_frame1=r = 1 - progress;',
        'shapecode_0_enabled=1',
        'shape_0_init1=progress = 0;',
        'shape_0_per_frame1=a = progress;',
      ]),
    );
    runUntil(vm, SESSION_START, SESSION_START + 15);
    const frame = vm.step(makeSignals(SESSION_START + 15));

    expect(frame.variables.wave1_progress).toBeCloseTo(0.5, 6);
    expect(frame.variables.wave1_r).toBeCloseTo(0.5, 6);
    expect(frame.variables.shape1_progress).toBeCloseTo(0.5, 6);
    expect(frame.variables.shape1_a).toBeCloseTo(0.5, 6);
  });

  test('shader bodies read the preset progress, not the frame count', () => {
    const preset = compile([
      ...PER_FRAME_PROBE,
      'comp_1=`shader_body',
      'comp_2=`{',
      'comp_3=`ret = float3(progress, progress, progress);',
      'comp_4=`}',
    ]);
    const program = preset.ir.shaderText.compProgram;
    const glsl =
      program?.rawGlsl ??
      generateGlslFromShaderStatements(program?.statements ?? [], 'comp');
    expect(glsl).toContain('signalProgress');
    expect(glsl).not.toContain('signalFrame');

    const vm = createMilkdropVM(preset);
    runUntil(vm, SESSION_START, SESSION_START + 15);
    const frameState = vm.step(makeSignals(SESSION_START + 15));
    const state = buildFeedbackCompositeState({
      frameState,
      backend: 'webgl',
      directFeedbackShaders: true,
      webgpuFeedbackPlanShaderExecution: 'direct',
      getShaderTextureSourceId: () => 0,
      getShaderTextureBlendModeId: () => 0,
      getShaderSampleDimensionId: () => 0,
    });
    // Every uniform the composite pass writes; vector ones get a stub whose
    // setters (setRGB, set, …) accept anything.
    const vectorStub = new Proxy({}, { get: () => () => undefined });
    const uniforms = new Proxy({} as Record<string, { value: unknown }>, {
      get: (target, key: string) => {
        target[key] ??= { value: vectorStub };
        return target[key];
      },
    });
    applyCompositeUniformState(
      uniforms as Parameters<typeof applyCompositeUniformState>[0],
      state,
      Array.from({ length: 3 }, () => ({ scale: 1, bias: 0 })),
    );

    expect(frameState.variables.q1).toBeCloseTo(0.5, 6);
    expect(uniforms.signalProgress.value).toBe(frameState.variables.q1);
  });

  test('the GPU compute VM reads the same progress from its signal buffer', async () => {
    const progressIndex = MILKDROP_WGSL_SIGNAL_FIELDS.indexOf('progress');
    let uploaded: Float32Array | null = null;
    const device = {
      createBuffer: (desc: { label?: string; size: number }) => ({
        label: desc.label,
        destroy() {},
        async mapAsync() {},
        getMappedRange: () => new ArrayBuffer(desc.size || 256),
        unmap() {},
      }),
      createShaderModule: () => ({}),
      createBindGroupLayout: () => ({}),
      createPipelineLayout: () => ({}),
      createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBindGroup: () => ({}),
      createCommandEncoder: () => ({
        beginComputePass: () => ({
          setPipeline() {},
          setBindGroup() {},
          dispatchWorkgroups() {},
          end() {},
        }),
        copyBufferToBuffer() {},
        finish: () => ({}),
      }),
      queue: {
        writeBuffer(
          buffer: { label?: string },
          _offset: number,
          data: unknown,
        ) {
          if (buffer.label === 'milkdrop-vm-signals') {
            uploaded = Float32Array.from(data as Float32Array);
          }
        },
        submit() {},
        async onSubmittedWorkDone() {},
      },
    };
    const vm = createMilkdropVM(compile(PER_FRAME_PROBE), {
      ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
      gpuComputeVM: true,
    });
    vm.setRenderBackend('webgpu');
    expect(vm.setGpuDevice(device as unknown as GPUDevice)).toBe(true);

    await vm.stepAsync(makeSignals(SESSION_START));
    await vm.stepAsync(makeSignals(SESSION_START + 15));

    expect(progressIndex).toBeGreaterThanOrEqual(0);
    expect(uploaded?.[progressIndex]).toBeCloseTo(0.5, 6);
  });

  test('a per-pixel read the GPU field path cannot feed stays on the CPU', () => {
    const statement = parseMilkdropStatement('zoom = 1 + 0.1*progress', 1);
    if (!statement.value) {
      throw new Error('probe statement did not parse');
    }
    const program = {
      statements: [statement.value],
      sourceLines: ['zoom = 1 + 0.1*progress'],
    };
    // Lowered as a zero-initialised temporary, the GPU would draw the preset
    // as if it had just started while every CPU tier read the real value.
    expect(lowerGpuFieldProgram(program)).toBeNull();
    // Assigned in per-frame code it is a frame constant like q1, which the
    // VM feeds from the same environment the CPU reads.
    expect(
      lowerGpuFieldProgram(program, { registerInputs: ['progress'] })
        ?.registerInputs,
    ).toContain('progress');
  });
});
