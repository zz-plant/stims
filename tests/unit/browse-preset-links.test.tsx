/**
 * Browse lists presets as links to their pages, so a crawler on a hub page
 * (/author/geiss, /discover/fractal, which open Browse) can follow them and a
 * visitor can open one in a new tab. A plain click still switches presets in
 * place; a modified click is left to the browser.
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
import {
  makePresetEntry,
  makeUiValue,
  mouseClick,
  renderWorkspace,
} from '../frontend-harness.tsx';

const catalog = ['glowsticks', 'snakeskin', 'tokamak'].map((id) =>
  makePresetEntry({ id, title: id }),
);

// Both views are virtualized and mount nothing in a viewport with no size.
const LAYOUT_KEYS = [
  'offsetWidth',
  'offsetHeight',
  'clientWidth',
  'clientHeight',
] as const;
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
      get: () => (key.endsWith('Width') ? 800 : 600),
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

/** Mounts Browse and records every preset it opens, by either path. */
function mount(
  sessionHistory: Array<{ presetId: string; title: string; at: number }> = [],
) {
  const opened: string[] = [];
  const routeState = makeUiValue().routeState;
  const rendered = renderWorkspace(
    createElement(BrowseSheetPanel, {
      onCollectionTagChange: () => {},
      onImport: () => {},
      sessionHistory,
    }),
    {
      engine: {
        catalog,
        filteredCatalog: catalog,
        collectionTags: getCollectionTags(catalog),
        handlePresetSelection: (id: string) => {
          opened.push(id);
        },
      },
      ui: {
        commitRoute: (next) => {
          const state = typeof next === 'function' ? next(routeState) : next;
          if (state.presetId) opened.push(state.presetId);
        },
      },
    },
  );
  return { rendered, opened };
}

function dispatch(target: Element, event: Event) {
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe.each([
  ['grid', null, '.stims-preset-grid__item'],
  ['list', 'list', '.ctl-preset__open'],
])('Browse %s view', (_view, storedView, itemSelector) => {
  test('each preset is a link to its page', () => {
    if (storedView) localStorage.setItem('stims:browse-view', storedView);
    const { rendered } = mount();
    try {
      const items = [
        ...rendered.container.querySelectorAll<HTMLElement>(itemSelector),
      ];
      expect(items.length).toBe(catalog.length);
      expect(items.map((item) => item.tagName.toLowerCase())).toEqual(
        catalog.map(() => 'a'),
      );
      expect(items.map((item) => item.getAttribute('href'))).toEqual(
        catalog.map((entry) => `/?preset=${entry.id}`),
      );
    } finally {
      rendered.dispose();
    }
  });

  test('a plain click opens in place; a new-tab click is left to the browser', () => {
    if (storedView) localStorage.setItem('stims:browse-view', storedView);
    const { rendered, opened } = mount();
    try {
      const link = rendered.container.querySelector(
        `${itemSelector}[href="/?preset=snakeskin"]`,
      );
      if (!link) throw new Error('no snakeskin link');

      for (const modifier of [
        { metaKey: true },
        { ctrlKey: true },
        { shiftKey: true },
      ]) {
        const event = dispatch(link, mouseClick(modifier));
        expect(event.defaultPrevented).toBe(false);
      }
      expect(opened).toEqual([]);

      const plain = dispatch(link, mouseClick());
      expect(plain.defaultPrevented).toBe(true);
      expect(opened).toEqual(['snakeskin']);
    } finally {
      rendered.dispose();
    }
  });
});

test('the recently-played rail links its presets the same way', () => {
  const { rendered, opened } = mount([
    { presetId: 'snakeskin', title: 'snakeskin', at: 2 },
    { presetId: 'tokamak', title: 'tokamak', at: 1 },
  ]);
  try {
    const items = [
      ...rendered.container.querySelectorAll('.ctl-recent-rail__item'),
    ];
    expect(items.map((item) => item.getAttribute('href'))).toEqual([
      '/?preset=snakeskin',
      '/?preset=tokamak',
    ]);
    const [first] = items;
    if (!first) throw new Error('no rail item');
    expect(
      dispatch(first, mouseClick({ metaKey: true })).defaultPrevented,
    ).toBe(false);
    expect(dispatch(first, mouseClick()).defaultPrevented).toBe(true);
    expect(opened).toEqual(['snakeskin']);
  } finally {
    rendered.dispose();
  }
});
