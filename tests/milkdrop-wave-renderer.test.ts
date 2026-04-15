import { describe, expect, mock, test } from 'bun:test';
import {
  Group,
  Line,
  type LineBasicMaterial,
  Points,
  type PointsMaterial,
} from 'three';
import type { MilkdropBackendBehavior } from '../assets/js/milkdrop/renderer-adapter';
import {
  createWaveObject,
  syncWaveObject,
} from '../assets/js/milkdrop/renderer-helpers/wave-renderer';
import type { MilkdropWaveVisual } from '../assets/js/milkdrop/types';

const PASS_OFFSET = 1 / 1024;

function makeWave(
  overrides: Partial<MilkdropWaveVisual> = {},
): MilkdropWaveVisual {
  return {
    positions: [0, 0, 0, 1, 1, 0],
    color: { r: 1, g: 0.6, b: 0.2, a: 0.8 },
    alpha: 0.8,
    thickness: 2,
    drawMode: 'line',
    additive: false,
    pointSize: 1,
    closed: false,
    ...overrides,
  };
}

function makeHelpers() {
  return {
    ensureGeometryPositions: mock(),
    getWaveLinePositions: mock((wave: MilkdropWaveVisual) => wave.positions),
    setMaterialColor: mock(
      (
        material: LineBasicMaterial | PointsMaterial,
        color: MilkdropWaveVisual['color'],
        alpha: number,
      ) => {
        material.color.setRGB(color.r, color.g, color.b);
        material.opacity = alpha;
      },
    ),
    disposeObject: mock(),
  };
}

function expectLayerPositions(group: Group) {
  expect(group.children).toHaveLength(4);
  expect(group.children[0]?.position.x).toBeCloseTo(0, 6);
  expect(group.children[0]?.position.y).toBeCloseTo(0, 6);
  expect(group.children[1]?.position.x).toBeCloseTo(PASS_OFFSET, 6);
  expect(group.children[1]?.position.y).toBeCloseTo(0, 6);
  expect(group.children[2]?.position.x).toBeCloseTo(PASS_OFFSET, 6);
  expect(group.children[2]?.position.y).toBeCloseTo(PASS_OFFSET, 6);
  expect(group.children[3]?.position.x).toBeCloseTo(0, 6);
  expect(group.children[3]?.position.y).toBeCloseTo(PASS_OFFSET, 6);
}

describe('milkdrop wave renderer', () => {
  test('renders thick line waves as four offset passes with depth writes disabled', () => {
    const helpers = makeHelpers();
    const behavior = {
      useLineLoopPrimitives: true,
    } as MilkdropBackendBehavior;

    const group = createWaveObject(
      makeWave({ thickness: 2 }),
      behavior,
      helpers,
    );

    expect(group).toBeInstanceOf(Group);
    expect(group).not.toBeNull();
    expectLayerPositions(group as Group);

    const firstLayer = (group as Group).children[0];
    expect(firstLayer).toBeInstanceOf(Line);
    expect((firstLayer?.material as LineBasicMaterial).depthWrite).toBe(false);
    expect(helpers.getWaveLinePositions).toHaveBeenCalledTimes(4);
  });

  test('renders dotted waves as four offset point passes', () => {
    const helpers = makeHelpers();
    const behavior = {
      useLineLoopPrimitives: true,
    } as MilkdropBackendBehavior;

    const group = createWaveObject(
      makeWave({ drawMode: 'dots', thickness: 1 }),
      behavior,
      helpers,
    );

    expect(group).toBeInstanceOf(Group);
    expect(group).not.toBeNull();
    expectLayerPositions(group as Group);

    const firstLayer = (group as Group).children[0];
    expect(firstLayer).toBeInstanceOf(Points);
    expect((firstLayer?.material as PointsMaterial).depthWrite).toBe(false);
    expect((firstLayer?.material as PointsMaterial).size).toBe(1);
  });

  test('keeps existing thick wave groups stable across sync updates', () => {
    const helpers = makeHelpers();
    const behavior = {
      useLineLoopPrimitives: true,
    } as MilkdropBackendBehavior;
    const existing = createWaveObject(
      makeWave({ thickness: 2 }),
      behavior,
      helpers,
    );

    const synced = syncWaveObject(
      existing ?? undefined,
      makeWave({ thickness: 4, alpha: 0.5 }),
      behavior,
      helpers,
      1,
    );

    expect(synced).toBe(existing);
    expectLayerPositions(synced as Group);
    expect(
      (synced?.children[0]?.material as LineBasicMaterial).opacity,
    ).toBeCloseTo(0.5, 6);
  });
});
