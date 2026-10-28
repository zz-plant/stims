/**
 * The dock's audio popover: its door to Settings opens, never closes, and
 * its sources name the prompt they will raise.
 */
import { afterEach, expect, test } from 'bun:test';
import { createElement } from 'react';
import { AudioStatusControl } from '../../src/js/frontend/AudioStatusControl.tsx';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import { setActiveFileAudio } from '../../src/js/frontend/file-audio.ts';
import {
  buildTestPaletteActions,
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

let view: RenderedWorkspace | null = null;

afterEach(() => {
  view?.dispose();
  view = null;
  setActiveFileAudio(null);
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

test('playlist track rows carry the ids of the palette actions they match', () => {
  const steps: string[] = [];
  setActiveFileAudio({
    stream: {} as MediaStream,
    element: { paused: false } as HTMLAudioElement,
    name: 'one.mp3',
    playlist: [
      { name: 'one.mp3', file: {} as File },
      { name: 'two.mp3', file: {} as File },
    ],
    currentIndex: 0,
    nextTrack: async () => {
      steps.push('next');
    },
    previousTrack: async () => {
      steps.push('previous');
    },
    dispose: () => {},
  });
  view = renderWorkspace(createElement(AudioStatusControl), {
    snapshot: {
      ...createEmptyEngineSnapshot(),
      runtimeReady: true,
      audioActive: true,
      audioSource: 'file',
    },
  });
  view.click(
    view.container.querySelector<HTMLElement>('[data-action="audio-status"]'),
  );
  const rows = [
    ...view.container.querySelectorAll<HTMLElement>('[data-action$="-track"]'),
  ];
  // One id per action across surfaces, so the actions-by-surface report
  // does not split a track change into two unrelated actions.
  const paletteIds = buildTestPaletteActions({ liveMode: true }).map(
    (action) => action.id,
  );
  const ids = rows.map((element) => element.dataset.action ?? '');
  expect(ids).toEqual(['prev-audio-track', 'next-audio-track']);
  for (const id of ids) expect(paletteIds).toContain(id);
  // Each row closes the popover when it runs, so it is reopened between them.
  const control = (action: string) =>
    view?.container.querySelector<HTMLElement>(`[data-action="${action}"]`);
  view.click(control('prev-audio-track'));
  view.click(control('audio-status'));
  view.click(control('next-audio-track'));
  expect(steps).toEqual(['previous', 'next']);
});
