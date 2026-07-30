/**
 * SVG Vector Geometry Engine
 * Parametric polar coordinate algorithms, crystallographic symmetry groups, and path generators.
 */

export interface Point2D {
  x: number;
  y: number;
}

export type SymmetryGroup = 'cyclic' | 'dihedral' | 'rose' | 'trochoid';

export interface GeometryPathOptions {
  size: number;
  seedHash: number;
  symmetry?: SymmetryGroup;
  sides?: number;
  rotationDeg?: number;
  radialModulation?: number;
}

/**
 * Generates an N-gon or Star polygon path.
 */
export function generatePolygonPath(
  center: Point2D,
  radius: number,
  sides: number,
  rotationDeg = 0,
): Point2D[] {
  const points: Point2D[] = [];
  const rotRad = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI) / sides + rotRad;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Generates a mathematical Rose Curve path r = a * cos(k * theta).
 */
export function generateRoseCurvePath(
  center: Point2D,
  maxRadius: number,
  k = 4,
  samples = 120,
  rotationDeg = 0,
): Point2D[] {
  const points: Point2D[] = [];
  const rotRad = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < samples; i++) {
    const theta = (i * 2 * Math.PI * (k % 2 === 0 ? 1 : 0.5)) / samples;
    const r = maxRadius * Math.cos(k * theta);
    const angle = theta + rotRad;
    points.push({
      x: center.x + r * Math.cos(angle),
      y: center.y + r * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Generates an Epitrochoid / Hypotrochoid curve path.
 */
export function generateTrochoidPath(
  center: Point2D,
  maxRadius: number,
  R = 5,
  r = 3,
  d = 5,
  samples = 150,
): Point2D[] {
  const points: Point2D[] = [];
  const scale = maxRadius / (R + d);
  for (let i = 0; i < samples; i++) {
    const t = (i * 4 * Math.PI) / samples;
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) * t) / r);
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) * t) / r);
    points.push({
      x: center.x + x * scale,
      y: center.y + y * scale,
    });
  }
  return points;
}

/**
 * Formats a point array into a SVG path `d` attribute string.
 */
export function pointsToSvgPathD(points: Point2D[], closed = true): string {
  if (points.length === 0) return '';
  const first = points[0];
  let d = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    d += ` L ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  if (closed) {
    d += ' Z';
  }
  return d;
}
