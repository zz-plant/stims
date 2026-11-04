/**
 * Picking a card in Browse with a pointer plays it and leaves the panel open,
 * so comparing presets does not mean reopening Browse. The panel folds by
 * itself once the visitor stops, so a single pick costs no extra tap to close.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from 'bun:test';
import { act, createElement } from 'react';
import { BrowseSheetPanel } from '../../src/js/frontend/BrowseSheetPanel.tsx';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import type { WorkspaceContextValue } from '../../src/js/frontend/workspace-context.tsx';
import { getCollectionTags } from '../../src/js/frontend/workspace-helpers.ts';
import { makePresetEntry, renderWorkspace } from '../frontend-harness.tsx';

type SessionRouteState = WorkspaceContextValue['routeState'];

const FOLD_MS = 5000;
const catalog = Array.from({ length: 6 }, (_, index) =>
  makePresetEntry({ id: `preset-${index}`, title: `Preset ${index}` }),
);

// The virtualizer mounts nothing in a viewport with no size.
const LAYOUT_KEYS = [
  'offsetWidth',
  'offsetHeight',
  'clientWidth',
  'clientHeight',
];
const savedLayout = new Map<string, PropertyDescriptor | undefined>();
let savedRect: typeof HTMLElement.prototype.getBoundingClientRect;
const savedMatchMedia = window.matchMedia;

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
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, key, descriptor);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
  }
});

afterEach(() => {
  jest.useRealTimers();
  localStorage.removeItem('stims:browse-view');
  window.matchMedia = savedMatchMedia;
});

function matchMediaWith(matching: (query: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matching(query),
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

function mount({
  audioActive = true,
  activePresetId = 'preset-0',
}: {
  audioActive?: boolean;
  activePresetId?: string;
} = {}) {
  localStorage.setItem('stims:browse-view', 'list');
  const panels: Array<string | null> = [];
  const routes: Array<Partial<SessionRouteState>> = [];
  const selections: string[] = [];
  const started: Array<string | undefined> = [];
  const rendered = renderWorkspace(
    createElement(BrowseSheetPanel, {
      onCollectionTagChange: () => {},
      onImport: () => {},
    }),
    {
      engine: {
        audioActive,
        catalog,
        filteredCatalog: catalog,
        collectionTags: getCollectionTags(catalog),
        catalogReady: true,
        handlePresetSelection: (id: string) => {
          selections.push(id);
        },
        handleAudioStart: (async (
          _source: unknown,
          _device: unknown,
          id?: string,
        ) => {
          started.push(id);
        }) as never,
      },
      ui: {
        updatePanel: (panel) => {
          panels.push(panel);
        },
        commitRoute: ((next: unknown) => {
          const value =
            typeof next === 'function'
              ? (next as (s: SessionRouteState) => SessionRouteState)(
                  {} as SessionRouteState,
                )
              : next;
          routes.push(value as Partial<SessionRouteState>);
        }) as never,
      },
      snapshot: { ...createEmptyEngineSnapshot(), activePresetId },
    },
  );
  const row = (id: string) =>
    [
      ...rendered.container.querySelectorAll<HTMLElement>('.ctl-preset__open'),
    ].find((element) =>
      element.textContent?.includes(id.replace('preset-', 'Preset ')),
    ) as HTMLElement;
  const click = (id: string) => rendered.click(row(id));
  const press = (id: string) => {
    const target = row(id);
    act(() => {
      target.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    });
    click(id);
  };
  return { rendered, panels, routes, selections, started, press, click };
}

function elapse(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('trying presets in Browse', () => {
  test('a pointer pick plays the preset with the panel left open', () => {
    jest.useFakeTimers();
    const view = mount();
    view.press('preset-2');
    expect(view.routes.at(-1)?.presetId).toBe('preset-2');
    expect(view.routes.at(-1)).not.toHaveProperty('panel');
    expect(view.selections).toEqual([]);
    expect(view.panels).toEqual([]);
    view.rendered.dispose();
  });

  test('a single pick folds the panel with no further action', () => {
    jest.useFakeTimers();
    const view = mount();
    view.press('preset-2');
    elapse(FOLD_MS - 100);
    expect(view.panels).toEqual([]);
    elapse(200);
    expect(view.panels).toEqual([null]);
    view.rendered.dispose();
  });

  test('picking another card restarts the wait', () => {
    jest.useFakeTimers();
    const view = mount();
    view.press('preset-2');
    elapse(FOLD_MS - 100);
    view.press('preset-3');
    elapse(FOLD_MS - 100);
    expect(view.panels).toEqual([]);
    expect(view.routes.at(-1)?.presetId).toBe('preset-3');
    view.rendered.dispose();
  });

  test('the card just tried, picked again, is kept and closes at once', () => {
    jest.useFakeTimers();
    const view = mount();
    view.press('preset-2');
    view.press('preset-2');
    expect(view.panels).toEqual([null]);
    expect(view.routes).toHaveLength(1);
    elapse(FOLD_MS * 2);
    expect(view.panels).toEqual([null]);
    view.rendered.dispose();
  });

  test('the card already on stage closes the panel', () => {
    const view = mount({ activePresetId: 'preset-1' });
    view.press('preset-1');
    expect(view.panels).toEqual([null]);
    view.rendered.dispose();
  });

  test('a mouse resting on the panel holds it open', () => {
    jest.useFakeTimers();
    matchMediaWith((query) => query === '(hover: hover)');
    const view = mount();
    const root = view.rendered.container.querySelector(
      '.stims-shell__sheet-panel--browse',
    ) as HTMLElement;
    const matches = root.matches.bind(root);
    let hovering = true;
    root.matches = ((selector: string) =>
      selector === ':hover'
        ? hovering
        : matches(selector)) as typeof root.matches;
    view.press('preset-2');
    elapse(FOLD_MS * 3);
    expect(view.panels).toEqual([]);
    hovering = false;
    elapse(FOLD_MS + 100);
    expect(view.panels).toEqual([null]);
    view.rendered.dispose();
  });

  test('a touch screen sticky :hover does not hold it open', () => {
    jest.useFakeTimers();
    matchMediaWith(() => false);
    const view = mount();
    const root = view.rendered.container.querySelector(
      '.stims-shell__sheet-panel--browse',
    ) as HTMLElement;
    const matches = root.matches.bind(root);
    root.matches = ((selector: string) =>
      selector === ':hover' ? true : matches(selector)) as typeof root.matches;
    view.press('preset-2');
    elapse(FOLD_MS + 100);
    expect(view.panels).toEqual([null]);
    view.rendered.dispose();
  });

  test('a keyboard pick still plays and closes in one key', () => {
    const view = mount();
    view.click('preset-2');
    expect(view.selections).toEqual(['preset-2']);
    expect(view.routes).toEqual([]);
    view.rendered.dispose();
  });

  test('where the sheet would hide the stage, a pick plays and closes', () => {
    matchMediaWith((query) => query.includes('max-height: 599px'));
    const view = mount();
    view.press('preset-2');
    expect(view.selections).toEqual(['preset-2']);
    expect(view.routes).toEqual([]);
    view.rendered.dispose();
  });

  test('before any audio, a pick starts the demo with that preset', () => {
    const view = mount({ audioActive: false });
    view.press('preset-2');
    expect(view.started).toEqual(['preset-2']);
    expect(view.routes).toEqual([]);
    view.rendered.dispose();
  });
});
