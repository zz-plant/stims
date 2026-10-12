/**
 * Coverage for the per-vertex built-in skip mask in
 * src/js/milkdrop/vm/geometry-builder.ts (getMeshBuiltinMask) and the
 * toolchain reference analysis behind it
 * (milkdrop-toolchain/src/program-references.ts).
 *
 * The mask decides which built-in per-pixel variables the mesh transform
 * seeds, resets and re-reads per vertex. A skipped built-in must never be
 * observable: these tests pin (a) the mask bits per crafted program, (b)
 * that a read-only reference still sees the frame base (seeded once per
 * pass, not zero), (c) that a written built-in still gets its per-vertex
 * reset so conditional writes cannot leak between vertices, and (d) that
 * custom waves — which read their own x/rad, not the mesh scratch — are
 * unaffected while the per-pixel program's q-register writes still reach
 * them.
 */
import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types.ts';
import {
  getMeshBuiltinMask,
  type MeshBuiltinMask,
} from '../../src/js/milkdrop/vm/geometry-builder.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

let serial = 0;
function compile(lines: string[]) {
  return compileMilkdropPresetSource(`[preset00]\n${lines.join('\n')}\n`, {
    id: `mesh-skip-${serial++}`,
  });
}

const NONE: MeshBuiltinMask = {
  writesZoom: false,
  writesZoomExp: false,
  writesRot: false,
  writesWarp: false,
  writesCx: false,
  writesCy: false,
  writesSx: false,
  writesSy: false,
  writesDx: false,
  writesDy: false,
  refsRad: false,
  refsAng: false,
  seedZoom: false,
  seedZoomExp: false,
  seedRot: false,
  seedWarp: false,
  seedCx: false,
  seedCy: false,
  seedSx: false,
  seedSy: false,
  seedDx: false,
  seedDy: false,
};

function maskOf(lines: string[]): MeshBuiltinMask {
  return getMeshBuiltinMask(compile(lines).ir.programs.perPixel);
}

function makeSignals(frame: number, aspect: number): MilkdropRuntimeSignals {
  return {
    time: frame / 60,
    deltaMs: 16.67,
    frame,
    fps: 60,
    aspect,
    bass: 0.7,
    mid: 0.5,
    mids: 0.5,
    treb: 0.4,
    treble: 0.4,
    bassAtt: 0.6,
    midAtt: 0.45,
    midsAtt: 0.45,
    treb_att: 0.35,
    trebleAtt: 0.35,
    treble_att: 0.35,
    bass_att: 0.6,
    mid_att: 0.45,
    mids_att: 0.45,
    rms: 0.5,
    vol: 0.5,
    music: 0.58,
    beat: frame % 2,
    beatPulse: 0.2,
    beat_pulse: 0.2,
    transient: 0,
    spectralFlux: 0,
    bandFlux: 0,
    frequencyData: new Uint8Array(64).fill(160),
    waveformData: new Float32Array(512),
  } as unknown as MilkdropRuntimeSignals;
}

function stepOnce(lines: string[], aspect = 2) {
  const vm = createMilkdropVM(compile(lines));
  return vm.step(makeSignals(0, aspect));
}

const variablesOf = (frame: ReturnType<typeof stepOnce>) =>
  frame.variables as unknown as Record<string, number>;

describe('getMeshBuiltinMask', () => {
  test('a preset without per-pixel code references nothing', () => {
    expect(maskOf(['per_frame_1=zoom = 1.02;'])).toEqual(NONE);
  });

  test('a program that only reads rad seeds rad and nothing else', () => {
    expect(maskOf(['per_pixel_1=q2 = rad;'])).toEqual({
      ...NONE,
      refsRad: true,
    });
  });

  test('a read-only reference is seeded, not reset', () => {
    expect(maskOf(['per_pixel_1=q4 = zoom + cx;'])).toEqual({
      ...NONE,
      seedZoom: true,
      seedCx: true,
    });
  });

  test('an alias spelling (fzoom) counts as a zoom reference', () => {
    expect(maskOf(['per_pixel_1=q4 = fzoom;'])).toEqual({
      ...NONE,
      seedZoom: true,
    });
  });

  test('an assignment nested in an expression is a write', () => {
    expect(maskOf(['per_pixel_1=q4 = 1 + (rot = 0.2);'])).toEqual({
      ...NONE,
      writesRot: true,
    });
  });

  test('a write inside a loop body is a write', () => {
    expect(maskOf(['per_pixel_1=loop(2, zoom = zoom + 0.01);'])).toEqual({
      ...NONE,
      writesZoom: true,
    });
  });

  test('a program referencing every built-in seeds all of them', () => {
    const mask = maskOf([
      'per_pixel_1=q1 = x + y + rad + ang;',
      'per_pixel_2=q2 = zoom + zoomexp + rot + warp;',
      'per_pixel_3=q3 = cx + cy + sx + sy + dx + dy;',
    ]);
    expect(mask).toEqual({
      ...NONE,
      refsRad: true,
      refsAng: true,
      seedZoom: true,
      seedZoomExp: true,
      seedRot: true,
      seedWarp: true,
      seedCx: true,
      seedCy: true,
      seedSx: true,
      seedSy: true,
      seedDx: true,
      seedDy: true,
    });
  });

  test('a program writing every control resets all of them and seeds none', () => {
    const mask = maskOf([
      'per_pixel_1=zoom = x; zoomexp = y; rot = rad; warp = ang;',
      'per_pixel_2=cx = x; cy = y; sx = rad; sy = ang;',
      'per_pixel_3=dx = x; dy = y;',
    ]);
    expect(mask).toEqual({
      ...NONE,
      writesZoom: true,
      writesZoomExp: true,
      writesRot: true,
      writesWarp: true,
      writesCx: true,
      writesCy: true,
      writesSx: true,
      writesSy: true,
      writesDx: true,
      writesDy: true,
      refsRad: true,
      refsAng: true,
    });
  });
});

describe('per-vertex built-in skip behavior', () => {
  test('rad-only: the program still sees the lattice radius of its vertex', () => {
    // fWarp=0 keeps the ripple path off, so rad is seeded ONLY because the
    // program references it — the case the skip must not break.
    const frame = stepOnce(['fWarp=0.000000', 'per_pixel_1=q2 = rad;']);
    // Motion vectors are off; the last per-pixel run is the last mesh
    // vertex (x = 1, y = 1). With aspect 2 the lattice radius there is
    // hypot(1 * 1, 1 * 0.5), stored through the Float32 lattice.
    const expected = new Float32Array([Math.hypot(1, 0.5)])[0];
    expect(variablesOf(frame).q2).toBe(expected);
  });

  test('ang-only: the program still sees the lattice angle of its vertex', () => {
    const frame = stepOnce(['fWarp=0.000000', 'per_pixel_1=q3 = ang;']);
    const expected = new Float32Array([Math.atan2(0.5, 1)])[0];
    expect(variablesOf(frame).q3).toBe(expected);
  });

  test('read-only built-ins still read the frame base, not zero', () => {
    const frame = stepOnce([
      'per_frame_1=zoom = 1.37;',
      'per_frame_2=cx = 0.42;',
      'per_pixel_1=q4 = zoom + cx;',
    ]);
    // If the once-per-pass seeding were dropped, the reads would resolve
    // through the scratch prototype chain to 0 and q4 would be 0.
    expect(variablesOf(frame).q4).toBe(1.37 + 0.42);
  });

  test('a conditional write cannot leak the previous vertex value', () => {
    // Variant A relies on the per-vertex reset for its else branch; variant
    // B writes the base explicitly. The reset makes them identical.
    const resetVariant = stepOnce([
      'fZoom=1.010000',
      'per_pixel_1=zoom = if(above(x, 0.9), 3, zoom);',
    ]);
    const explicitVariant = stepOnce([
      'fZoom=1.010000',
      'per_pixel_1=zoom = if(above(x, 0.9), 3, 1.01);',
    ]);
    // The fixtures are live: some vertices must take each branch, and the
    // zoom=3 region must actually move the mesh, or the comparison asserts
    // nothing.
    const noPerPixel = stepOnce(['fZoom=1.010000']);
    expect(
      Array.prototype.some.call(
        resetVariant.mesh.positions,
        (value: number, index: number) =>
          value !== noPerPixel.mesh.positions[index],
      ),
    ).toBe(true);
    const warp = resetVariant.warpField;
    const explicitWarp = explicitVariant.warpField;
    if (!warp || !explicitWarp) {
      throw new Error('per-pixel zoom write must produce a warp field');
    }
    expect([...resetVariant.mesh.positions]).toEqual([
      ...explicitVariant.mesh.positions,
    ]);
    expect([...warp.positions]).toEqual([...explicitWarp.positions]);
    expect([...warp.sampleUvs]).toEqual([...explicitWarp.sampleUvs]);
  });

  test('custom waves read their own x/rad; only q registers are shared', () => {
    const wave = [
      'wavecode_0_enabled=1',
      'wavecode_0_samples=512',
      'wavecode_0_sep=0',
      'wavecode_0_bSpectrum=0',
      'wavecode_0_bUseDots=0',
      'wavecode_0_bDrawThick=1',
      'wavecode_0_bAdditive=0',
      'wavecode_0_scaling=1.0',
      'wavecode_0_smoothing=0.0',
      'wavecode_0_r=1.0',
      'wavecode_0_g=1.0',
      'wavecode_0_b=1.0',
      'wavecode_0_a=1.0',
      'wave_0_per_point1=x = x + q8*0.05 + rad*0.01;',
    ];
    const wavePositions = (frame: ReturnType<typeof stepOnce>) =>
      frame.customWaves[0] ? [...frame.customWaves[0].positions] : [];

    // The per-pixel program references none of the mesh built-ins, yet its
    // q-register write must reach the wave, and the wave's own x/rad must
    // come from its sample path: identical geometry to setting q8 per frame.
    const fromPerPixel = stepOnce([...wave, 'per_pixel_1=q8 = 0.7;']);
    const fromPerFrame = stepOnce([...wave, 'per_frame_1=q8 = 0.7;']);
    const shifted = stepOnce([...wave, 'per_frame_1=q8 = 0.3;']);

    expect(wavePositions(fromPerPixel).length).toBeGreaterThan(0);
    expect(wavePositions(fromPerPixel)).toEqual(wavePositions(fromPerFrame));
    // Non-vacuous: the wave geometry does respond to the shared register.
    expect(wavePositions(fromPerPixel)).not.toEqual(wavePositions(shifted));
  });

  test('a program referencing every built-in renders a finite mesh', () => {
    const frame = stepOnce([
      'per_pixel_1=q1 = x + y + rad + ang;',
      'per_pixel_2=q2 = zoom + zoomexp + rot + warp;',
      'per_pixel_3=q3 = cx + cy + sx + sy + dx + dy;',
    ]);
    expect(frame.mesh.positions.length).toBeGreaterThan(0);
    for (const value of frame.mesh.positions) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
