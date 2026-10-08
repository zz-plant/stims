import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { resolveSemanticRoute } from '../../functions/discover-slugs.ts';
import { saveLastSession } from '../../src/js/core/state/last-session-store.ts';
import { AudioSourcePanel } from '../../src/js/frontend/AudioSourcePanel.tsx';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import { NewHomePage } from '../../src/js/frontend/NewHomePage.tsx';
import {
  makePresetEntry,
  makeUiValue,
  renderWorkspace,
} from '../frontend-harness.tsx';

const LAST_SESSION_KEY = 'stims:last-session';

/** Renders the "Welcome back" variant: a stored session whose preset the catalog resolves. */
function renderReturningVisitor(source: 'microphone' | 'demo') {
  const entry = makePresetEntry({
    id: 'eo-s-phat-chasers',
    title: 'eo.s. + phat - chasers 11',
    author: 'eo.s.',
  });
  saveLastSession({ presetId: entry.id, presetTitle: entry.title, source });
  const rendered = renderWorkspace(<NewHomePage />, {
    engine: { catalog: [entry] },
  });
  return {
    ...rendered,
    dispose: () => {
      rendered.dispose();
      localStorage.removeItem(LAST_SESSION_KEY);
    },
  };
}

describe('workspace first-fold launch hierarchy', () => {
  test('the launch page renders real audio choices without demo generation', () => {
    // Renders the real NewHomePage (which mounts AudioSourcePanel) through the
    // workspace harness instead of grepping component source. The first fold
    // must offer the user-audio choices directly and must NOT resurrect the
    // demo-audio or preset-generation CTAs the simplification removed.
    const rendered = renderWorkspace(<NewHomePage />);
    try {
      const text = rendered.text();
      expect(text).not.toContain('See visuals now');
      expect(text).not.toContain('Play with demo audio');
      expect(text).not.toContain('Start instantly with demo audio');
      expect(text).not.toContain('Create a visual preset');
      expect(text).toContain('Browse presets');
      // The audio panel is embedded in the first fold, compact (no help copy).
      // 'Audio from this browser tab' is capability-gated on getDisplayMedia
      // and cannot render here; Microphone and the file picker are
      // unconditional.
      expect(text).toContain('Microphone');
      expect(text).toContain('Audio file');
      expect(text).not.toContain('Advanced audio setup');
      expect(
        rendered.container.querySelector('[data-youtube-url-input]'),
      ).not.toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('a first visit leads with the promise, not the product name', () => {
    const rendered = renderWorkspace(<NewHomePage />);
    try {
      const { container } = rendered;
      const heading = container.querySelector('h1');
      expect(heading?.textContent).toBe('A music visualizer you can open up');
      // The name is still on the page, as a nameplate rather than the h1.
      expect(
        container.querySelector('.stims-shell__launch-nameplate')?.textContent,
      ).toBe('Stims');
      // What the demo is, said directly under the pair of buttons — not as
      // the last sentence of a paragraph below them.
      const actions = container.querySelector(
        '.stims-shell__launch-actions-minimal',
      );
      expect(actions?.nextElementSibling?.textContent).toContain(
        'built-in synth loop',
      );
    } finally {
      rendered.dispose();
    }
  });

  test('a curated hub arrival names its collection in the h1', () => {
    const discovery = resolveSemanticRoute('/author/geiss');
    const rendered = renderWorkspace(<NewHomePage />, {
      ui: {
        routeState: {
          ...makeUiValue().routeState,
          panel: 'browse',
          discovery: discovery ?? undefined,
        },
      },
    });
    try {
      const headings = rendered.container.querySelectorAll('h1');
      expect(headings.length).toBe(1);
      expect(headings[0]?.textContent).toBe('Geiss MilkDrop Presets');
      expect(
        rendered.container.querySelector('.stims-shell__launch-tagline')
          ?.textContent,
      ).toBe(discovery?.description);
    } finally {
      rendered.dispose();
    }
  });

  test('once the visualizer is live, the launch title stops being a heading', () => {
    // The launch page stays mounted, faded and inert, behind the live stage;
    // the playing preset's name below the stage is the page's h1 then.
    const rendered = renderWorkspace(<NewHomePage />, {
      engine: { audioActive: true },
    });
    try {
      // Counted, not matched: a failing matcher prints the whole element.
      expect(rendered.container.querySelectorAll('h1').length).toBe(0);
      expect(
        rendered.container.querySelector('#stims-launch-title')?.textContent,
      ).toBe('A music visualizer you can open up');
    } finally {
      rendered.dispose();
    }
  });

  test('a first visit offers the other sources as chips, with no disclosure and no second demo', () => {
    const rendered = renderWorkspace(<NewHomePage />);
    try {
      const { container } = rendered;
      expect(container.querySelector('details')).toBeNull();
      expect(rendered.text()).toContain('Or play your own audio');
      expect(
        container.querySelector('.stims-shell__source-grid--chips'),
      ).not.toBeNull();
      // Play demo is the primary button; a "Demo audio" chip under it was a
      // second way to press the same thing.
      const demoButtons = container.querySelectorAll('[data-demo-audio-btn]');
      expect(demoButtons.length).toBe(1);
      expect(demoButtons[0].className).toContain('stims-shell__launch-cta');
    } finally {
      rendered.dispose();
    }
  });

  test('Browse presets is the same button beside the primary on both variants', () => {
    const browseOf = (rendered: ReturnType<typeof renderWorkspace>) =>
      [...rendered.container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Browse presets',
      );
    const first = renderWorkspace(<NewHomePage />);
    const returning = renderReturningVisitor('microphone');
    try {
      for (const rendered of [first, returning]) {
        const browse = browseOf(rendered);
        expect(browse?.className).toBe('stims-shell__launch-secondary');
        expect(browse?.parentElement?.className).toBe(
          'stims-shell__launch-actions-minimal',
        );
        expect(
          browse?.parentElement?.querySelector('.stims-shell__launch-cta'),
        ).not.toBeNull();
      }
    } finally {
      first.dispose();
      returning.dispose();
    }
  });

  test('the focus the page places itself shows no ring until a key is pressed', () => {
    const rendered = renderWorkspace(<NewHomePage />);
    try {
      const cta = rendered.container.querySelector<HTMLButtonElement>(
        '.stims-shell__launch-cta',
      );
      expect(document.activeElement).toBe(cta);
      expect(cta?.getAttribute('data-quiet-focus')).toBe('true');
      // The test DOM has no KeyboardEvent; the listener reads no key.
      act(() => {
        document.dispatchEvent(new Event('keydown', { bubbles: true }));
      });
      expect(cta?.hasAttribute('data-quiet-focus')).toBe(false);
      expect(document.activeElement).toBe(cta);
    } finally {
      rendered.dispose();
    }
  });

  test('names the preset running behind a first visit, only while it runs', () => {
    const entry = makePresetEntry({
      id: 'krash-rovastar-cerebral-demons-stars',
      title: 'Krash & Rovastar - Cerebral Demons (Stars Remix)',
      author: 'Krash',
    });
    const caption = (attractPreviewLive: boolean, runtimeReady: boolean) => {
      const rendered = renderWorkspace(<NewHomePage />, {
        engine: { attractPreviewLive, selectedPreset: entry, catalog: [entry] },
        snapshot: {
          ...createEmptyEngineSnapshot(),
          runtimeReady,
          activePresetId: entry.id,
        },
      });
      const text =
        rendered.container.querySelector('.stims-shell__attract-caption')
          ?.textContent ?? null;
      rendered.dispose();
      return text;
    };
    expect(caption(true, true)).toBe(
      'Running nowCerebral Demons (Stars Remix)Krash + Rovastar',
    );
    // Gated off (low power, reduced motion) or paused as blank: nothing is
    // running, so nothing is named.
    expect(caption(false, true)).toBeNull();
    expect(caption(true, false)).toBeNull();
  });

  test('the audio panel keeps YouTube first-class and drops the demo fallback', () => {
    const rendered = renderWorkspace(<AudioSourcePanel showHelp={false} />);
    try {
      const text = rendered.text();
      // The old fallback framing ('Use demo audio instead') must not return;
      // demo audio itself is a sanctioned tile under its newer copy.
      expect(text).not.toContain('Use demo audio instead');
      expect(text).toContain('Microphone');
      expect(text).toContain('Audio file');
      expect(
        rendered.container.querySelector('.stims-shell__youtube-primary'),
      ).not.toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('a returning visitor gets one preset card, Resume, then the other sources as chips', () => {
    // The hierarchy is: Welcome back → preset → Resume → change source →
    // change preset. Not headline → sentence → art → two equal buttons →
    // a disclosure that doubles the page when opened.
    const rendered = renderReturningVisitor('microphone');
    try {
      const text = rendered.text();
      const { container } = rendered;
      expect(text).toContain('Welcome back');
      expect(text).toContain('eo.s. + phat - chasers 11');
      expect(text).not.toContain('Continue with');
      // The preset name is part of the card, not a tagline above it.
      expect(
        container.querySelector(
          '.stims-shell__launch-resume-card .stims-shell__launch-resume-card-title',
        )?.textContent,
      ).toBe('eo.s. + phat - chasers 11');
      expect(
        container.querySelector(
          '.stims-shell__launch-resume-card .stims-shell__preset-art',
        ),
      ).not.toBeNull();
      // The usual source is the primary button, and carries that source's
      // automation hook — not the demo one.
      const cta = container.querySelector<HTMLButtonElement>(
        '.stims-shell__launch-cta',
      );
      expect(cta?.textContent).toBe('Resume with your mic');
      expect(cta?.hasAttribute('data-mic-audio-btn')).toBe(true);
      expect(cta?.hasAttribute('data-demo-audio-btn')).toBe(false);
      // No disclosure: the other sources are chips directly under Resume …
      expect(
        container.querySelector('details.stims-shell__launch-source-minimal'),
      ).toBeNull();
      expect(text).not.toContain('Or use your own audio');
      expect(text).toContain('Use a different source');
      expect(
        container.querySelector('.stims-shell__source-grid--chips'),
      ).not.toBeNull();
      // … and the source Resume already starts is not offered again under
      // another name. The file picker still is.
      expect(
        container.querySelector(
          '.stims-shell__source-card[data-mic-audio-btn]',
        ),
      ).toBeNull();
      expect(
        container.querySelector(
          '.stims-shell__source-card[data-file-audio-btn]',
        ),
      ).not.toBeNull();
      // Demo audio is not "your own audio": it is the small no-permission
      // action under Resume, and the only demo hook on the page.
      const demoButtons = container.querySelectorAll('[data-demo-audio-btn]');
      expect(demoButtons.length).toBe(1);
      expect(demoButtons[0].className).toContain(
        'stims-shell__launch-demo-link',
      );
      // The returning card names the preset itself, so no second caption.
      expect(
        container.querySelector('.stims-shell__attract-caption'),
      ).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('a visitor who last used demo audio gets the microphone chip and no demo shortcut', () => {
    const rendered = renderReturningVisitor('demo');
    try {
      const { container } = rendered;
      const cta = container.querySelector<HTMLButtonElement>(
        '.stims-shell__launch-cta',
      );
      expect(cta?.textContent).toBe('Resume with demo audio');
      expect(cta?.hasAttribute('data-demo-audio-btn')).toBe(true);
      expect(
        container.querySelector('.stims-shell__launch-demo-link'),
      ).toBeNull();
      expect(
        container.querySelector(
          '.stims-shell__source-card[data-mic-audio-btn]',
        ),
      ).not.toBeNull();
      expect(
        container.querySelector(
          '.stims-shell__source-card[data-demo-audio-btn]',
        ),
      ).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('the resume launch CSS still styles what the page renders', () => {
    const rendered = renderReturningVisitor('microphone');
    const appShellCss = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'css', 'app-shell.css'),
      'utf8',
    );
    try {
      for (const className of [
        'stims-shell__launch-resume-card',
        'stims-shell__launch-resume-card-title',
        'stims-shell__launch-demo-link',
        'stims-shell__launch-sources-inline',
        'stims-shell__source-grid--chips',
        'stims-shell__source-card--chip',
        'stims-shell__launch-secondary',
      ]) {
        expect(
          rendered.container.querySelector(`.${className}`),
        ).not.toBeNull();
        expect(appShellCss).toContain(`.${className}`);
      }
    } finally {
      rendered.dispose();
    }
  });

  test('the launch CSS still styles what the page renders', () => {
    // The class names come from the RENDERED page; the CSS half is a source
    // read because this suite computes no styles. Deriving the selectors from
    // the live DOM is what keeps the two from drifting apart silently.
    const rendered = renderWorkspace(<NewHomePage />);
    const appShellCss = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'css', 'app-shell.css'),
      'utf8',
    );
    try {
      for (const className of [
        'stims-shell__launch-center',
        'stims-shell__launch-nameplate',
        'stims-shell__launch-note',
        'stims-shell__launch-sources-inline',
      ]) {
        expect(
          rendered.container.querySelector(`.${className}`),
        ).not.toBeNull();
        expect(appShellCss).toContain(`.${className}`);
      }
    } finally {
      rendered.dispose();
    }
  });
});
