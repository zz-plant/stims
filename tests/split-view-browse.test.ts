import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import type { PresetCatalogEntry } from '../assets/js/frontend/contracts.ts';
import { SplitViewBrowse } from '../assets/js/frontend/SplitViewBrowse.tsx';
import {
  describePresetMood,
  getPresetCardSupportLabel,
} from '../assets/js/frontend/workspace-helpers.ts';
import { createToyContainer } from './toy-test-helpers.ts';

function makePreset(
  overrides: Partial<PresetCatalogEntry> = {},
): PresetCatalogEntry {
  return {
    id: 'test-id',
    title: 'Test Preset',
    author: 'Test Author',
    tags: [],
    ...overrides,
  };
}

type RenderResult = {
  container: HTMLElement;
  root: Root;
  dispose: () => void;
};

function render(props: Parameters<typeof SplitViewBrowse>[0]): RenderResult {
  const { container, dispose } = createToyContainer('split-view-root');
  const root = createRoot(container);
  flushSync(() => {
    root.render(createElement(SplitViewBrowse, props));
  });
  return { container, root, dispose };
}

function flushRender(_root: Root) {
  flushSync(() => {});
}

describe('describePresetMood', () => {
  test('returns "Bright pulse" for glow/sun/flare/star/light/bloom keywords', () => {
    expect(
      describePresetMood(
        makePreset({ id: '1', title: 'Sun Flare', tags: ['glow'] }),
      ),
    ).toBe('Bright pulse');
    expect(
      describePresetMood(makePreset({ id: '2', title: 'Star Bloom' })),
    ).toBe('Bright pulse');
  });

  test('returns "Sharp geometry" for cube/matrix/square/line/grid/trace', () => {
    expect(
      describePresetMood(makePreset({ id: '3', title: 'Grid Trace' })),
    ).toBe('Sharp geometry');
  });

  test('returns "Classic rush" for collection:classic-milkdrop tag', () => {
    expect(
      describePresetMood(
        makePreset({
          id: '4',
          title: 'Old School',
          tags: ['collection:classic-milkdrop'],
        }),
      ),
    ).toBe('Classic rush');
  });

  test('returns "Instant pick" when no keywords match', () => {
    expect(
      describePresetMood(makePreset({ id: '5', title: 'Generic Preset' })),
    ).toBe('Instant pick');
  });
});

describe('getPresetCardSupportLabel', () => {
  test('returns null for "Smooth playback" (default label)', () => {
    expect(
      getPresetCardSupportLabel(makePreset({ id: '1', title: 'Basic Preset' })),
    ).toBeNull();
  });

  test('returns label string for non-default fidelity entries', () => {
    const entry = makePreset({
      id: '2',
      title: 'Certified Preset',
      fidelityTier: 'measured-visual',
      visualCertification: {
        status: 'certified',
        measured: true,
        source: 'reference-suite',
        fidelityClass: 'exact',
        visualEvidenceTier: 'visual',
        requiredBackend: null,
        actualBackend: null,
        reasons: [],
      },
      expectedFidelityClass: 'exact',
    });
    expect(getPresetCardSupportLabel(entry)).toBe('Measured parity');
  });

  test('returns "Parsed (not measured)" for semantic-only tier', () => {
    const entry = makePreset({
      id: '3',
      title: 'Semantic Only',
      fidelityTier: 'semantic-only',
    });
    expect(getPresetCardSupportLabel(entry)).toBe('Parsed (not measured)');
  });
});

describe('SplitViewBrowse', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('renders the browse dialog with correct structure', () => {
    const onSelect = mock();
    const onClose = mock();
    const onPlay = mock();

    const { container } = render({
      presets: [
        makePreset({ id: 'p1', title: 'First Preset' }),
        makePreset({ id: 'p2', title: 'Second Preset' }),
      ],
      currentPresetId: null,
      onSelect,
      onClose,
      onPlay,
    });

    const aside = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(aside).not.toBeNull();
    if (!aside) {
      throw new Error('Expected browse dialog to render.');
    }
    expect(aside?.getAttribute('aria-label')).toBe('Browse presets');
    expect(aside?.getAttribute('aria-modal')).toBe('true');

    const title = aside.querySelector('h2');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe('Browse presets');

    const cards = aside.querySelectorAll('.stims-shell__preset-card');
    expect(cards.length).toBe(2);

    const asideDivs = aside.children;
    const previewPanel = asideDivs[asideDivs.length - 1] as HTMLElement;
    expect(previewPanel.textContent).toContain('First Preset');
    expect(previewPanel.textContent).toContain('Play now');
  });

  test('batches large preset lists so desktop browse opens quickly', () => {
    const onSelect = mock();
    const onClose = mock();
    const onPlay = mock();

    const presets = Array.from({ length: 120 }, (_, index) =>
      makePreset({
        id: `preset-${index}`,
        title: `Preset ${index}`,
      }),
    );

    const { container, root } = render({
      presets,
      currentPresetId: null,
      onSelect,
      onClose,
      onPlay,
    });

    expect(container.querySelectorAll('.stims-shell__preset-card').length).toBe(
      80,
    );
    expect(container.textContent).toContain('Showing 80 of 120.');

    const showMore = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Show more presets',
    );
    expect(showMore).not.toBeNull();

    (showMore as HTMLElement).click();
    flushRender(root);

    expect(container.querySelectorAll('.stims-shell__preset-card').length).toBe(
      120,
    );
  });

  test('selecting a preset fires onSelect and updates active indicator', () => {
    const onSelect = mock();
    const onClose = mock();
    const onPlay = mock();

    const { container, root } = render({
      presets: [
        makePreset({ id: 'p1', title: 'First Preset' }),
        makePreset({
          id: 'p2',
          title: 'Second Preset',
          author: undefined,
        }),
      ],
      currentPresetId: null,
      onSelect,
      onClose,
      onPlay,
    });

    const cards = container.querySelectorAll('.stims-shell__preset-card');
    expect(cards.length).toBe(2);
    expect(cards[0].getAttribute('data-active')).toBe('true');
    expect(cards[1].getAttribute('data-active')).toBe('false');

    (cards[1] as HTMLElement).click();
    flushRender(root);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('p2');
    expect(cards[1].getAttribute('data-active')).toBe('true');
    expect(cards[0].getAttribute('data-active')).toBe('false');
  });

  test('shows empty state when preset list is empty without crashing', () => {
    const onSelect = mock();
    const onClose = mock();
    const onPlay = mock();

    const { container } = render({
      presets: [],
      currentPresetId: null,
      onSelect,
      onClose,
      onPlay,
    });

    const aside = container.querySelector('[role="dialog"]');
    expect(aside).not.toBeNull();
    if (!aside) {
      throw new Error('Expected browse dialog to render.');
    }

    const cards = aside.querySelectorAll('.stims-shell__preset-card');
    expect(cards.length).toBe(0);

    const asideDivs = aside.children;
    const previewPanel = asideDivs[asideDivs.length - 1] as HTMLElement;
    expect(previewPanel.textContent).toContain('Select a preset');
    expect(previewPanel.textContent).toContain('Play now');
  });

  test('clicking the close button triggers onClose', () => {
    const onSelect = mock();
    const onClose = mock();
    const onPlay = mock();

    const { container } = render({
      presets: [makePreset({ id: 'p1', title: 'First Preset' })],
      currentPresetId: null,
      onSelect,
      onClose,
      onPlay,
    });

    const closeButton = container.querySelector(
      'button [data-icon="close"]',
    )?.parentElement;
    expect(closeButton).not.toBeNull();

    (closeButton as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('renders unknown author when author is missing', () => {
    const onSelect = mock();
    const onClose = mock();
    const onPlay = mock();

    const { container } = render({
      presets: [
        makePreset({
          id: 'p1',
          title: 'No Author Preset',
          author: undefined,
        }),
      ],
      currentPresetId: null,
      onSelect,
      onClose,
      onPlay,
    });

    const cards = container.querySelectorAll('.stims-shell__preset-card');
    expect(cards.length).toBe(1);

    const metaSpan = cards[0].querySelector('.stims-shell__preset-meta');
    expect(metaSpan).not.toBeNull();
    expect(metaSpan?.textContent).toBe('Unknown author');
  });

  test('renders preview panel with iframe when a preset is selected', () => {
    const presets = [
      makePreset({ id: 'alpha', title: 'Alpha Wave', author: 'Alice' }),
      makePreset({ id: 'beta', title: 'Beta Surge' }),
    ];
    const onSelect = mock();
    const onClose = mock();
    const onPlay = mock();

    const { container } = render({
      presets,
      currentPresetId: 'alpha',
      onSelect,
      onClose,
      onPlay,
    });

    const aside = container.querySelector('[role="dialog"]');
    expect(aside).not.toBeNull();
    if (!aside) {
      throw new Error('Expected browse dialog to render.');
    }

    const asideDivs = aside.children;
    const previewPanel = asideDivs[asideDivs.length - 1] as HTMLElement;
    expect(previewPanel.textContent).toContain('Alpha Wave');
    expect(previewPanel.textContent).toContain('Alice');
    expect(previewPanel.textContent).not.toContain('Select a preset');

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toContain('preset=alpha');
    expect(iframe?.getAttribute('src')).toContain('agent=true');
    expect(iframe?.getAttribute('src')).toContain('audio=demo');
    expect(iframe?.getAttribute('src')).toContain('embedded=true');

    const playButton = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.trim() === 'Play now',
    );
    expect(playButton).not.toBeNull();

    const activeCard = container.querySelector('[data-active="true"]');
    expect(activeCard).not.toBeNull();
    expect(activeCard?.textContent).toContain('Alpha Wave');
  });
});
