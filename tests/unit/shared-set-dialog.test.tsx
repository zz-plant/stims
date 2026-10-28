/** Shared sets retain order, explain unavailable presets, and remain usable across links. */
import { afterEach, expect, test } from 'bun:test';
import type { SharedPresetSetPayload } from '../../src/js/frontend/preset-sets.ts';
import { SharedSetDialog } from '../../src/js/frontend/SharedSetDialog.tsx';
import {
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

let view: RenderedWorkspace | null = null;
afterEach(() => {
  view?.dispose();
  view = null;
});

const catalog = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
];
const button = (text: string) =>
  [...(view?.container.querySelectorAll('button') ?? [])].find(
    (entry) => entry.textContent === text,
  );

test('loads and saves available presets in sequence while explaining missing entries', () => {
  const loaded: string[][] = [];
  const saved: Array<{ title: string; ids: string[] }> = [];
  view = renderWorkspace(
    <SharedSetDialog
      open
      onClose={() => {}}
      payload={{ v: 1, title: 'Reprise', presets: ['b', 'missing', 'a', 'b'] }}
      catalog={catalog}
      existingQueueCount={2}
      onLoadQueue={(ids) => loaded.push(ids)}
      onSaveSet={(title, ids) => saved.push({ title, ids })}
    />,
  );
  expect(view.text()).toContain('3 available in this catalog');
  expect(view.text()).toContain('(unavailable)');
  expect(view.text()).toContain('replace your current queue');
  view.click(button('Save to my sets'));
  expect(saved).toEqual([{ title: 'Reprise', ids: ['b', 'a', 'b'] }]);
  view.click(button('Load into queue'));
  expect(loaded).toEqual([['b', 'a', 'b']]);
});

test('a second shared set can be saved after the first one', () => {
  const saved: string[] = [];
  const dialog = (payload: SharedPresetSetPayload) => (
    <SharedSetDialog
      open
      onClose={() => {}}
      payload={payload}
      catalog={catalog}
      existingQueueCount={0}
      onLoadQueue={() => {}}
      onSaveSet={(title) => saved.push(title)}
    />
  );
  view = renderWorkspace(dialog({ v: 1, title: 'First', presets: ['a'] }));
  view.click(button('Save to my sets'));
  expect(button('Saved to sets ✓')?.disabled).toBe(true);
  view.rerender(dialog({ v: 1, title: 'Second', presets: ['b'] }));
  expect(button('Save to my sets')?.disabled).toBe(false);
  view.click(button('Save to my sets'));
  expect(saved).toEqual(['First', 'Second']);
});

test('an entirely unavailable set cannot replace a queue or save an empty set', () => {
  view = renderWorkspace(
    <SharedSetDialog
      open
      onClose={() => {}}
      payload={{ v: 1, title: 'Missing', presets: ['missing'] }}
      catalog={catalog}
      existingQueueCount={1}
      onLoadQueue={() => {
        throw new Error('must not load');
      }}
      onSaveSet={() => {
        throw new Error('must not save');
      }}
    />,
  );
  expect(button('Load into queue')?.disabled).toBe(true);
  expect(button('Save to my sets')?.disabled).toBe(true);
});
