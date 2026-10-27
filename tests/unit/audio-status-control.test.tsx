/**
 * The dock's audio popover: its door to Settings opens, never closes, and
 * its sources name the prompt they will raise.
 */
import { afterEach, expect, test } from 'bun:test';
import { createElement } from 'react';
import { AudioStatusControl } from '../../src/js/frontend/AudioStatusControl.tsx';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import {
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

let view: RenderedWorkspace | null = null;

afterEach(() => {
  view?.dispose();
  view = null;
});

function mount(panel: 'settings' | null, updatePanel: (p: unknown) => void) {
  return renderWorkspace(createElement(AudioStatusControl), {
    snapshot: {
      ...createEmptyEngineSnapshot(),
      runtimeReady: true,
      audioActive: true,
      audioSource: 'demo',
    },
    ui: {
      updatePanel,
      routeState: {
        presetId: null,
        collectionTag: null,
        panel,
        audioSource: 'demo',
        agentMode: false,
      },
    },
  });
}

test('"Open audio settings" opens Settings even when Settings is open', () => {
  const panels: unknown[] = [];
  view = mount('settings', (panel) => panels.push(panel));
  view.click(
    view.container.querySelector<HTMLElement>('[data-action="audio-status"]'),
  );
  const open = view.container.querySelector<HTMLElement>(
    '[data-action="open-audio-setup"]',
  );
  expect(open?.textContent).toBe('Open audio settings');
  view.click(open);
  // As a toggle it closed the panel it promised to open.
  expect(panels).toEqual(['settings']);
});

test('sources that raise a browser prompt say so, and pause says the sound continues', () => {
  view = mount(null, () => {});
  view.click(
    view.container.querySelector<HTMLElement>('[data-action="audio-status"]'),
  );
  expect(
    view.container.querySelector('[data-action="audio-microphone"]')
      ?.textContent,
  ).toBe('Microphone (asks for microphone access)');
  expect(
    view.container.querySelector('[data-action="toggle-playback"]')
      ?.textContent,
  ).toBe('Pause visualsSound keeps playing.');
});
