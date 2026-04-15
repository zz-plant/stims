import { describe, expect, mock, test } from 'bun:test';
import {
  DoubleSide,
  Group,
  type LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { MilkdropBackendBehavior } from '../assets/js/milkdrop/renderer-adapter';
import {
  createBorderObject,
  renderBorderGroup,
} from '../assets/js/milkdrop/renderer-helpers/border-renderer';
import type { MilkdropBorderVisual } from '../assets/js/milkdrop/types';

function makeBorder(
  key: 'outer' | 'inner',
  size: number,
  overrides: Partial<MilkdropBorderVisual> = {},
): MilkdropBorderVisual {
  return {
    key,
    size,
    color: { r: 1, g: 0.5, b: 0.25, a: 0.8 },
    alpha: 0.8,
    styled: false,
    ...overrides,
  };
}

function makeHelpers() {
  return {
    ensureGeometryPositions: mock(),
    getBorderLinePositions: mock(),
    markAlwaysOnscreen: <T>(object: T) => object,
    setMaterialColor: mock(
      (
        material: MeshBasicMaterial | LineBasicMaterial,
        color: MilkdropBorderVisual['color'],
        alpha: number,
      ) => {
        material.color.setRGB(color.r, color.g, color.b);
        material.opacity = alpha;
      },
    ),
  };
}

function expectPositionsClose(actual: ArrayLike<number>, expected: number[]) {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index], 6);
  }
}

describe('milkdrop border renderer', () => {
  test('builds a single indexed band mesh with raw alpha and no outline child', () => {
    const helpers = makeHelpers();
    const border = makeBorder('outer', 0.2, { alpha: 0.75 });

    const group = createBorderObject(
      border,
      {} as MilkdropBackendBehavior,
      helpers,
      1,
    );

    expect(group).toBeInstanceOf(Group);
    expect(group.children).toHaveLength(1);

    const fill = group.children[0] as Mesh;
    expect(fill).toBeInstanceOf(Mesh);
    expect(fill.material).toBeInstanceOf(MeshBasicMaterial);
    expect((fill.material as MeshBasicMaterial).transparent).toBe(true);
    expect((fill.material as MeshBasicMaterial).opacity).toBeCloseTo(0.75, 6);
    expect((fill.material as MeshBasicMaterial).side).toBe(DoubleSide);

    const geometry = fill.geometry;
    expect(Array.from(geometry.getIndex()?.array ?? [])).toEqual([
      0, 1, 4, 1, 4, 5, 2, 3, 6, 3, 7, 6, 2, 0, 6, 0, 4, 6, 3, 7, 5, 1, 3, 5,
    ]);
    expectPositionsClose(
      Array.from(geometry.getAttribute('position').array as ArrayLike<number>),
      [
        1, 1, 0, 1, -1, 0, -1, 1, 0, -1, -1, 0, 0.8, 0.8, 0, 0.8, -0.8, 0, -0.8,
        0.8, 0, -0.8, -0.8, 0,
      ],
    );
    expect(helpers.setMaterialColor).toHaveBeenCalledTimes(1);
    expect(helpers.setMaterialColor.mock.calls[0]?.[2]).toBeCloseTo(0.75, 6);
  });

  test('renders outer and inner border bands without a stroke mesh', () => {
    const group = new Group();
    const borders = [
      makeBorder('outer', 0.2, { alpha: 0.9 }),
      makeBorder('inner', 0.1, { alpha: 0.7 }),
    ];

    renderBorderGroup({
      target: 'borders',
      group,
      borders,
      batcher: null,
      clearGroup: mock(),
      trimGroupChildren: mock(),
      disposeObject: mock(),
      syncBorderObject: mock(),
      alphaMultiplier: 1,
    });

    expect(group.children).toHaveLength(2);

    const outerFill = (group.children[0] as Group).children[0] as Mesh;
    const innerFill = (group.children[1] as Group).children[0] as Mesh;

    expect((outerFill.material as MeshBasicMaterial).opacity).toBeCloseTo(
      0.9,
      6,
    );
    expect((innerFill.material as MeshBasicMaterial).opacity).toBeCloseTo(
      0.7,
      6,
    );
    expect((group.children[0] as Group).children).toHaveLength(1);
    expect((group.children[1] as Group).children).toHaveLength(1);

    expectPositionsClose(
      Array.from(
        outerFill.geometry.getAttribute('position').array as ArrayLike<number>,
      ),
      [
        1, 1, 0, 1, -1, 0, -1, 1, 0, -1, -1, 0, 0.8, 0.8, 0, 0.8, -0.8, 0, -0.8,
        0.8, 0, -0.8, -0.8, 0,
      ],
    );
    expectPositionsClose(
      Array.from(
        innerFill.geometry.getAttribute('position').array as ArrayLike<number>,
      ),
      [
        0.8, 0.8, 0, 0.8, -0.8, 0, -0.8, 0.8, 0, -0.8, -0.8, 0, 0.7, 0.7, 0,
        0.7, -0.7, 0, -0.7, 0.7, 0, -0.7, -0.7, 0,
      ],
    );
  });
});
