import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { PresetFinderPanel } from '../../src/js/frontend/PresetFinderPanel.tsx';
import {
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

/**
 * Where the finder puts its "AI" marker.
 *
 * The marker belongs on a control that sends something to a model when the
 * control's own label cannot say so. By sound always asks the hosted search
 * model; By look and By reference rank on this device. A button whose label
 * already says "AI" is its own marker and must not carry a second one.
 */

let active: RenderedWorkspace | null = null;

const mountReferenceFinder = async () => {
  // Reference mode starts no search of its own; the flush lets its mount
  // effect (looking up an episode left open earlier) settle.
  active = renderWorkspace(
    <PresetFinderPanel initialMode="reference" onClose={() => {}} />,
  );
  await act(async () => {});
  return active;
};

const markerIn = (host: Element) =>
  [...host.querySelectorAll<HTMLElement>('span[title]')].find(
    (candidate) => candidate.textContent === 'AI',
  );

describe('PresetFinderPanel AI marker', () => {
  afterEach(() => {
    active?.dispose();
    active = null;
    localStorage.clear();
  });

  test('only the mode that asks the hosted model is marked', async () => {
    const panel = await mountReferenceFinder();
    const modes = [
      ...panel.container.querySelectorAll<HTMLElement>('.stims-finder__mode'),
    ];

    expect(modes.map((mode) => mode.querySelector('input')?.value)).toEqual([
      'sound',
      'look',
      'reference',
    ]);
    const marked = modes.filter((mode) => markerIn(mode));
    expect(marked.map((mode) => mode.querySelector('input')?.value)).toEqual([
      'sound',
    ]);

    // The marker says what leaves the browser and that it needs the network.
    const title = markerIn(marked[0])?.title ?? '';
    expect(title).toContain('not the audio');
    expect(title).toContain('Needs a connection');
  });

  test('the panel heading and a label that says AI carry no marker', async () => {
    const panel = await mountReferenceFinder();

    const heading = panel.container.querySelector('.stims-finder__title');
    expect(heading?.textContent).toBe('Find a preset');

    const clefPick = [...panel.container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Let AI pick one'),
    );
    expect(clefPick?.textContent).toBe('Let AI pick one (Clef)');
  });
});
