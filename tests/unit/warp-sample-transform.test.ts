import { describe, expect, test } from 'bun:test';
import {
  computeLegacyWarpSampleUv,
  computeWarpSampleRad,
  computeWarpSampleUv,
  computeWarpZoomDivisor,
  perPixelWritesWarpTransform,
} from '../../src/js/milkdrop/warp-sample-transform.ts';

/**
 * Pure-CPU cover for the WebGPU per-pixel warp transform.
 *
 * The node graph in feedback-manager-webgpu-tsl.ts cannot run without a GPU,
 * so warp-sample-transform.ts carries a scalar twin of the same algebra and
 * this file pins it. Two things are being protected:
 *
 *   1. Fidelity: the transform must be butterchurn 2.6.7's runPixelEquations
 *      ordering, not the repo's CPU mesh ordering (which zooms about cx/cy,
 *      applies sx/sy last, and squares the aspect in rad).
 *   2. Blast radius: a previous attempt at making these five live was refused
 *      because it moved a passing reference. The gate below is what keeps that
 *      from recurring, and the 300-beatdetect case asserts BIT-for-bit
 *      equality with the legacy expression rather than mere closeness.
 */

const ASPECT_X = 1;
const ASPECT_Y = 0.5625; // 1280x720, the capture aspect

function relativeError(actual: number, expected: number): number {
  if (actual === expected) {
    return 0;
  }
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
}

/**
 * Independent oracle: butterchurn 2.6.7 lib/butterchurn.js:2626-2657,
 * transcribed literally, with its ripple term (which the WebGPU node graph
 * applies separately, further down the pass) omitted.
 *
 * Takes the lattice NDC the way butterchurn does and returns butterchurn's
 * final (u, v) so the axis conventions can be compared end to end.
 */
function butterchurnSampleUv({
  ndcX,
  ndcY,
  aspectx,
  aspecty,
  zoom,
  zoomExp,
  cx,
  cy,
  sx,
  sy,
  rot,
  dx,
  dy,
}: Record<string, number>) {
  const rad = Math.sqrt(
    ndcX * ndcX * aspectx * aspectx + ndcY * ndcY * aspecty * aspecty,
  );
  const zoom2V = zoom ** (zoomExp ** (rad * 2 - 1));
  const zoom2Inv = 1 / zoom2V;
  let u = ndcX * 0.5 * aspectx * zoom2Inv + 0.5;
  let v = -ndcY * 0.5 * aspecty * zoom2Inv + 0.5;
  u = (u - cx) / sx + cx;
  v = (v - cy) / sy + cy;
  const u2 = u - cx;
  const v2 = v - cy;
  const cosRot = Math.cos(rot);
  const sinRot = Math.sin(rot);
  u = u2 * cosRot - v2 * sinRot + cx;
  v = u2 * sinRot + v2 * cosRot + cy;
  u -= dx;
  v -= dy;
  u = (u - 0.5) / aspectx + 0.5;
  v = (v - 0.5) / aspecty + 0.5;
  return { u, v };
}

describe('perPixelWritesWarpTransform (the blast-radius gate)', () => {
  test('is false for a preset with no per-pixel block at all', () => {
    // 100-square, 250-wavecode, 260/261-compshader, eos-glowsticks-v2-03-music
    // and eos-phat-cubetrace-v2 — six of the nine certified references.
    expect(perPixelWritesWarpTransform(null)).toBe(false);
    expect(perPixelWritesWarpTransform(undefined)).toBe(false);
    expect(perPixelWritesWarpTransform([])).toBe(false);
  });

  test('is false for a block that only writes the already-live variables', () => {
    // rovastar-parallel-universe: dx/dy/q1 only.
    expect(
      perPixelWritesWarpTransform([
        { target: 'myx' },
        { target: 'q1' },
        { target: 'dy' },
        { target: 'dx' },
        { target: 'zoom' },
        { target: 'rot' },
        { target: 'warp' },
      ]),
    ).toBe(false);
  });

  test('is true for each of the five newly consumed targets', () => {
    for (const target of ['cx', 'cy', 'sx', 'sy', 'zoomexp']) {
      expect(perPixelWritesWarpTransform([{ target }])).toBe(true);
      expect(
        perPixelWritesWarpTransform([{ target: target.toUpperCase() }]),
      ).toBe(true);
    }
  });

  test('is true for 300-beatdetect and krash-cerebral-demons-stars', () => {
    // The only two certified references whose per-pixel blocks touch them.
    expect(perPixelWritesWarpTransform([{ target: 'cx' }])).toBe(true);
    expect(
      perPixelWritesWarpTransform([
        { target: 'cx' },
        { target: 'cy' },
        { target: 'newx' },
        { target: 'dx' },
        { target: 'rot' },
        { target: 'sy' },
        { target: 'zoom' },
      ]),
    ).toBe(true);
  });
});

describe('identity values reduce to the legacy transform', () => {
  const samples: Array<[number, number]> = [
    [0, 0],
    [0.25, -0.125],
    [-0.5, 0.5],
    [0.4999, 0.0001],
    [-0.31, -0.47],
  ];

  test('cx/cy centred, sx/sy 1, zoomexp 1 changes nothing', () => {
    for (const [centeredX, centeredY] of samples) {
      for (const zoom of [0, 0.5, 1, 1.02, 8]) {
        for (const rot of [0, 0.1, -1.4]) {
          const shared = {
            centeredX,
            centeredY,
            zoom,
            rot,
            dx: 0.013,
            dy: -0.02,
          };
          const next = computeWarpSampleUv({
            ...shared,
            aspectX: ASPECT_X,
            aspectY: ASPECT_Y,
            cx: 0.5,
            cy: 0.5,
            sx: 1,
            sy: 1,
            zoomexp: 1,
            rad: computeWarpSampleRad(centeredX, centeredY, ASPECT_X, ASPECT_Y),
          });
          const legacy = computeLegacyWarpSampleUv(shared);
          // NOT bit-for-bit, and the difference is understood: the new chain
          // divides by zoom BEFORE rotating (butterchurn's order, forced by
          // sx/sy having to sit between them) where the legacy one rotated
          // first. About a zero centre those commute mathematically but not in
          // IEEE, so this costs one ULP — relative 2e-16, which at the
          // zoom = 0 blow-up is an absolute 1e-12. Presets outside the gate
          // never see even this: they keep the legacy node graph verbatim.
          expect(relativeError(next.x, legacy.x)).toBeLessThan(1e-15);
          expect(relativeError(next.y, legacy.y)).toBeLessThan(1e-15);
        }
      }
    }
  });

  test('zoom = 0 keeps the 0.0001 divisor floor, not a 0.02 clamp', () => {
    // 100-square is zoom=0, rot=0, warp=1, fDecay=1 and passes at 1.70%. A
    // previous attempt at this change was refuted for lower-clamping the
    // divisor to 0.02, which shrinks the degenerate blow-up 200x.
    const legacy = computeLegacyWarpSampleUv({
      centeredX: 0.25,
      centeredY: 0.25,
      zoom: 0,
      rot: 0,
      dx: 0,
      dy: 0,
    });
    expect(legacy.x).toBe(0.25 / 0.0001 + 0.5);
    expect(computeWarpZoomDivisor(0, 1, 0.4)).toBe(0);
  });
});

describe('300-beatdetect-bassmidtreb stays bit-for-bit identical', () => {
  // per_pixel_1=cx=x, over cx=0.5 cy=1.0 sx=1 sy=1 dx=0 dy=0.02 zoom=1.0
  // fZoomExponent=1, rot unset. cx/cy are the centre for sx/sy and rot ONLY,
  // so with sx=sy=1 and rot=0 they cancel in MilkDrop too: the write is
  // mathematically inert and this currently-passing reference must not move.
  test('per-fragment cx = x produces the legacy coordinate exactly', () => {
    for (const centeredX of [-0.5, -0.2, 0, 0.2, 0.5]) {
      for (const centeredY of [-0.5, -0.1, 0, 0.3, 0.5]) {
        // The program writes cx = x, i.e. the fragment's own MilkDrop x.
        const cxFromX = centeredX * 2 * 0.5 * ASPECT_X + 0.5;
        const next = computeWarpSampleUv({
          centeredX,
          centeredY,
          aspectX: ASPECT_X,
          aspectY: ASPECT_Y,
          cx: cxFromX,
          cy: 1.0,
          sx: 1,
          sy: 1,
          zoom: 1.0,
          zoomexp: 1,
          rot: 0,
          dx: 0,
          dy: 0.02,
          rad: computeWarpSampleRad(centeredX, centeredY, ASPECT_X, ASPECT_Y),
        });
        const legacy = computeLegacyWarpSampleUv({
          centeredX,
          centeredY,
          zoom: 1.0,
          rot: 0,
          dx: 0,
          dy: 0.02,
        });
        expect(next.x).toBe(legacy.x);
        expect(next.y).toBe(legacy.y);
      }
    }
  });
});

describe('agreement with the butterchurn oracle', () => {
  /**
   * Compares the parts of the chain the WebGPU node graph is faithful to:
   * the zoom exponent, the screen-centred zoom, the sx/sy scale about cx/cy
   * and the rotation about cx/cy. dx/dy are excluded because the node graph
   * deliberately keeps its own (measured, and known-divergent) sign and space
   * for them, and the rotation is compared at square aspect because the node
   * graph rotates in screen space where butterchurn rotates in aspect space.
   */
  const cases = [
    { cx: 0.5, cy: 0.5, sx: 1.4, sy: 1, zoom: 1.02, zoomExp: 1, rot: 0 },
    { cx: 0.3, cy: 0.7, sx: 0.8, sy: 1.6, zoom: 1.0, zoomExp: 1, rot: 0 },
    { cx: 0.5, cy: 0.5, sx: 1, sy: 1, zoom: 1.05, zoomExp: 1.7, rot: 0 },
    { cx: 0.42, cy: 0.61, sx: 1.1, sy: 0.9, zoom: 0.97, zoomExp: 1, rot: 0.35 },
  ];

  test('matches butterchurn at square aspect', () => {
    for (const params of cases) {
      for (const ndcX of [-0.8, -0.2, 0.3, 0.9]) {
        for (const ndcY of [-0.7, 0.1, 0.6]) {
          const oracle = butterchurnSampleUv({
            ndcX,
            ndcY,
            aspectx: 1,
            aspecty: 1,
            dx: 0,
            dy: 0,
            ...params,
          });
          // Screen uv: x right, y UP; butterchurn's v is measured downward.
          const centeredX = ndcX * 0.5;
          const centeredY = ndcY * 0.5;
          const next = computeWarpSampleUv({
            centeredX,
            centeredY,
            aspectX: 1,
            aspectY: 1,
            cx: params.cx,
            cy: params.cy,
            sx: params.sx,
            sy: params.sy,
            zoom: params.zoom,
            zoomexp: params.zoomExp,
            rot: params.rot,
            dx: 0,
            dy: 0,
            rad: computeWarpSampleRad(centeredX, centeredY, 1, 1),
          });
          expect(next.x).toBeCloseTo(oracle.u, 9);
          // v is y-down; the node graph's uv is y-up.
          expect(next.y).toBeCloseTo(1 - oracle.v, 9);
        }
      }
    }
  });

  test('rad uses the fixed screen centre and aspect to the FIRST power', () => {
    // The CPU mesh path (vm/geometry-builder.ts transformMeshPoint) instead
    // builds rad from (x - cx, y - cy) in already-aspect-scaled space, times
    // aspect again, times 2. butterchurn and projectM both disagree with it.
    const centeredX = 0.4;
    const centeredY = -0.3;
    const oracleRad = Math.sqrt(
      (centeredX * 2) ** 2 * ASPECT_X ** 2 +
        (centeredY * 2) ** 2 * ASPECT_Y ** 2,
    );
    expect(
      computeWarpSampleRad(centeredX, centeredY, ASPECT_X, ASPECT_Y),
    ).toBeCloseTo(oracleRad, 12);
  });
});

describe('degenerate inputs stay finite', () => {
  test('sx or sy of exactly zero does not produce a NaN coordinate', () => {
    // krash-rovastar-cerebral-demons-stars ships `sy = 1.2/newx`, and newx
    // reaches zero somewhere on the mesh every frame.
    const result = computeWarpSampleUv({
      centeredX: 0.2,
      centeredY: -0.4,
      aspectX: ASPECT_X,
      aspectY: ASPECT_Y,
      cx: 0.4,
      cy: 0.6,
      sx: 0,
      sy: 0,
      zoom: 1.1,
      zoomexp: 1,
      rot: 0.2,
      dx: 0,
      dy: 0,
      rad: 0.5,
    });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  test('an infinite sy collapses toward the centre instead of exploding', () => {
    const result = computeWarpSampleUv({
      centeredX: 0.2,
      centeredY: -0.4,
      aspectX: ASPECT_X,
      aspectY: ASPECT_Y,
      cx: 0.5,
      cy: 0.5,
      sx: 1,
      sy: Number.POSITIVE_INFINITY,
      zoom: 1,
      zoomexp: 1,
      rot: 0,
      dx: 0,
      dy: 0,
      rad: 0.5,
    });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(result.y).toBe(0.5);
  });

  test('an extreme zoom/zoomexp pair is bounded, not overflowed', () => {
    // orbasonic ships zoom=100 with zoomexp=100.
    const divisor = computeWarpZoomDivisor(100, 100, 1.0);
    expect(Number.isFinite(divisor)).toBe(true);
    expect(divisor).toBeLessThanOrEqual(10000);
    expect(divisor).toBeGreaterThanOrEqual(0.0001);
  });
});
