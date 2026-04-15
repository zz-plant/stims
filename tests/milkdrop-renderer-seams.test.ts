import { describe, expect, test } from 'bun:test';
import { BufferGeometry, Group, LineLoop } from 'three';
import { WEBGL_MILKDROP_BACKEND_BEHAVIOR } from '../assets/js/milkdrop/backend-behavior.ts';
import {
  MAX_MILKDROP_POLYGON_SIDES,
  normalizeMilkdropPolygonSides,
} from '../assets/js/milkdrop/renderer-adapter-shared.ts';
import {
  createShapeObject,
  renderShapeGroup,
} from '../assets/js/milkdrop/renderer-helpers/shape-renderer';
import type { MilkdropShapeVisual } from '../assets/js/milkdrop/renderer-types';

function makeShape(
  overrides: Partial<MilkdropShapeVisual> = {},
): MilkdropShapeVisual {
  return {
    key: 'shape',
    x: 0.2,
    y: -0.1,
    radius: 0.3,
    sides: 6,
    rotation: 0.4,
    textured: false,
    textureZoom: 1,
    textureAngle: 0,
    color: { r: 1, g: 0.2, b: 0.1, a: 0.7 },
    borderColor: { r: 0.1, g: 0.2, b: 1, a: 0.9 },
    additive: false,
    thickOutline: true,
    ...overrides,
  };
}

function makeShapeHelpers() {
  return {
    getShapeFillFallbackColor: (shape: MilkdropShapeVisual) => shape.color,
    getShapeTexture: () => null,
    getUnitPolygonFillGeometry: () => new BufferGeometry(),
    getUnitPolygonOutlineGeometry: () => new BufferGeometry(),
    getUnitPolygonClosedLineGeometry: () => new BufferGeometry(),
  };
}

describe('milkdrop renderer seams', () => {
  test('bounds polygon geometry side counts to the shared cache ceiling', () => {
    expect(normalizeMilkdropPolygonSides(2)).toBe(3);
    expect(normalizeMilkdropPolygonSides(6.4)).toBe(6);
    expect(normalizeMilkdropPolygonSides(10_000)).toBe(
      MAX_MILKDROP_POLYGON_SIDES,
    );
  });

  test('keeps renderer groups synchronized with the latest shape count', () => {
    const group = new Group();
    const disposed: unknown[] = [];
    const createNode = (key: string) => {
      const node = new Group();
      node.name = key;
      return node;
    };

    renderShapeGroup({
      target: 'shapes',
      group,
      shapes: [{ key: 'shape-a' }, { key: 'shape-b' }] as never,
      batcher: null,
      clearGroup: () => {
        throw new Error('batcher path should not run');
      },
      trimGroupChildren: (targetGroup, keepCount) => {
        while (targetGroup.children.length > keepCount) {
          const child = targetGroup.children[targetGroup.children.length - 1];
          disposed.push(child);
          targetGroup.remove(child);
        }
      },
      syncShapeObject: (existing, shape) => existing ?? createNode(shape.key),
    });

    expect(group.children).toHaveLength(2);

    renderShapeGroup({
      target: 'shapes',
      group,
      shapes: [{ key: 'shape-a' }] as never,
      batcher: null,
      clearGroup: () => {
        throw new Error('batcher path should not run');
      },
      trimGroupChildren: (targetGroup, keepCount) => {
        while (targetGroup.children.length > keepCount) {
          const child = targetGroup.children[targetGroup.children.length - 1];
          disposed.push(child);
          targetGroup.remove(child);
        }
      },
      syncShapeObject: (existing, shape) => existing ?? createNode(shape.key),
    });

    expect(group.children).toHaveLength(1);
    expect(disposed).toHaveLength(1);
  });

  test('renders thick custom-shape outlines as four offset line passes', () => {
    const group = createShapeObject(
      makeShape(),
      WEBGL_MILKDROP_BACKEND_BEHAVIOR,
      makeShapeHelpers(),
    );

    const outlineGroup = group.children[1] as Group | undefined;
    const outlineChildren = outlineGroup?.children ?? [];

    expect(group.children).toHaveLength(2);
    expect(outlineChildren).toHaveLength(4);
    expect(outlineChildren.every((child) => child instanceof LineLoop)).toBe(
      true,
    );
    expect(outlineChildren[0]?.position.x).toBeCloseTo(0.2, 6);
    expect(outlineChildren[0]?.position.y).toBeCloseTo(-0.1, 6);
    expect(outlineChildren[1]?.position.x).toBeCloseTo(0.2 + 1 / 1024, 6);
    expect(outlineChildren[1]?.position.y).toBeCloseTo(-0.1, 6);
    expect(outlineChildren[2]?.position.x).toBeCloseTo(0.2 + 1 / 1024, 6);
    expect(outlineChildren[2]?.position.y).toBeCloseTo(-0.1 + 1 / 1024, 6);
    expect(outlineChildren[3]?.position.x).toBeCloseTo(0.2, 6);
    expect(outlineChildren[3]?.position.y).toBeCloseTo(-0.1 + 1 / 1024, 6);
  });
});
