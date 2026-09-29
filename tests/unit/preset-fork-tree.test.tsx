import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import { PresetLineageSection } from '../../src/js/frontend/PresetLineageSection.tsx';
import {
  buildForkTree,
  buildPresetFamilies,
  type ForkTreeNode,
} from '../../src/js/milkdrop/preset-lineage.ts';

/**
 * A family as a tree. Remixes made in Stims record their parent and nest
 * under it; published variants only have their title, so they hang under
 * the original, marked as such rather than guessed into a chain.
 */
const CATALOG: PresetCatalogEntry[] = [
  { id: 'root', title: 'Aderrasi - Airhandler' },
  { id: 'kali', title: 'Aderrasi + Kali - Airhandler (Kali Mix)' },
  { id: 'geiss', title: 'Aderrasi + Geiss - Airhandler (Geiss Echoes Remix)' },
  // What Remix titles a remix of a mix, and a remix of that remix.
  {
    id: 'mine',
    title: 'Aderrasi + Kali - Airhandler (Kali Mix) [remix]',
    derivedFrom: [{ id: 'kali', title: 'Airhandler (Kali Mix)' }],
  },
  {
    id: 'mine-2',
    title: 'Aderrasi + Kali - Airhandler (Kali Mix) [remix 2]',
    derivedFrom: [{ id: 'mine', title: 'Airhandler (Kali Mix) [remix]' }],
  },
];

const family = () => {
  const found = buildPresetFamilies(CATALOG).get('airhandler');
  if (!found) throw new Error('expected the airhandler family');
  return found;
};

/** `id(link)[children]`, depth-first — the tree's shape in one string. */
const shape = (nodes: ForkTreeNode[]): string =>
  nodes
    .map(
      (node) =>
        `${node.member.id}(${node.link})${
          node.children.length > 0 ? `[${shape(node.children)}]` : ''
        }`,
    )
    .join(' ');

describe('buildForkTree', () => {
  test('recorded remixes nest; published variants hang under the original', () => {
    expect(shape(buildForkTree(family(), CATALOG))).toBe(
      'root(root)[geiss(title) kali(title)[mine(recorded)[mine-2(recorded)]]]',
    );
  });

  test('without recorded links every variant sits one level under the original', () => {
    const plain = CATALOG.map(({ derivedFrom: _drop, ...entry }) => entry);
    expect(shape(buildForkTree(family(), plain))).toBe(
      'root(root)[geiss(title) kali(title) mine-2(title) mine(title)]',
    );
  });

  test('a recorded link outside the family is ignored', () => {
    const entries = CATALOG.map((entry) =>
      entry.id === 'mine'
        ? { ...entry, derivedFrom: [{ id: 'somewhere-else', title: 'x' }] }
        : entry,
    );
    expect(shape(buildForkTree(family(), entries))).toBe(
      'root(root)[geiss(title) kali(title) mine(title)[mine-2(recorded)]]',
    );
  });

  test('a hand-edited cycle does not hang, and every member still appears once', () => {
    const entries = CATALOG.map((entry) =>
      entry.id === 'mine'
        ? { ...entry, derivedFrom: [{ id: 'mine-2', title: 'x' }] }
        : entry,
    );
    const tree = shape(buildForkTree(family(), entries));
    for (const id of ['root', 'kali', 'geiss', 'mine', 'mine-2']) {
      expect(tree.match(new RegExp(`(^|[ [])${id}\\(`, 'gu'))).toHaveLength(1);
    }
  });
});

describe('PresetLineageSection', () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  test('renders the remix chain nested, and links a click to the preset', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onSelect = mock((_id: string) => {});
    root = createRoot(host);
    act(() => {
      root?.render(
        <PresetLineageSection
          catalog={CATALOG}
          currentPresetId="mine"
          onSelect={onSelect}
        />,
      );
    });
    const item = (id: string) =>
      Array.from(host.querySelectorAll<HTMLElement>('.ctl-lineage__item')).find(
        (li) =>
          li
            .querySelector('button')
            ?.textContent?.includes(
              id === 'mine-2' ? '[remix 2]' : '[remix]',
            ) && li.dataset.link === 'recorded',
      );
    const mine = Array.from(
      host.querySelectorAll<HTMLElement>(
        '.ctl-lineage__item[data-current="true"]',
      ),
    )[0];
    expect(mine?.dataset.link).toBe('recorded');
    // The remix of the remix is inside this preset's own branch.
    const nested = mine?.querySelector<HTMLElement>(
      '.ctl-lineage__children .ctl-lineage__item',
    );
    expect(nested?.textContent).toContain('[remix 2]');
    expect(item('mine-2')).toBeDefined();

    nested?.querySelector('button')?.click();
    expect(onSelect).toHaveBeenCalledWith('mine-2');
    expect(host.textContent).toContain('a remix made here is linked');
  });
});
