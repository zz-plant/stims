import { afterEach, describe, expect, test } from 'bun:test';
import {
  isWatchHudActive,
  MAX_WATCHED_VARIABLES,
  setWatchedVariables,
  toggleWatcherHud,
} from '../../src/js/milkdrop/overlay/watcher-hud.ts';
import { publishVariables } from '../../src/js/milkdrop/variable-probe.ts';

/**
 * The stage watch HUD is the "watch variables at display rate" instrument
 * from the roadmap: it must live over the stage, plot exactly the pinned
 * set, cost nothing while off, and keep its watch set when the editor
 * closes (simulated here by toggling with no editor mounted at all).
 */

const sleep = async (ms: number) =>
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Wait for the rAF loop to paint at least once, and the label clock. */
const settle = async () => {
  await sleep(40);
  await sleep(240);
};

describe('stage watch HUD', () => {
  const stage = document.createElement('div');
  document.body.appendChild(stage);

  afterEach(() => {
    while (isWatchHudActive()) expect(toggleWatcherHud(stage)).toBe(false);
    setWatchedVariables([]);
  });

  test('toggles over the stage and costs nothing while off', () => {
    expect(isWatchHudActive()).toBe(false);
    publishVariables({ q1: 1 });
    expect(toggleWatcherHud(stage)).toBe(true);
    const hud = stage.querySelector('.stims-watch-hud');
    expect(hud).not.toBeNull();
    expect(isWatchHudActive()).toBe(true);

    expect(toggleWatcherHud(stage)).toBe(false);
    expect(stage.querySelector('.stims-watch-hud')).toBeNull();
    expect(isWatchHudActive()).toBe(false);
    // Off means off: no listener survives the detach.
    publishVariables({ q1: 2 });
    expect(stage.querySelector('.stims-watch-hud')).toBeNull();
  });

  test('with no stage the toggle is a no-op that reports off', () => {
    expect(toggleWatcherHud(null)).toBe(false);
    expect(isWatchHudActive()).toBe(false);
  });

  test('plots exactly the watched variables, with live values', async () => {
    setWatchedVariables(['zoom', 'q1']);
    expect(toggleWatcherHud(stage)).toBe(true);

    const hud = stage.querySelector('.stims-watch-hud') as HTMLElement;
    expect(hud?.hidden).toBeFalsy();
    const names = () =>
      Array.from(hud.querySelectorAll('.stims-watch-hud__name')).map(
        (el) => el.textContent,
      );
    // The watched order is the pin order, not alphabetical.
    expect(names()).toEqual(['zoom', 'q1']);

    publishVariables({ zoom: 0.999, q1: 1.25 });
    await settle();
    const values = () =>
      Array.from(hud.querySelectorAll('.stims-watch-hud__value')).map(
        (el) => el.textContent,
      );
    expect(values()).toEqual(['0.999', '1.250']);

    // A frame only carries what the preset's equations touch; a watched
    // variable missing from one frame records a zero, like Inspect does.
    publishVariables({ q1: 4 });
    await settle();
    expect(values()).toEqual(['0', '4.000']);
  });

  test('shows its hint until something is watched, and drops unwatched rows', async () => {
    setWatchedVariables([]);
    expect(toggleWatcherHud(stage)).toBe(true);
    const hud = stage.querySelector('.stims-watch-hud') as HTMLElement;
    const hint = () =>
      hud?.querySelector<HTMLElement>('.stims-watch-hud__hint') ?? null;
    expect(hint()?.hidden).toBe(false);

    setWatchedVariables(['zoom']);
    expect(hint()?.hidden).toBe(true);
    expect(hud?.querySelectorAll('.stims-watch-hud__row')).toHaveLength(1);

    setWatchedVariables([]);
    expect(hud?.querySelectorAll('.stims-watch-hud__row')).toHaveLength(0);
    expect(hint()?.hidden).toBe(false);
  });

  test('bounds the watch list', () => {
    const many = Array.from(
      { length: MAX_WATCHED_VARIABLES + 4 },
      (_, i) => `q${i + 1}`,
    );
    setWatchedVariables(many);
    expect(toggleWatcherHud(stage)).toBe(true);
    const hud = stage.querySelector('.stims-watch-hud') as HTMLElement;
    expect(hud?.querySelectorAll('.stims-watch-hud__row')).toHaveLength(
      MAX_WATCHED_VARIABLES,
    );
    // The earliest pins win.
    expect(
      Array.from(hud.querySelectorAll('.stims-watch-hud__name')).map(
        (el) => el.textContent,
      ),
    ).toEqual(many.slice(0, MAX_WATCHED_VARIABLES));
  });

  test('keeps its watch set across an off/on cycle', async () => {
    setWatchedVariables(['q4']);
    expect(toggleWatcherHud(stage)).toBe(true);
    expect(toggleWatcherHud(stage)).toBe(false);
    expect(toggleWatcherHud(stage)).toBe(true);
    const hud = stage.querySelector('.stims-watch-hud') as HTMLElement;
    expect(hud?.querySelector('.stims-watch-hud__name')?.textContent).toBe(
      'q4',
    );
  });
});
