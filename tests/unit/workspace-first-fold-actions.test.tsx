import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveLastSession } from '../../src/js/core/state/last-session-store.ts';
import { AudioSourcePanel } from '../../src/js/frontend/AudioSourcePanel.tsx';
import { NewHomePage } from '../../src/js/frontend/NewHomePage.tsx';
import { makePresetEntry, renderWorkspace } from '../frontend-harness.tsx';

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
      // Browse presets changes context; it is a quiet action, not Resume's equal.
      const browse = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Browse presets',
      );
      expect(browse?.className).toContain(
        'stims-shell__launch-secondary--quiet',
      );
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
        'stims-shell__launch-secondary--quiet',
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
        'stims-shell__launch-source-minimal',
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
