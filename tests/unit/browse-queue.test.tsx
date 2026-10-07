/**
 * Browse can queue any preset, not only the one on stage: lining up presets
 * you have not played yet is what a queue is for, and the dock and palette
 * can only queue what is already playing.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { createElement } from 'react';
import { BrowseSheetPanel } from '../../src/js/frontend/BrowseSheetPanel.tsx';
import { getCollectionTags } from '../../src/js/frontend/workspace-helpers.ts';
import { makePresetEntry, renderWorkspace } from '../frontend-harness.tsx';

const catalog = ['glowsticks', 'snakeskin', 'tokamak'].map((id) =>
  makePresetEntry({ id, title: id }),
);
const engine = {
  catalog,
  filteredCatalog: catalog,
  collectionTags: getCollectionTags(catalog),
};

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

function mount() {
  const messages: string[] = [];
  const presetQueue = {
    presetIds: [] as string[],
    entries: [],
    add: (id: string) => {
      presetQueue.presetIds = [...presetQueue.presetIds, id];
    },
    remove: (id: string) => {
      presetQueue.presetIds = presetQueue.presetIds.filter((x) => x !== id);
    },
    clear: () => {},
    move: () => {},
    popNext: () => null,
  };
  const rendered = renderWorkspace(createElement(BrowseSheetPanel), {
    engine,
    ui: {
      presetQueue,
      setStatusMessage: (message) => {
        if (message) messages.push(message);
      },
    },
  });
  const press = (label: string) => {
    rendered.click(rendered.byLabel(label));
    rendered.rerender(createElement(BrowseSheetPanel));
  };
  return { rendered, presetQueue, messages, press };
}

describe.each([
  ['grid', null],
  ['list', 'list'],
])('queue from Browse (%s view)', (_view, storedView) => {
  test('queues a preset that is not playing, and takes it back out', () => {
    if (storedView) localStorage.setItem('stims:browse-view', storedView);
    const { rendered, presetQueue, messages, press } = mount();

    press('Queue snakeskin');
    expect(presetQueue.presetIds).toEqual(['snakeskin']);
    expect(messages.at(-1)).toContain('Queued “snakeskin”');
    const queued = rendered.byLabel('Remove snakeskin from the queue');
    expect(queued?.getAttribute('aria-pressed')).toBe('true');
    // Other presets are untouched.
    expect(
      rendered.byLabel('Queue tokamak')?.getAttribute('aria-pressed'),
    ).toBe('false');

    press('Remove snakeskin from the queue');
    expect(presetQueue.presetIds).toEqual([]);
    expect(messages.at(-1)).toContain('Removed “snakeskin”');
    expect(rendered.byLabel('Queue snakeskin')).not.toBeNull();

    rendered.dispose();
  });
});
