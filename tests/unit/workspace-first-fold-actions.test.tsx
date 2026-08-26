import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AudioSourcePanel } from '../../src/js/frontend/AudioSourcePanel.tsx';
import { NewHomePage } from '../../src/js/frontend/NewHomePage.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

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
