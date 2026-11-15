/**
 * Continuous aesthetic compass blending (#1682) — bounded core.
 *
 * The compass projects every previewed preset to a normalized 2D plane. This
 * module turns a puck position into the three nearest presets and barycentric
 * weights, so a host can crossfade/morph between them instead of snapping to
 * one. Pure geometry; no DOM, no engine, no recompilation.
 */

import type { CompassPoint } from './aesthetic-compass.ts';

export interface BlendNeighbor {
  presetId: string;
  x: number;
  y: number;
  distance: number;
  /** Barycentric weight in [0, 1]; sums to 1 across the returned set. */
  weight: number;
}

export function distanceSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** The k nearest points to (x, y), nearest first. */
export function nearestPoints(
  points: readonly CompassPoint[],
  x: number,
  y: number,
  k = 3,
): CompassPoint[] {
  if (points.length === 0 || k <= 0) return [];
  return [...points]
    .sort(
      (a, b) =>
        distanceSquared(a.x, a.y, x, y) - distanceSquared(b.x, b.y, x, y),
    )
    .slice(0, Math.min(k, points.length));
}

/**
 * Barycentric weights of (x, y) in the triangle a-b-c. Returns null when the
 * triangle is degenerate (all three points collinear).
 */
export function barycentricWeights(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  x: number,
  y: number,
): [number, number, number] | null {
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-9) return null;
  const wa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
  const wb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
  const wc = 1 - wa - wb;
  return [wa, wb, wc];
}

/**
 * The three nearest presets with barycentric weights. Falls back to
 * inverse-distance weights when the triangle is degenerate. Weights are
 * clamped to [0, 1] and renormalized.
 */
export function nearestThree(
  points: readonly CompassPoint[],
  x: number,
  y: number,
): BlendNeighbor[] {
  const nearest = nearestPoints(points, x, y, 3);
  if (nearest.length === 0) return [];
  if (nearest.length === 1) {
    return [
      {
        ...nearest[0],
        distance: Math.sqrt(distanceSquared(nearest[0].x, nearest[0].y, x, y)),
        weight: 1,
      },
    ];
  }
  const [a, b, c] = nearest;
  let weights: [number, number, number] | null = c
    ? barycentricWeights(a, b, c, x, y)
    : null;
  if (!weights) {
    // Inverse-distance fallback.
    const dists = nearest.map((p) =>
      Math.sqrt(distanceSquared(p.x, p.y, x, y)),
    );
    const inv = dists.map((d) => (d < 1e-9 ? 1e9 : 1 / d));
    const sum = inv.reduce((s, v) => s + v, 0);
    weights = [inv[0] / sum, inv[1] / sum, inv[2] ?? 0] as [
      number,
      number,
      number,
    ];
  }
  const clamped = weights.map((w) => Math.max(0, Math.min(1, w)));
  const sum = clamped.reduce((s, v) => s + v, 0) || 1;
  return nearest.map((p, i) => ({
    presetId: p.presetId,
    x: p.x,
    y: p.y,
    distance: Math.sqrt(distanceSquared(p.x, p.y, x, y)),
    weight: clamped[i] / sum,
  }));
}
