/**
 * Every WebGPU procedural material packs its runtime signals into the five
 * signalsA..signalsE vec4s the generated WGSL unpacks. THREE.TSL's vec4()
 * does not throw on a missing component: it logs
 * `THREE.TSL: Invalid parameter for the type "vec4"` and returns a constant
 * zero vec4, so one absent uniform silently zeroes the whole vector (and the
 * three signals that shared it). These tests pin the uniform states against
 * SIGNAL_UNIFORM_VECTOR_LAYOUT and assert material construction is quiet.
 *
 * Regression: createCustomWaveUniformState() declared no signalPixelsX/Y or
 * previousSignalPixelsX/Y, so signalsE and previousSignalsE were constant
 * zero on every custom-wave material — which also blanked music and
 * weightedEnergy, and printed two console errors per capture.
 */
import { describe, expect, test } from 'bun:test';
import {
  createProceduralCustomWaveMaterial,
  createProceduralMeshMaterial,
  createProceduralMotionVectorMaterial,
  SIGNAL_UNIFORM_VECTOR_LAYOUT,
} from '../../src/js/milkdrop/renderer-backends/webgpu-procedural-materials.ts';

function signalUniformNames(prefix: 'signal' | 'previousSignal') {
  return Object.values(SIGNAL_UNIFORM_VECTOR_LAYOUT).flatMap((suffixes) =>
    suffixes.map((suffix) => `${prefix}${suffix}`),
  );
}

function collectConsoleErrors(build: () => unknown) {
  const original = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    build();
  } finally {
    console.error = original;
  }
  return messages;
}

const MATERIALS = [
  {
    name: 'mesh',
    create: () => createProceduralMeshMaterial(),
    prefixes: ['signal'] as const,
  },
  {
    name: 'motion vector',
    create: () => createProceduralMotionVectorMaterial(),
    prefixes: ['signal', 'previousSignal'] as const,
  },
  {
    name: 'custom wave',
    create: () => createProceduralCustomWaveMaterial(),
    prefixes: ['signal', 'previousSignal'] as const,
  },
];

describe('WebGPU procedural material signal uniforms', () => {
  for (const { name, create, prefixes } of MATERIALS) {
    test(`${name} material declares every packed signal uniform`, () => {
      const material = create() as { uniforms: Record<string, unknown> };
      const missing = prefixes
        .flatMap(signalUniformNames)
        .filter((uniformName) => material.uniforms[uniformName] === undefined);
      expect(missing).toEqual([]);
    });

    test(`${name} material builds without a TSL parameter error`, () => {
      expect(collectConsoleErrors(create)).toEqual([]);
    });
  }

  test('custom wave signalsE carries pixelsx/pixelsy, not a zero fallback', () => {
    const material = createProceduralCustomWaveMaterial() as {
      uniforms: Record<string, { value: unknown }>;
    };
    expect(material.uniforms.signalPixelsX?.value).toBeGreaterThan(0);
    expect(material.uniforms.signalPixelsY?.value).toBeGreaterThan(0);
    expect(material.uniforms.previousSignalPixelsX?.value).toBeGreaterThan(0);
    expect(material.uniforms.previousSignalPixelsY?.value).toBeGreaterThan(0);
  });
});
