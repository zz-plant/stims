import { describe, expect, test } from 'bun:test';
import { applyMotionDampening } from '../../src/js/milkdrop/runtime/motion-dampener.ts';
import type { MilkdropFrameState } from '../../src/js/milkdrop/types.ts';

/**
 * Only the seams the dampener touches, at values well away from identity so
 * every assertion has room to move. `variables` is a Proxy with no set trap,
 * as the VM's is — a write to it must not be what the dampener relies on.
 */
function buildFrameState(): MilkdropFrameState {
  const variables = new Proxy(
    {
      zoom: 1.5,
      rot: 0.4,
      dx: 0.2,
      dy: -0.1,
      warp: 0.8,
      sx: 1.2,
      cx: 0.3,
      q1: 7,
    },
    { set: () => true },
  );
  // A 2x2 lattice whose every vertex has been pushed away from its source.
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const positions = new Float32Array([
    -0.5, -0.5, 0.5, -0.9, -0.9, 0.5, 0.2, 0.2,
  ]);
  return {
    warpField: { density: 2, positions, uvs, indices: new Uint32Array(6) },
    post: {
      warp: 0.6,
      shaderControls: {
        zoom: 1.4,
        rotation: 0.5,
        offsetX: 0.25,
        offsetY: -0.25,
        warpScale: 1,
      },
    },
    variables,
    gpuGeometry: {
      mainWave: null,
      trailWaves: [],
      customWaves: [],
      meshField: {
        density: 12,
        zoom: 1.5,
        zoomExponent: 1.3,
        rotation: 0.4,
        warp: 0.8,
        warpAnimSpeed: 1,
        centerX: 0.5,
        centerY: 0.5,
        scaleX: 1.2,
        scaleY: 0.8,
        translateX: 0.2,
        translateY: -0.1,
      },
      motionVectorField: {
        zoom: 1.5,
        zoomExponent: 1,
        rotation: 0.4,
        warp: 0,
        warpAnimSpeed: 1,
        centerX: 0.5,
        centerY: 0.5,
        scaleX: 1,
        scaleY: 1,
        translateX: 0.2,
        translateY: 0,
      },
    },
  } as unknown as MilkdropFrameState;
}

describe('applyMotionDampening', () => {
  test('a scale of 1 returns the frame untouched', () => {
    const frameState = buildFrameState();
    const before = JSON.stringify(frameState.gpuGeometry.meshField);
    const result = applyMotionDampening(frameState, 1);
    expect(result).toBe(frameState);
    expect(JSON.stringify(frameState.gpuGeometry.meshField)).toBe(before);
    expect(frameState.variables.zoom).toBe(1.5);
    expect(frameState.warpField?.positions[0]).toBe(-0.5);
  });

  test('a scale of 0 rests every transform at identity', () => {
    const frameState = applyMotionDampening(buildFrameState(), 0);
    const mesh = frameState.gpuGeometry.meshField;
    expect(mesh).toMatchObject({
      zoom: 1,
      zoomExponent: 1,
      rotation: 0,
      warp: 0,
      scaleX: 1,
      scaleY: 1,
      translateX: 0,
      translateY: 0,
    });
    expect(frameState.gpuGeometry.motionVectorField).toMatchObject({
      zoom: 1,
      rotation: 0,
      translateX: 0,
    });
    expect(frameState.post.warp).toBe(0);
    expect(frameState.post.shaderControls).toMatchObject({
      zoom: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      warpScale: 0,
    });
    // Every warp-field vertex now samples itself: position == lattice.
    const { positions, uvs } = frameState.warpField ?? {
      positions: new Float32Array(),
      uvs: new Float32Array(),
    };
    for (let index = 0; index < positions.length; index += 1) {
      expect(positions[index]).toBeCloseTo((uvs[index] ?? 0) * 2 - 1, 6);
    }
  });

  test('a partial scale moves each value proportionally toward identity', () => {
    const frameState = applyMotionDampening(buildFrameState(), 0.5);
    const mesh = frameState.gpuGeometry.meshField;
    expect(mesh?.zoom).toBeCloseTo(1.25, 6);
    expect(mesh?.rotation).toBeCloseTo(0.2, 6);
    expect(mesh?.scaleY).toBeCloseTo(0.9, 6);
    expect(mesh?.translateX).toBeCloseTo(0.1, 6);
    expect(frameState.post.shaderControls.zoom).toBeCloseTo(1.2, 6);
    expect(frameState.post.shaderControls.offsetY).toBeCloseTo(-0.125, 6);
    // Vertex 0: lattice -1, pushed to -0.5, halfway back is -0.75.
    expect(frameState.warpField?.positions[0]).toBeCloseTo(-0.75, 6);
  });

  test('overlays the read-only variable proxy instead of writing to it', () => {
    const frameState = applyMotionDampening(buildFrameState(), 0);
    expect(frameState.variables.zoom).toBe(1);
    expect(frameState.variables.rot).toBe(0);
    expect(frameState.variables.dx).toBe(0);
    expect(frameState.variables.sx).toBe(1);
    // Not motion: centres and registers pass through.
    expect(frameState.variables.cx).toBe(0.3);
    expect(frameState.variables.q1).toBe(7);
  });

  test('leaves centres alone — they position the transform, they are not it', () => {
    const frameState = applyMotionDampening(buildFrameState(), 0);
    expect(frameState.gpuGeometry.meshField?.centerX).toBe(0.5);
    expect(frameState.gpuGeometry.meshField?.centerY).toBe(0.5);
  });

  test('clamps out-of-range and non-finite scales', () => {
    expect(
      applyMotionDampening(buildFrameState(), -3).gpuGeometry.meshField?.zoom,
    ).toBe(1);
    expect(
      applyMotionDampening(buildFrameState(), 7).gpuGeometry.meshField?.zoom,
    ).toBe(1.5);
    expect(
      applyMotionDampening(buildFrameState(), Number.NaN).gpuGeometry.meshField
        ?.zoom,
    ).toBe(1.5);
  });
});
