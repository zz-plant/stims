import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  describeShaderApproximation,
  isShaderApproximated,
  resolveShaderExecutionMode,
} from 'milkdrop-toolchain/src/shader-execution-mode.ts';

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
