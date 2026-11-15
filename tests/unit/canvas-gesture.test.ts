import { describe, expect, test } from 'bun:test';
import {
  applyPan,
  applyPinch,
  applyTwist,
  brushEel,
  classifyTwoPointer,
  createGestureState,
  distance,
  resetGesture,
  stepInertia,
  toEelDelta,
} from '../../src/js/frontend/canvas-gesture-handler.ts';

describe('canvas gesture handler', () => {
  test('distance', () => {
    expect(distance({ id: 1, x: 0, y: 0 }, { id: 2, x: 3, y: 4 })).toBe(5);
  });

  test('pinch accumulates zoom delta', () => {
    const s = createGestureState();
    applyPinch(s, 1.2);
    expect(s.zoomDelta).toBeGreaterThan(0);
    expect(s.kind).toBe('pinch');
  });

  test('twist accumulates rot delta', () => {
    const s = createGestureState();
    applyTwist(s, 0.5);
    expect(s.rotDelta).toBeGreaterThan(0);
    expect(s.kind).toBe('twist');
  });

  test('pan accumulates dx/dy', () => {
    const s = createGestureState();
    applyPan(s, 10, 20);
    expect(s.dx).not.toBe(0);
    expect(s.dy).not.toBe(0);
    expect(s.kind).toBe('pan');
  });

  test('inertia decays', () => {
    const s = createGestureState();
    applyPan(s, 100, 100);
    const before = s.velocityX;
    stepInertia(s);
    expect(Math.abs(s.velocityX)).toBeLessThanOrEqual(Math.abs(before));
  });

  test('reset clears', () => {
    const s = createGestureState();
    applyPan(s, 10, 20);
    resetGesture(s);
    expect(s.dx).toBe(0);
    expect(s.dy).toBe(0);
    expect(s.kind).toBeNull();
  });

  test('classifyTwoPointer twist when rotation large', () => {
    const g = classifyTwoPointer({ dist: 10, ang: 0 }, { dist: 10, ang: 0.5 });
    expect(g?.kind).toBe('twist');
  });

  test('classifyTwoPointer pinch when rotation small', () => {
    const g = classifyTwoPointer({ dist: 10, ang: 0 }, { dist: 12, ang: 0.01 });
    expect(g?.kind).toBe('pinch');
  });

  test('brushEel generates quadrant-scoped EEL', () => {
    const e = brushEel('tl', 'bass');
    expect(e).toContain('if(');
    expect(e).toContain('bass_att');
  });

  test('toEelDelta produces lines', () => {
    const s = createGestureState();
    applyPinch(s, 1.2);
    const lines = toEelDelta(s);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('zoom');
  });
});
