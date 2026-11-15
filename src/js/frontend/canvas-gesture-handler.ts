export type GestureKind = 'pinch' | 'twist' | 'pan' | 'brush' | null;

export interface PointerPoint {
  id: number;
  x: number;
  y: number;
}

export interface GestureState {
  kind: GestureKind;
  zoomDelta: number;
  rotDelta: number;
  dx: number;
  dy: number;
  velocityX: number;
  velocityY: number;
  angularVelocity: number;
}

export interface GestureBounds {
  zoom: [number, number];
  rot: [number, number];
  dx: [number, number];
  dy: [number, number];
}

const DEFAULT_BOUNDS: GestureBounds = {
  zoom: [0.8, 1.2],
  rot: [-0.2, 0.2],
  dx: [-0.5, 0.5],
  dy: [-0.5, 0.5],
};

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function createGestureState(): GestureState {
  return {
    kind: null,
    zoomDelta: 0,
    rotDelta: 0,
    dx: 0,
    dy: 0,
    velocityX: 0,
    velocityY: 0,
    angularVelocity: 0,
  };
}

export function distance(a: PointerPoint, b: PointerPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angle(a: PointerPoint, b: PointerPoint) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export interface TwoPointerGesture {
  kind: 'pinch' | 'twist';
  scale: number;
  rotation: number;
}

export function classifyTwoPointer(
  prev: { dist: number; ang: number } | null,
  curr: { dist: number; ang: number },
): TwoPointerGesture | null {
  if (!prev) return null;
  const scale = curr.dist / Math.max(1e-6, prev.dist);
  const rotation = curr.ang - prev.ang;
  if (Math.abs(rotation) > 0.05) return { kind: 'twist', scale, rotation };
  return { kind: 'pinch', scale, rotation };
}

export function applyPinch(
  state: GestureState,
  scale: number,
  bounds: GestureBounds = DEFAULT_BOUNDS,
) {
  const delta = (scale - 1) * 0.5;
  state.zoomDelta = clamp(
    state.zoomDelta + delta,
    bounds.zoom[0] - 1,
    bounds.zoom[1] - 1,
  );
  state.kind = 'pinch';
}

export function applyTwist(
  state: GestureState,
  rotation: number,
  bounds: GestureBounds = DEFAULT_BOUNDS,
) {
  const delta = rotation * 0.5;
  state.rotDelta = clamp(state.rotDelta + delta, bounds.rot[0], bounds.rot[1]);
  state.angularVelocity = state.rotDelta;
  state.kind = 'twist';
}

export function applyPan(
  state: GestureState,
  dx: number,
  dy: number,
  bounds: GestureBounds = DEFAULT_BOUNDS,
) {
  state.dx = clamp(state.dx + dx * 0.01, bounds.dx[0], bounds.dx[1]);
  state.dy = clamp(state.dy + dy * 0.01, bounds.dy[0], bounds.dy[1]);
  state.velocityX = dx * 0.01;
  state.velocityY = dy * 0.01;
  state.kind = 'pan';
}

export function stepInertia(state: GestureState, damping = 0.9) {
  state.velocityX *= damping;
  state.velocityY *= damping;
  state.angularVelocity *= damping;
  if (Math.abs(state.velocityX) < 1e-4) state.velocityX = 0;
  if (Math.abs(state.velocityY) < 1e-4) state.velocityY = 0;
  if (Math.abs(state.angularVelocity) < 1e-4) state.angularVelocity = 0;
}

export function resetGesture(state: GestureState) {
  state.kind = null;
  state.zoomDelta = 0;
  state.rotDelta = 0;
  state.dx = 0;
  state.dy = 0;
  state.velocityX = 0;
  state.velocityY = 0;
  state.angularVelocity = 0;
}

export type BrushCoupling = 'bass' | 'ripple' | 'freeze' | 'color';

export function brushEel(
  quadrant: 'tl' | 'tr' | 'bl' | 'br',
  coupling: BrushCoupling,
): string {
  const cond = quadrantCondition(quadrant);
  switch (coupling) {
    case 'bass':
      return `if(${cond}, zoom = zoom + 0.08 * bass_att)`;
    case 'ripple':
      return `if(${cond}, warp = warp + 0.3 * bass_att)`;
    case 'freeze':
      return `if(${cond}, decay = 1.0)`;
    case 'color':
      return `if(${cond}, wave_r = wave_r + 0.3 * sin(time))`;
  }
}

function quadrantCondition(q: 'tl' | 'tr' | 'bl' | 'br'): string {
  switch (q) {
    case 'tl':
      return 'above(0.5 - x, 0) * above(0.5 - y, 0)';
    case 'tr':
      return 'above(x - 0.5, 0) * above(0.5 - y, 0)';
    case 'bl':
      return 'above(0.5 - x, 0) * above(y - 0.5, 0)';
    case 'br':
      return 'above(x - 0.5, 0) * above(y - 0.5, 0)';
  }
}

export function toEelDelta(state: GestureState): string[] {
  const lines: string[] = [];
  if (state.zoomDelta !== 0)
    lines.push(`zoom = zoom + ${state.zoomDelta.toFixed(3)};`);
  if (state.rotDelta !== 0)
    lines.push(`rot = rot + ${state.rotDelta.toFixed(3)};`);
  if (state.dx !== 0) lines.push(`dx = dx + ${state.dx.toFixed(3)};`);
  if (state.dy !== 0) lines.push(`dy = dy + ${state.dy.toFixed(3)};`);
  return lines;
}
