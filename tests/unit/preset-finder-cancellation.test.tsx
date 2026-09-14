import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { act } from 'react';
import { setAudioEnergy } from '../../src/js/frontend/engine-audio-energy-store.ts';
import { PresetFinderPanel } from '../../src/js/frontend/PresetFinderPanel.tsx';
import {
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

/**
 * Cancellation discipline for the finder's searches.
 *
 * A sound search listens for 2.5 seconds, so it is the one search that is
 * realistically still running when the user switches tabs or closes the
 * panel. These tests hold the collection window open with fake timers and
 * assert the teardown story: unmount clears the pending window, switching
 * modes cancels the old window instead of letting it finish, and neither a
 * superseded run's results nor its cleanup may touch the state that now
 * belongs to its replacement.
 *
 * With the optional search API unavailable (the localhost case) the network
 * step answers immediately, so the window timer, the teardown timer count,
 * and the rendered state are what the assertions observe.
 */

let active: RenderedWorkspace | null = null;

const mountFinder = () => {
  const stage = document.createElement('div');
  stage.appendChild(document.createElement('canvas'));
  active = renderWorkspace(
    <PresetFinderPanel initialMode="sound" onClose={() => {}} />,
    {
      ui: { stageRef: { current: stage } },
    },
  );
  return active;
};

const switchMode = async (panel: RenderedWorkspace, value: string) => {
  const input = panel.container.querySelector<HTMLInputElement>(
    `input[value="${value}"]`,
  );
  if (!input) throw new Error(`no finder-mode radio for "${value}"`);
  await act(async () => {
    input.click();
  });
};

describe('PresetFinderPanel cancellation', () => {
  beforeEach(() => {
    setAudioEnergy(0.5);
  });

  afterEach(() => {
    active?.dispose();
    active = null;
    jest.useRealTimers();
    localStorage.clear();
    setAudioEnergy(0);
  });

  test('a sound search left alone collects and then settles', async () => {
    jest.useFakeTimers();
    const panel = mountFinder();

    expect(panel.text()).toContain('Analysing audio…');
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(panel.text()).toContain('No matches found');
    expect(panel.text()).not.toContain('Analysing audio…');
  });

  test('unmounting mid-window cancels the pending collection timer', async () => {
    jest.useFakeTimers();
    const panel = mountFinder();
    expect(jest.getTimerCount()).toBe(1);

    panel.dispose();
    active = null;
    expect(jest.getTimerCount()).toBe(0);

    // The aborted window rejects after teardown; nothing may resurface.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
  });

  test('a superseded run cannot touch its replacement run', async () => {
    jest.useFakeTimers();
    const panel = mountFinder();

    // Run 1 is one second into its window.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    // Switching to By look supersedes run 1; without the search API, the
    // look search fails fast and that error is the honest state.
    await switchMode(panel, 'look');
    expect(jest.getTimerCount()).toBe(0);
    expect(panel.text()).toContain('Visual search API is unavailable');

    // Back to sound: run 3 owns the loading state now.
    await switchMode(panel, 'sound');
    expect(jest.getTimerCount()).toBe(1);
    expect(panel.text()).toContain('Analysing audio…');

    // Past run 1's original deadline: neither its results nor its cleanup
    // may land on run 3's state.
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });
    expect(panel.text()).toContain('Analysing audio…');
    expect(panel.text()).not.toContain('No matches found');
    expect(panel.text()).not.toContain('Visual search API is unavailable');

    // Run 3's own window completes normally.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(panel.text()).toContain('No matches found');
    expect(panel.text()).not.toContain('Analysing audio…');
  });
});
