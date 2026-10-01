/**
 * Main-wave modes 6 and 7 follow MilkDrop 2's geometry, which projectM and
 * Butterchurn both draw: lines across the screen at angle pi/2 * fWaveParam,
 * offset by wave_x, and for mode 7 two separate lines sep = wave_y^2 apart.
 * The lines are built in MilkDrop clip space (y up) and scaled to the scene's
 * square units by its half-extents.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildMainWaveFrame,
  buildMilkdropLineWave,
  defaultSignalEnv,
} from '../../src/js/milkdrop/vm/frame-generation.ts';

const silent = () => 0;
const ys = (line: Float32Array) =>
  Array.from({ length: line.length / 3 }, (_, i) => line[i * 3 + 1]);
const xs = (line: Float32Array) =>
  Array.from({ length: line.length / 3 }, (_, i) => line[i * 3]);

describe('buildMilkdropLineWave', () => {
  test('mode 7 is two separate level lines wave_y^2 either side of centre', () => {
    const lines = buildMilkdropLineWave({
      mode: 7,
      waveX: 0.5,
      waveY: 0.68,
      mystery: 0,
      scale: 1,
      count: 64,
      sampleLeft: silent,
      sampleRight: silent,
      half: { x: 1, y: 1 },
    });
    expect(lines).toHaveLength(2);
    const sep = 0.68 ** 2;
    // the left channel's line sits above centre
    for (const y of ys(lines[0])) expect(y).toBeCloseTo(sep, 5);
    for (const y of ys(lines[1])) expect(y).toBeCloseTo(-sep, 5);
    // edge to edge, clipped to the +/-1.1 box
    expect(Math.min(...xs(lines[0]))).toBeCloseTo(-1.1, 5);
    expect(Math.max(...xs(lines[0]))).toBeGreaterThan(1.05);
  });

  test('mode 6 is one line placed by wave_x, which wave_y does not move', () => {
    const at = (waveY: number) =>
      buildMilkdropLineWave({
        mode: 6,
        waveX: 0.3,
        waveY,
        mystery: 0,
        scale: 1,
        count: 32,
        sampleLeft: silent,
        sampleRight: silent,
        half: { x: 1, y: 1 },
      });
    const low = at(0.1);
    expect(low).toHaveLength(1);
    // wave_x 0.3 -> clip y -0.4 (projectM draws it 70% down the screen)
    for (const y of ys(low[0])) expect(y).toBeCloseTo(-0.4, 5);
    expect(ys(at(0.9)[0])).toEqual(ys(low[0]));
  });

  test('fWaveParam tilts the line by pi/2 per unit', () => {
    const [line] = buildMilkdropLineWave({
      mode: 6,
      waveX: 0.5,
      waveY: 0.5,
      mystery: 0.4,
      scale: 1,
      count: 32,
      sampleLeft: silent,
      sampleRight: silent,
      half: { x: 1, y: 1 },
    });
    const last = line.length - 3;
    const slope = (line[last + 1] - line[1]) / (line[last] - line[0]);
    expect(slope).toBeCloseTo(Math.tan(Math.PI * 0.5 * 0.4), 4);
  });

  test('a sample pushes the line sideways by a quarter of its scaled value', () => {
    const [line] = buildMilkdropLineWave({
      mode: 6,
      waveX: 0.5,
      waveY: 0.5,
      mystery: 0,
      scale: 2,
      count: 16,
      sampleLeft: () => 0.5,
      sampleRight: silent,
      half: { x: 1, y: 1 },
    });
    for (const y of ys(line)) expect(y).toBeCloseTo(0.25, 5);
  });

  test('a widescreen scene stretches the line edge to edge', () => {
    // a 16:9 scene spans +/-16/9 by +/-1 in square units
    const [line] = buildMilkdropLineWave({
      mode: 6,
      waveX: 0.3,
      waveY: 0.5,
      mystery: 0,
      scale: 1,
      count: 32,
      sampleLeft: silent,
      sampleRight: silent,
      half: { x: 16 / 9, y: 1 },
    });
    expect(Math.min(...xs(line))).toBeCloseTo(-1.1 * (16 / 9), 4);
    for (const y of ys(line)) expect(y).toBeCloseTo(-0.4, 5);
  });
});

describe('buildMainWaveFrame line modes', () => {
  const build = (wave_mode: number, reusableVisual?: unknown) =>
    buildMainWaveFrame({
      state: { wave_mode, wave_x: 0.5, wave_y: 0.68, wave_a: 0.6 },
      signals: defaultSignalEnv(),
      detailScale: 1,
      previousSamples: new Float32Array(0),
      previousMomentum: new Float32Array(0),
      useProcedural: true,
      reusableVisual: reusableVisual as never,
    });

  test('mode 7 draws both lines on the CPU, joined by an invisible bridge', () => {
    const { visual, procedural } = build(7);
    // never the single-strip procedural path, even when it is offered
    expect(procedural).toBeNull();
    const vertices = visual.positions.length / 3;
    expect(visual.perPointAlpha).toBe(true);
    const alphas = Array.from(
      { length: vertices },
      (_, i) => (visual.colors as Float32Array)[i * 4 + 3],
    );
    const hidden = alphas.flatMap((a, i) => (a === 0 ? [i] : []));
    expect(hidden).toEqual([(vertices - 2) / 2, vertices / 2]);
    for (const a of alphas.filter((value) => value > 0))
      expect(a).toBeCloseTo(0.6, 6);
    // the halves are the two lines, one above centre and one below
    const half = (vertices - 2) / 2;
    expect(visual.positions[1]).toBeGreaterThan(0);
    expect(visual.positions[(half + 2) * 3 + 1]).toBeLessThan(0);
  });

  test('a reused visual drops the bridge colours once the mode changes', () => {
    const first = build(7).visual;
    const next = build(0, first).visual;
    expect(next.colors).toBeUndefined();
    expect(next.perPointAlpha).toBe(false);
  });
});
