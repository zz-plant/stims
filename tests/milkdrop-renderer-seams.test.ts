import { describe, expect, test } from 'bun:test';
import { Group } from 'three';
import { renderShapeGroup } from '../assets/js/milkdrop/renderer-helpers/shape-renderer';

describe('milkdrop renderer seams', () => {
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
});
