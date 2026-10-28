/**
 * Browse's list view windows its rows, so the keyboard has to reach rows
 * that are not in the DOM yet: an arrow or End moves a roving index, the
 * virtualizer scrolls the row in, and focus lands on it once it renders.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { act, createElement } from 'react';
import { BrowseSheetPanel } from '../../src/js/frontend/BrowseSheetPanel.tsx';
import { getCollectionTags } from '../../src/js/frontend/workspace-helpers.ts';
import { makePresetEntry, renderWorkspace } from '../frontend-harness.tsx';

const PRESET_COUNT = 200;
const catalog = Array.from({ length: PRESET_COUNT }, (_, index) =>
  makePresetEntry({
    id: `preset-${String(index).padStart(3, '0')}`,
    title: `Preset ${index}`,
  }),
);

// The virtualizer mounts nothing in a viewport with no size.
// scrollHeight is reported large so a scroll toward the last row is not
// clamped to the top of a zero-height scroller.
const LAYOUT_KEYS = [
  'offsetWidth',
  'offsetHeight',
  'clientWidth',
  'clientHeight',
  'scrollHeight',
] as const;
const layoutValue = (key: (typeof LAYOUT_KEYS)[number]) =>
  key === 'scrollHeight' ? 1_000_000 : key.endsWith('Width') ? 800 : 600;
const savedLayout = new Map<string, PropertyDescriptor | undefined>();
let savedRect: typeof HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  savedRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON() {},
    }) as DOMRect;
  for (const key of LAYOUT_KEYS) {
    savedLayout.set(
      key,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
    );
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get: () => layoutValue(key),
    });
  }
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = savedRect;
  for (const key of LAYOUT_KEYS) {
    const descriptor = savedLayout.get(key);
    if (descriptor)
      Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
});
afterEach(() => {
  localStorage.removeItem('stims:browse-view');
});

function mountList() {
  localStorage.setItem('stims:browse-view', 'list');
  return renderWorkspace(
    createElement(BrowseSheetPanel, {
      onCollectionTagChange: () => {},
      onImport: () => {},
    }),
    {
      engine: {
        catalog,
        filteredCatalog: catalog,
        collectionTags: getCollectionTags(catalog),
      },
    },
  );
}

function rowLinks(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('.ctl-preset__open')];
}

function rowIndexOf(element: Element | null) {
  const row = element?.closest<HTMLElement>('[data-preset-index]');
  return row ? Number(row.dataset.presetIndex) : null;
}

async function press(target: Element, key: string) {
  const KeyboardEventCtor = window.KeyboardEvent ?? globalThis.KeyboardEvent;
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEventCtor('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
    // The virtualizer settles a scroll command over animation frames.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  // The DOM here moves scrollTop when the virtualizer scrolls but fires no
  // scroll event, which is what tells the virtualizer its window moved.
  await act(async () => {
    document
      .querySelector('.ctl-presets-scroll')
      ?.dispatchEvent(new window.Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('Browse list view', () => {
  test('mounts a window of rows but announces the whole result set', () => {
    const rendered = mountList();
    try {
      const rows = [
        ...rendered.container.querySelectorAll<HTMLElement>('li.ctl-preset'),
      ];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(PRESET_COUNT);
      expect(rows[0]?.getAttribute('aria-setsize')).toBe(String(PRESET_COUNT));
      // Exactly one row is in the tab order.
      const tabbable = rowLinks(rendered.container).filter(
        (link) => link.tabIndex === 0,
      );
      expect(tabbable.map((link) => rowIndexOf(link))).toEqual([0]);
    } finally {
      rendered.dispose();
    }
  });

  test('arrow keys move focus row by row, and End reaches an unrendered row', async () => {
    const rendered = mountList();
    try {
      const first = rowLinks(rendered.container)[0];
      if (!first) throw new Error('no first row');
      first.focus();

      await press(first, 'ArrowDown');
      expect(rowIndexOf(document.activeElement)).toBe(1);
      expect((document.activeElement as HTMLElement).tabIndex).toBe(0);

      const lastIndex = PRESET_COUNT - 1;
      expect(
        rendered.container.querySelector(`[data-preset-index="${lastIndex}"]`),
      ).toBeNull();
      if (!document.activeElement) throw new Error('focus lost');
      await press(document.activeElement, 'End');
      expect(rowIndexOf(document.activeElement)).toBe(lastIndex);

      await press(document.activeElement, 'Home');
      expect(rowIndexOf(document.activeElement)).toBe(0);
    } finally {
      rendered.dispose();
    }
  });
});
