import { afterEach, describe, expect, test } from 'bun:test';
import { AudioSourcePanel } from '../../src/js/frontend/AudioSourcePanel.tsx';
import { resetDeviceDetectCache } from '../../src/js/utils/browser/device-detect.ts';
import { renderWorkspace } from '../frontend-harness.tsx';
import { replaceProperty } from '../test-helpers.ts';

/**
 * What the source panel promises before a permission prompt opens: where the
 * sound goes, and only the sources this browser can actually deliver.
 *
 * Firefox and Safari open the share picker but hand back no audio track, so
 * offering "Tab / system" there led to a share, a silent stage, and a
 * message naming a checkbox those browsers do not have.
 */

const USER_AGENTS = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  firefox:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
} as const;

const restorers: Array<() => void> = [];

afterEach(() => {
  while (restorers.length > 0) restorers.pop()?.();
  resetDeviceDetectCache();
});

function renderAs(browser: keyof typeof USER_AGENTS) {
  restorers.push(
    replaceProperty(navigator, 'userAgent', USER_AGENTS[browser]),
    replaceProperty(navigator, 'mediaDevices', {
      getDisplayMedia: async () => {
        throw new Error('not in tests');
      },
      enumerateDevices: async () => [],
    }),
  );
  resetDeviceDetectCache();
  return renderWorkspace(<AudioSourcePanel showHelp={false} layout="chips" />);
}

const NEEDS_CHROMIUM = /need Chrome or Edge/;

describe('AudioSourcePanel expectations', () => {
  test('says where the sound goes', () => {
    const rendered = renderAs('chrome');
    try {
      expect(rendered.container.textContent).toContain(
        'Sound is analysed in this browser and never uploaded.',
      );
    } finally {
      rendered.dispose();
    }
  });

  // The prompt, the missing sources and the privacy line used to be a note
  // each, so the row carried up to four stacked disclaimers.
  test.each(['chrome', 'firefox'] as const)(
    'on %s, says everything under the sources in one note',
    (browser) => {
      const rendered = renderAs(browser);
      try {
        const notes = Array.from(
          rendered.container.querySelectorAll('.stims-shell__source-note'),
        ).map((note) => note.textContent ?? '');
        expect(notes).toEqual([
          browser === 'chrome'
            ? 'Your browser asks before Stims hears the microphone, a tab or YouTube. Sound is analysed in this browser and never uploaded.'
            : 'Your browser asks before Stims hears the microphone. Tab, system and YouTube audio need Chrome or Edge. Sound is analysed in this browser and never uploaded.',
        ]);
      } finally {
        rendered.dispose();
      }
    },
  );

  test('offers tab and YouTube capture where a share carries audio', () => {
    const rendered = renderAs('chrome');
    try {
      expect(
        rendered.container.querySelector('[data-tab-audio-btn]') !== null,
      ).toBe(true);
      expect(rendered.container.textContent).toContain('YouTube');
      expect(rendered.container.textContent).not.toMatch(NEEDS_CHROMIUM);
    } finally {
      rendered.dispose();
    }
  });

  test.each(['firefox', 'safari'] as const)(
    'on %s, explains the missing capture sources instead of offering them',
    (browser) => {
      const rendered = renderAs(browser);
      try {
        // A boolean, so a failure prints one word rather than the element.
        expect(
          rendered.container.querySelector('[data-tab-audio-btn]') !== null,
        ).toBe(false);
        const chips = Array.from(
          rendered.container.querySelectorAll('button'),
        ).map((button) => button.textContent ?? '');
        expect(chips.some((label) => label.includes('YouTube'))).toBe(false);
        expect(rendered.container.textContent).toMatch(NEEDS_CHROMIUM);
      } finally {
        rendered.dispose();
      }
    },
  );
});
