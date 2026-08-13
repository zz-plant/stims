import { describe, expect, test } from 'bun:test';
import { generateGlslFromShaderStatements } from '../../src/js/milkdrop/compiler/shader-analysis-glsl.ts';
import { compileProgramToWgsl } from '../../src/js/milkdrop/compiler/wgsl-generator.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { assembleMilkdropDirectFragmentShaders } from '../../src/js/milkdrop/feedback-manager-shared.ts';
import {
  applyHarmonicPercussiveUniforms,
  HARMONIC_PERCUSSIVE_SHADER_UNIFORM_DEFAULTS,
  HARMONIC_PERCUSSIVE_SHADER_UNIFORM_NAMES,
} from '../../src/js/milkdrop/harmonic-percussive-shader-signals.ts';
import { buildFeedbackCompositeState } from '../../src/js/milkdrop/renderer-helpers/feedback-composite.ts';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';
import { MILKDROP_WGSL_SIGNAL_FIELDS } from '../../src/js/milkdrop/wgsl-signal-layout.ts';

function presetSource(lines: string[]): string {
  return ['[preset00]', ...lines].join('\n');
}

function makeSignals(
  overrides: Partial<MilkdropRuntimeSignals> = {},
): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  frequencyData.fill(160);
  const waveformData = new Uint8Array(64);
  waveformData.fill(128);
  return {
    time: 1 / 60,
    deltaMs: 16.67,
    frame: 1,
    fps: 60,
    bass: 0.7,
    mid: 0.5,
    mids: 0.5,
    treb: 0.4,
    treble: 0.4,
    bassAtt: 0.6,
    midAtt: 0.45,
    midsAtt: 0.45,
    trebleAtt: 0.35,
    rms: 0.5,
    vol: 0.5,
    music: 0.58,
    beat: 1,
    beatPulse: 0.2,
    weightedEnergy: 0.58,
    frequencyData,
    waveformData,
    ...overrides,
  } as unknown as MilkdropRuntimeSignals;
}

/** A distinctive value per signal so a mis-wired uniform cannot pass by
 * accidentally matching a neighbour. */
const HPSS_FRAME = {
  percussive: 1.75,
  harmonic: 0.42,
  percussiveLow: 2.5,
  percussiveMid: 0.8,
  percussiveHigh: 3.25,
  percussiveRatio: 0.6875,
  percussive_low: 2.5,
  percussive_mid: 0.8,
  percussive_high: 3.25,
  percussive_ratio: 0.6875,
} as const;

function buildStateForSignals(signals: MilkdropRuntimeSignals) {
  const preset = compileMilkdropPresetSource(
    presetSource([
      'per_frame_1=q1 = percussive',
      'per_frame_2=q2 = harmonic',
      'per_frame_3=q3 = percussive_low',
      'per_frame_4=q4 = percussive_mid',
      'per_frame_5=q5 = percussive_high',
      'per_frame_6=q6 = percussive_ratio',
    ]),
    { id: 'hpss-frame' },
  );
  const frameState = createMilkdropVM(preset).step(signals);
  const state = buildFeedbackCompositeState({
    frameState,
    backend: 'webgl',
    directFeedbackShaders: true,
    webgpuFeedbackPlanShaderExecution: 'direct',
    getShaderTextureSourceId: () => 0,
    getShaderTextureBlendModeId: () => 0,
    getShaderSampleDimensionId: () => 0,
  });
  return { frameState, state };
}

/** Mirrors the uniform bag the WebGL warp/comp ShaderMaterials are created
 * with, so the test exercises the same write path the renderer uses. */
function makeUniformBag(): Record<string, { value: number }> {
  const bag: Record<string, { value: number }> = {};
  for (const name of HARMONIC_PERCUSSIVE_SHADER_UNIFORM_NAMES) {
    bag[name] = { value: HARMONIC_PERCUSSIVE_SHADER_UNIFORM_DEFAULTS[name] };
  }
  return bag;
}

describe('harmonic/percussive signals in shader bodies', () => {
  test('warp shader body resolves the new names to declared uniforms', () => {
    const compiled = compileMilkdropPresetSource(
      presetSource([
        'warp_1=`shader_body',
        'warp_2=`{',
        'warp_3=`ret = float3(percussive, harmonic, percussive_ratio) * float3(percussive_low, percussive_mid, percussive_high);',
        'warp_4=`}',
      ]),
      { id: 'hpss-warp' },
    );

    const program = compiled.ir.shaderText.warpProgram;
    expect(program).not.toBeNull();
    const glsl =
      program?.rawGlsl ??
      generateGlslFromShaderStatements(program?.statements ?? [], 'warp');

    // Every new name must have been rewritten; a leftover bare identifier
    // would reach GLSL undeclared and fail to compile.
    expect(glsl).not.toMatch(/(?<![A-Za-z])percussive/u);
    expect(glsl).not.toMatch(/(?<![A-Za-z])harmonic/u);
    for (const name of HARMONIC_PERCUSSIVE_SHADER_UNIFORM_NAMES) {
      expect(glsl).toContain(name);
    }

    const assembled = assembleMilkdropDirectFragmentShaders(glsl, null);
    for (const name of HARMONIC_PERCUSSIVE_SHADER_UNIFORM_NAMES) {
      expect(assembled.warp).toContain(`uniform float ${name};`);
      expect(assembled.composite).toContain(`uniform float ${name};`);
    }
  });

  test('camelCase aliases resolve in a shader body too', () => {
    const compiled = compileMilkdropPresetSource(
      presetSource([
        'comp_1=`shader_body',
        'comp_2=`{',
        'comp_3=`ret = float3(percussiveLow, percussiveMid, percussiveHigh) * percussiveRatio;',
        'comp_4=`}',
      ]),
      { id: 'hpss-comp-camel' },
    );
    const program = compiled.ir.shaderText.compProgram;
    const glsl =
      program?.rawGlsl ??
      generateGlslFromShaderStatements(program?.statements ?? [], 'comp');
    expect(glsl).toContain('signalPercussiveLow');
    expect(glsl).toContain('signalPercussiveMid');
    expect(glsl).toContain('signalPercussiveHigh');
    expect(glsl).toContain('signalPercussiveRatio');
  });

  test('uniform values match what the CPU per-frame equations see', () => {
    const signals = makeSignals(HPSS_FRAME);
    const { frameState, state } = buildStateForSignals(signals);

    const cpu = frameState.variables as Record<string, number>;
    expect(cpu.q1).toBeCloseTo(HPSS_FRAME.percussive, 10);
    expect(cpu.q2).toBeCloseTo(HPSS_FRAME.harmonic, 10);

    const bag = makeUniformBag();
    applyHarmonicPercussiveUniforms(bag, state);

    expect(bag.signalPercussive.value).toBeCloseTo(cpu.q1, 10);
    expect(bag.signalHarmonic.value).toBeCloseTo(cpu.q2, 10);
    expect(bag.signalPercussiveLow.value).toBeCloseTo(cpu.q3, 10);
    expect(bag.signalPercussiveMid.value).toBeCloseTo(cpu.q4, 10);
    expect(bag.signalPercussiveHigh.value).toBeCloseTo(cpu.q5, 10);
    expect(bag.signalPercussiveRatio.value).toBeCloseTo(cpu.q6, 10);

    // Guard against a mapping that happens to be self-consistent but wrong:
    // the six values must all be distinct in this frame.
    const values = HARMONIC_PERCUSSIVE_SHADER_UNIFORM_NAMES.map(
      (name) => bag[name].value,
    );
    expect(new Set(values).size).toBe(6);
  });

  test('neutral defaults before audio match the CPU path', () => {
    const signals = makeSignals();
    const { frameState, state } = buildStateForSignals(signals);
    const cpu = frameState.variables as Record<string, number>;

    const bag = makeUniformBag();
    applyHarmonicPercussiveUniforms(bag, state);

    expect(bag.signalPercussive.value).toBe(1);
    expect(bag.signalHarmonic.value).toBe(1);
    expect(bag.signalPercussiveLow.value).toBe(1);
    expect(bag.signalPercussiveMid.value).toBe(1);
    expect(bag.signalPercussiveHigh.value).toBe(1);
    expect(bag.signalPercussiveRatio.value).toBe(0.5);

    expect(cpu.q1).toBe(1);
    expect(cpu.q6).toBe(0.5);
  });

  test('GPU VM compute path reads the signals from the signal buffer', () => {
    const wgsl = compileProgramToWgsl({
      statements: [
        {
          target: 'q1',
          expression: { type: 'identifier', name: 'percussive' },
        },
        {
          target: 'q2',
          expression: { type: 'identifier', name: 'percussive_ratio' },
        },
        {
          target: 'q3',
          expression: { type: 'identifier', name: 'percussiveHigh' },
        },
      ],
      // biome-ignore lint/suspicious/noExplicitAny: minimal program block
    } as any).wgslCode;

    expect(wgsl).toContain('signals.percussive;');
    expect(wgsl).toContain('signals.percussive_ratio;');
    expect(wgsl).toContain('signals.percussive_high;');
    expect(wgsl).toContain('  percussive: f32,');
    expect(wgsl).toContain('  percussive_ratio: f32,');
  });

  test('signal buffer layout stays a tight f32 array', () => {
    // std430 struct of f32 only: no padding, stride 4, so the CPU-side
    // Float32Array index is the field index.
    expect(new Set(MILKDROP_WGSL_SIGNAL_FIELDS).size).toBe(
      MILKDROP_WGSL_SIGNAL_FIELDS.length,
    );
    const fields: readonly string[] = MILKDROP_WGSL_SIGNAL_FIELDS;
    for (const field of [
      'percussive',
      'harmonic',
      'percussive_low',
      'percussive_mid',
      'percussive_high',
      'percussive_ratio',
    ]) {
      expect(fields).toContain(field);
    }
  });
});
