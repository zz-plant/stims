import { describe, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import { StageControls } from '../../src/js/frontend/StageControls.tsx';
import { copyEmbedCodeAction } from '../../src/js/frontend/workspace-actions.ts';
import {
  buildTestPaletteActions,
  makeEngineValue,
  makePresetEntry,
  makeUiValue,
  renderWorkspace,
} from '../frontend-harness.tsx';

/**
 * "Copy embed code": the one visible way to put a preset on another page.
 * Embedding worked only for people who knew the `?embed=true` flag; these
 * check the snippet a visitor copies, what it says about a draft, and where
 * the control sits.
 */

const CATALOG_PRESET = makePresetEntry({
  id: 'martin-wtf-track',
  title: 'martin - "wtf" track',
  author: 'martin',
  bundledFile: 'projectm-cream-of-the-crop/martin-wtf-track.milk',
});

/** A preset made or imported in this browser: no bundled file. */
const LOCAL_PRESET = makePresetEntry({
  id: 'user-remix-1',
  title: 'My remix',
  author: 'me',
});

async function copyFor(
  entry: typeof CATALOG_PRESET | null,
  { dirty = false, clipboard = true } = {},
) {
  const copied: string[] = [];
  const messages: string[] = [];
  const ok = await copyEmbedCodeAction({
    entry,
    dirty,
    origin: 'https://toil.fyi',
    announce: (message) => messages.push(message),
    copy: async (text) => {
      copied.push(text);
      return clipboard;
    },
  });
  return { ok, copied, messages };
}

/** The snippet as a browser parses it, not as a string. */
function parseIframe(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const frames = template.content.querySelectorAll('iframe');
  expect(frames.length).toBe(1);
  return frames[0] as HTMLIFrameElement;
}

describe('copyEmbedCodeAction', () => {
  test('copies one iframe that frames the playing preset by id', async () => {
    const { ok, copied, messages } = await copyFor(CATALOG_PRESET);

    expect(ok).toBe(true);
    const frame = parseIframe(copied[0]);
    expect(frame.getAttribute('src')).toBe(
      'https://toil.fyi/?embed=true&preset=martin-wtf-track',
    );
    // A corpus title with quotes survives the attribute intact.
    expect(frame.getAttribute('title')).toBe('"wtf" track by martin · Stims');
    expect(frame.getAttribute('width')).toBe('800');
    expect(frame.getAttribute('height')).toBe('450');
    const allow = (frame.getAttribute('allow') ?? '').split(/;\s*/);
    for (const feature of [
      'autoplay',
      'microphone',
      'display-capture',
      'fullscreen',
    ]) {
      expect(allow).toContain(feature);
    }
    expect(messages).toEqual([
      'Embed code for “"wtf" track” copied. Paste it into a page’s HTML.',
    ]);
  });

  test('with unsaved edits it embeds the preset as saved and says so', async () => {
    const clean = await copyFor(CATALOG_PRESET);
    const dirty = await copyFor(CATALOG_PRESET, { dirty: true });

    // The same frame: no #code= draft rides along.
    expect(dirty.copied).toEqual(clean.copied);
    expect(parseIframe(dirty.copied[0]).getAttribute('src')).not.toContain('#');
    expect(dirty.messages[0]).toContain('without your unsaved edits');
  });

  test('a preset that lives only in this browser is refused, not embedded under an id nobody else can load', async () => {
    const { ok, copied, messages } = await copyFor(LOCAL_PRESET);

    expect(ok).toBe(false);
    expect(copied).toEqual([]);
    expect(messages[0]).toContain('Share link carries its code');
  });

  test('a clipboard that refuses still hands over the address', async () => {
    const { ok, messages } = await copyFor(CATALOG_PRESET, {
      clipboard: false,
    });

    expect(ok).toBe(false);
    expect(messages[0]).toContain(
      'https://toil.fyi/?embed=true&preset=martin-wtf-track',
    );
  });
});

function liveSnapshot(overrides = {}) {
  return {
    ...createEmptyEngineSnapshot(),
    runtimeReady: true,
    audioActive: true,
    audioSource: 'demo' as const,
    activePresetId: CATALOG_PRESET.id,
    ...overrides,
  };
}

function openShareRow(
  options: {
    entry?: typeof CATALOG_PRESET;
    dirty?: boolean;
    handleCopyEmbedCode?: () => Promise<boolean>;
  } = {},
) {
  const entry = options.entry ?? CATALOG_PRESET;
  const rendered = renderWorkspace(
    createElement(StageControls, {
      isFullscreen: false,
      onToggleFullscreen: () => {},
    }),
    {
      snapshot: liveSnapshot({
        activePresetId: entry.id,
        sessionState: options.dirty
          ? {
              source: '',
              latestCompiled: null,
              activeCompiled: null,
              diagnostics: [],
              dirty: true,
            }
          : null,
      }),
      engine: { selectedPreset: entry, catalog: [entry] },
      ui: options.handleCopyEmbedCode
        ? { handleCopyEmbedCode: options.handleCopyEmbedCode }
        : {},
    },
  );
  rendered.click(rendered.byLabel('More actions'));
  const embed = rendered.container.querySelector<HTMLElement>(
    '[role="menu"] [data-action="copy-embed-code"]',
  );
  const share = rendered.container.querySelector<HTMLElement>(
    '[role="menu"] [data-action="share-link"]',
  );
  return { rendered, embed, share };
}

describe('the dock’s Embed control', () => {
  test('sits on the Share link row and copies through the workspace', () => {
    const handleCopyEmbedCode = mock(async () => true);
    const { rendered, embed, share } = openShareRow({ handleCopyEmbedCode });
    try {
      expect(embed?.textContent).toBe('Embed');
      expect(embed?.getAttribute('role')).toBe('menuitem');
      expect(embed?.getAttribute('aria-label')).toBe('Copy embed code');
      // The same row as Share link, not one more row in the menu.
      expect(embed?.parentElement).toBe(share?.parentElement ?? null);
      expect(embed?.getAttribute('aria-describedby')).toBeNull();

      rendered.click(embed);
      expect(handleCopyEmbedCode).toHaveBeenCalledTimes(1);
      // Running it closes the menu, as every other item does.
      expect(rendered.container.querySelector('[role="menu"]')).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('says before the click that unsaved edits stay out of the embed', () => {
    const { rendered, embed } = openShareRow({ dirty: true });
    try {
      expect(embed?.getAttribute('aria-label')).toBe(
        'Copy embed code (without your unsaved edits)',
      );
      const noteId = embed?.getAttribute('aria-describedby');
      const note = noteId
        ? rendered.container.querySelector(`[id="${noteId}"]`)
        : null;
      expect(note?.textContent).toBe(
        'Embed plays this preset without your unsaved edits.',
      );
    } finally {
      rendered.dispose();
    }
  });

  test('marks a browser-only preset as having no embed', () => {
    const { rendered, embed } = openShareRow({ entry: LOCAL_PRESET });
    try {
      expect(embed?.getAttribute('aria-disabled')).toBe('true');
      expect(embed?.getAttribute('aria-label')).toBe(
        'Copy embed code (catalog presets only)',
      );
    } finally {
      rendered.dispose();
    }
  });
});

describe('the palette’s copy-embed-code action', () => {
  test('has the dock’s id and label, and runs the same handler', () => {
    const handleCopyEmbedCode = mock(async () => true);
    const engine = makeEngineValue({
      selectedPreset: CATALOG_PRESET,
      catalog: [CATALOG_PRESET],
    });
    const find = (editorDirty: boolean) =>
      buildTestPaletteActions({
        engineRef: { current: engine },
        engineBridgeRef: { current: engine },
        uiRef: { current: makeUiValue({ handleCopyEmbedCode }) },
        editorDirty,
      }).find((action) => action.id === 'copy-embed-code');

    expect(find(false)?.label).toBe('Copy embed code');
    expect(find(true)?.label).toBe(
      'Copy embed code (without your unsaved edits)',
    );

    find(false)?.run();
    expect(handleCopyEmbedCode).toHaveBeenCalledTimes(1);
  });
});
