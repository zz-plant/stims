import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import {
  describeShaderApproximation,
  isShaderApproximated,
  resolveShaderExecutionMode,
} from '../../src/js/milkdrop/shader-execution-mode.ts';

/**
 * The shared vocabulary for "is this preset rendering as authored on this
 * backend?". Everything that reports the fact — the agent snapshot, the dock
 * marker, the debug HUD, the telemetry counter — reads it through here, so
 * these are the assertions that keep those four surfaces agreeing.
 */

function compileBundled(presetId: string) {
  const source = readFileSync(
    join(
      process.cwd(),
      'public',
      'milkdrop-presets',
      'butterchurn',
      `${presetId}.milk`,
    ),
    'utf8',
  );
  return compileMilkdropPresetSource(source, {
    id: presetId,
    origin: 'bundled',
  });
}

describe('resolveShaderExecutionMode', () => {
  test('reads the compiler’s per-backend verdict off a real preset', () => {
    const compiled = compileBundled('martin-city-of-shadows');
    expect(resolveShaderExecutionMode(compiled, 'webgl')).toBe('direct');
    expect(['direct', 'translated', 'unsupported', 'none']).toContain(
      String(resolveShaderExecutionMode(compiled, 'webgpu')),
    );
  });

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
  test('missing preset or backend resolves to null rather than a guess', () => {
    const compiled = compileBundled('martin-city-of-shadows');
    expect(resolveShaderExecutionMode(null, 'webgpu')).toBeNull();
    expect(resolveShaderExecutionMode(compiled, null)).toBeNull();
    expect(isShaderApproximated(null)).toBe(false);
    expect(describeShaderApproximation(null, 'webgpu')).toBeNull();
  });
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
