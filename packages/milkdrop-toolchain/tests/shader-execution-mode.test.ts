import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../src/compiler.ts';
import {
  describeShaderApproximation,
  isShaderApproximated,
  resolveShaderExecutionMode,
} from '../src/shader-execution-mode.ts';

/**
 * The shared vocabulary for "is this preset rendering as authored on this
 * backend?". Everything that reports the fact — the agent snapshot, the dock
 * marker, the debug HUD, the telemetry counter — reads it through here, so
 * these are the assertions that keep those four surfaces agreeing.
 */

describe('resolveShaderExecutionMode', () => {
  test('a preset with no shader text reports "none", not an approximation', () => {
    const compiled = compileMilkdropPresetSource(
      '[preset00]\nzoom=1.01\nper_frame_1=rot = rot + 0.01;\n',
      { id: 'no-shader-text', origin: 'bundled' },
    );
    expect(resolveShaderExecutionMode(compiled, 'webgl')).toBe('none');
    expect(resolveShaderExecutionMode(compiled, 'webgpu')).toBe('none');
    expect(isShaderApproximated('none')).toBe(false);
  });

  // Null is "not known yet" (boot, failed load), never "fine" — a caller that
  // treats it as fine reintroduces exactly the silence this module exists to
  // break, so it must not be approximated *or* direct.
});

describe('isShaderApproximated', () => {
  test('only translated and unsupported count as approximated', () => {
    expect(isShaderApproximated('direct')).toBe(false);
    expect(isShaderApproximated('none')).toBe(false);
    expect(isShaderApproximated('translated')).toBe(true);
    expect(isShaderApproximated('unsupported')).toBe(true);
  });
});

describe('describeShaderApproximation', () => {
  test('says nothing when nothing is being approximated', () => {
    expect(describeShaderApproximation('direct', 'webgpu')).toBeNull();
    expect(describeShaderApproximation('none', 'webgl')).toBeNull();
  });

  test('names the backend doing the approximating', () => {
    const gpu = describeShaderApproximation('translated', 'webgpu');
    expect(gpu?.label).toBe('Approximated');
    expect(gpu?.detail).toContain('WebGPU');
    expect(
      describeShaderApproximation('translated', 'webgl')?.detail,
    ).toContain('WebGL');
  });

  test('distinguishes an unsupported subset from a backend that cannot run it', () => {
    const unsupported = describeShaderApproximation('unsupported', 'webgpu');
    const translated = describeShaderApproximation('translated', 'webgpu');
    expect(unsupported?.detail).not.toBe(translated?.detail);
    expect(unsupported?.detail).toContain('supported subset');
  });
});
