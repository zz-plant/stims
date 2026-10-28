/**
 * The cue monitor's controls name what they do, and the one with no undo
 * asks first.
 */
import { afterEach, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { CueMonitor } from '../../src/js/frontend/CueMonitor.tsx';
import {
  makePresetEntry,
  makeUiValue,
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

let view: RenderedWorkspace | null = null;

afterEach(() => {
  view?.dispose();
  view = null;
});

function mountWithQueue(clear: () => void) {
  const entries = [
    makePresetEntry({ id: 'one', title: 'One' }),
    makePresetEntry({ id: 'two', title: 'Two' }),
    makePresetEntry({ id: 'three', title: 'Three' }),
  ];
  return renderWorkspace(createElement(CueMonitor), {
    ui: {
      presetQueue: {
        ...makeUiValue().presetQueue,
        entries,
        presetIds: entries.map((entry) => entry.id),
        clear,
      },
    },
  });
}

function button(rendered: RenderedWorkspace, action: string) {
  return rendered.container.querySelector<HTMLButtonElement>(
    `[data-action="${action}"]`,
  );
}

test('the deck names its actions by what they do', () => {
  view = mountWithQueue(() => {});
  // "Take" and "Skip" were jargon; "Skip" here only drops the entry.
  expect(button(view, 'queue-take')?.textContent).toBe('Play now');
  expect(button(view, 'queue-skip')?.textContent).toBe('Remove from queue');
  expect(button(view, 'queue-fade')?.textContent).toBe(
    'Play with a crossfade slider',
  );
});

test('clearing the queue asks once before it empties it', () => {
  const clear = mock(() => {});
  view = mountWithQueue(clear);
  const clearButton = () => button(view as RenderedWorkspace, 'queue-clear');

  expect(clearButton()?.textContent).toBe('Clear queue');
  view.click(clearButton());
  expect(clear).not.toHaveBeenCalled();
  // The whole queue goes, the preset showing as next included.
  expect(clearButton()?.textContent).toBe('Clear all 3 queued');

  view.click(clearButton());
  expect(clear).toHaveBeenCalledTimes(1);
});
