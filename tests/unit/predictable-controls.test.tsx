/**
 * Controls whose effect a visitor could not predict from the label: each test
 * renders the surface, presses the control, and checks that what happened is
 * what the label said would.
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
import {
  getActiveAccessibilityPreference,
  resetAccessibilityPreferenceState,
} from '../../src/js/core/accessibility-preferences.ts';
import { saveLastSession } from '../../src/js/core/state/last-session-store.ts';
import { AudioSourcePanel } from '../../src/js/frontend/AudioSourcePanel.tsx';
import { BrowseSheetPanel } from '../../src/js/frontend/BrowseSheetPanel.tsx';
import type { SessionRouteState } from '../../src/js/frontend/contracts.ts';
import { ManageSetsDialog } from '../../src/js/frontend/ManageSetsDialog.tsx';
import { NewHomePage } from '../../src/js/frontend/NewHomePage.tsx';
import { PerformanceHardwareSection } from '../../src/js/frontend/PerformanceHardwareSection.tsx';
import {
  PresetPageDetails,
  usePresetPageContent,
} from '../../src/js/frontend/PresetPageDetails.tsx';
import { saveNamedSet } from '../../src/js/frontend/preset-sets.ts';
import { getCollectionTags } from '../../src/js/frontend/workspace-helpers.ts';
import {
  makePresetEntry,
  makeUiValue,
  mouseClick,
  renderWorkspace,
} from '../frontend-harness.tsx';

// Browse is virtualized and mounts nothing in a viewport with no size.
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
  localStorage.clear();
  resetAccessibilityPreferenceState();
});

function buttonByText(container: HTMLElement, text: string) {
  return (
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === text,
    ) ?? null
  );
}

const catalog = ['glowsticks', 'snakeskin', 'tokamak'].map((id) =>
  makePresetEntry({ id, title: id }),
);

describe('Browse', () => {
  function mountBrowse({
    audioActive,
    entries = catalog,
  }: {
    audioActive: boolean;
    entries?: typeof catalog;
  }) {
    const started: Array<{ source: string; presetId: string | null }> = [];
    const selected: string[] = [];
    const shuffled: number[] = [];
    const rendered = renderWorkspace(createElement(BrowseSheetPanel), {
      engine: {
        catalog: entries,
        filteredCatalog: entries,
        collectionTags: getCollectionTags(entries),
        audioActive,
        handleAudioStart: async (source, _device, presetId) => {
          started.push({ source, presetId: presetId ?? null });
          return { ok: true, source, message: null };
        },
        handlePresetSelection: (id) => selected.push(id),
        handleShufflePreset: () => shuffled.push(1),
      },
    });
    return { rendered, started, selected, shuffled };
  }

  test('the random button plays a preset, starting the demo when nothing is playing', () => {
    const idle = mountBrowse({ audioActive: false });
    try {
      idle.rendered.click(idle.rendered.byLabel('Play a random preset'));
      expect(idle.started).toHaveLength(1);
      expect(idle.started[0]?.source).toBe('demo');
      expect(catalog.map((entry) => entry.id)).toContain(
        idle.started[0]?.presetId ?? '',
      );
      expect(idle.shuffled).toEqual([]);
    } finally {
      idle.rendered.dispose();
    }

    const live = mountBrowse({ audioActive: true });
    try {
      live.rendered.click(live.rendered.byLabel('Play a random preset'));
      expect(live.shuffled).toEqual([1]);
      expect(live.started).toEqual([]);
    } finally {
      live.rendered.dispose();
    }
  });

  test('a card plays its preset before any audio has started', () => {
    localStorage.setItem('stims:browse-view', 'list');
    const { rendered, started, selected } = mountBrowse({
      audioActive: false,
    });
    try {
      const card = rendered.container.querySelector<HTMLAnchorElement>(
        'a[href="/?preset=snakeskin"]',
      );
      expect(card).not.toBeNull();
      card?.dispatchEvent(mouseClick());
      expect(started).toEqual([{ source: 'demo', presetId: 'snakeskin' }]);
      expect(selected).toEqual([]);
    } finally {
      rendered.dispose();
    }
  });

  test('the flash notice says its button turns the protection off, and it does', () => {
    const flashing = makePresetEntry({
      id: 'strobe',
      title: 'strobe',
      sensoryProfile: { flashRiskLevel: 'high' },
    } as Parameters<typeof makePresetEntry>[0]);
    const { rendered } = mountBrowse({
      audioActive: true,
      entries: [...catalog, flashing],
    });
    try {
      expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);
      expect(rendered.text()).toContain('stops the stage dimming flashes');
      expect(buttonByText(rendered.container, 'Show them')).toBeNull();
      rendered.click(
        buttonByText(rendered.container, 'Turn off Reduce flashing'),
      );
      expect(getActiveAccessibilityPreference().reduceFlashing).toBe(false);
    } finally {
      rendered.dispose();
    }
  });
});

describe('Preset sets', () => {
  function mountSets(currentQueueIds: string[]) {
    saveNamedSet('Evening', ['glowsticks', 'tokamak']);
    const loaded: string[][] = [];
    const rendered = renderWorkspace(
      createElement(ManageSetsDialog, {
        open: true,
        onClose: () => {},
        currentQueueIds,
        onLoadQueue: (ids) => loaded.push(ids),
        onNotify: () => {},
      }),
    );
    return { rendered, loaded };
  }

  test('deleting a set asks once, in place, and is told apart from closing', () => {
    const { rendered } = mountSets([]);
    try {
      const remove = rendered.byLabel('Delete Evening');
      expect(remove?.textContent).toBe('Delete');
      rendered.click(remove);
      expect(rendered.text()).toContain('Evening');
      const armed = rendered.byLabel('Delete Evening for good');
      expect(armed?.textContent).toBe('Delete for good');
      rendered.click(armed);
      expect(rendered.text()).not.toContain('Evening');
    } finally {
      rendered.dispose();
    }
  });

  test('loading names what it does to the queue, and warns when it replaces one', () => {
    const empty = mountSets([]);
    try {
      expect(
        buttonByText(empty.rendered.container, 'Load into queue'),
      ).not.toBeNull();
      expect(empty.rendered.text()).not.toContain('replaces your current');
    } finally {
      empty.rendered.dispose();
    }
    localStorage.clear();

    const full = mountSets(['snakeskin']);
    try {
      expect(full.rendered.text()).toContain(
        'Loading a set replaces your current queue (1 preset)',
      );
      full.rendered.click(
        buttonByText(full.rendered.container, 'Replace queue'),
      );
      expect(full.loaded).toEqual([['glowsticks', 'tokamak']]);
    } finally {
      full.rendered.dispose();
    }
  });
});

describe('Home page', () => {
  test('Edit names the preset running behind the page', () => {
    const entry = makePresetEntry({
      id: 'shifter-curlique',
      title: 'Shifter - Curlique',
      author: 'Shifter',
    });
    const rendered = renderWorkspace(createElement(NewHomePage), {
      engine: { attractPreviewLive: true, selectedPreset: entry },
    });
    try {
      const edit = rendered.container.querySelector(
        '.stims-shell__launch-actions-minimal [data-action="open-editor"]',
      );
      expect(edit?.textContent).toBe('Edit Curlique');
    } finally {
      rendered.dispose();
    }
  });

  test('Resume with your mic says the browser asks again', () => {
    const entry = makePresetEntry({ id: 'chasers', title: 'Chasers' });
    saveLastSession({
      presetId: entry.id,
      presetTitle: entry.title,
      source: 'microphone',
    });
    const rendered = renderWorkspace(createElement(NewHomePage), {
      engine: { catalog: [entry] },
    });
    try {
      const note = rendered.container.querySelector(
        '.stims-shell__launch-actions-minimal + .stims-shell__launch-note',
      );
      expect(note?.textContent).toBe(
        'Your browser asks for the microphone again.',
      );
    } finally {
      rendered.dispose();
    }
  });
});

describe('Audio sources', () => {
  test('the loaded-video button says it opens the share picker', () => {
    const rendered = renderWorkspace(createElement(AudioSourcePanel), {
      ui: {
        youtubeReady: true,
        youtubeCanLoad: true,
        youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
      },
    });
    try {
      expect(
        buttonByText(rendered.container, "Share this tab's audio"),
      ).not.toBeNull();
      expect(buttonByText(rendered.container, 'Start capture')).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('clearing recent videos asks once before it clears', () => {
    let cleared = 0;
    const rendered = renderWorkspace(createElement(AudioSourcePanel), {
      ui: {
        recentYouTubeVideos: [
          { id: 'dQw4w9WgXcQ', title: 'A video', author: '', thumbnail: '' },
        ] as never,
      },
      engine: { clearRecentYouTubeVideos: () => (cleared += 1) },
    });
    try {
      rendered.click(buttonByText(rendered.container, 'Clear recent videos'));
      expect(cleared).toBe(0);
      rendered.click(
        buttonByText(rendered.container, 'Clear the list for good'),
      );
      expect(cleared).toBe(1);
    } finally {
      rendered.dispose();
    }
  });

  test('the chip row says which chips ask the browser for something', () => {
    const rendered = renderWorkspace(
      createElement(AudioSourcePanel, { layout: 'chips' }),
    );
    try {
      expect(rendered.text()).toContain(
        'Your browser asks before Stims hears the microphone',
      );
    } finally {
      rendered.dispose();
    }
  });
});

describe('Preset page', () => {
  function Harness() {
    const content = usePresetPageContent(
      [
        makePresetEntry({
          id: 'geiss-one',
          title: 'Geiss - One',
          author: 'Geiss',
        }),
        makePresetEntry({
          id: 'geiss-two',
          title: 'Geiss - Two',
          author: 'Geiss',
        }),
      ],
      'geiss-one',
    );
    return content
      ? createElement(PresetPageDetails, { content, onSelectPreset: () => {} })
      : null;
  }

  test("the author link opens that author's presets in place, without reloading", () => {
    let route: SessionRouteState = makeUiValue().routeState;
    const rendered = renderWorkspace(createElement(Harness), {
      ui: {
        commitRoute: (next) => {
          route = typeof next === 'function' ? next(route) : next;
        },
      },
    });
    try {
      const author = rendered.container.querySelector<HTMLAnchorElement>(
        'a[href="/author/geiss"]',
      );
      const event = mouseClick();
      author?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(route.panel).toBe('browse');
      expect(route.discovery?.author).toBe('Geiss');
    } finally {
      rendered.dispose();
    }
  });
});

describe('Performance hardware', () => {
  test('each map button names its job, and a disabled one says why', () => {
    const rendered = renderWorkspace(createElement(PerformanceHardwareSection));
    try {
      const knob = buttonByText(rendered.container, 'Map the next knob I move');
      expect(knob?.hasAttribute('disabled')).toBe(true);
      expect(rendered.text()).toContain(
        'Connect a MIDI controller to map knobs.',
      );
      expect(buttonByText(rendered.container, 'Learn')).toBeNull();
    } finally {
      rendered.dispose();
    }
  });
});
