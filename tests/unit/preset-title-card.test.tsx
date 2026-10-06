import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { act, createElement } from 'react';
import {
  resetStageOverlayPreferenceState,
  setStageOverlayPreference,
} from '../../src/js/core/stage-overlay-preferences.ts';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import {
  fitTitleStretch,
  PresetTitleCard,
  TITLE_CARD_HOLD_MS,
  TITLE_STRETCH_MAX,
  TITLE_STRETCH_MIN,
  TITLE_STRETCH_WRAPPED,
} from '../../src/js/frontend/PresetTitleCard.tsx';
import {
  makePresetEntry,
  makeUiValue,
  renderWorkspace,
} from '../frontend-harness.tsx';

/**
 * The title card names the preset the engine is rendering, large, for a few
 * seconds. What matters is when it must NOT speak: with no trustworthy name,
 * over an open panel, or when the viewer switched it off.
 */

const TITLE_CARD_KEY = 'stims:overlay:title-card';
const CARD = '.stims-shell__title-card';

beforeEach(() => {
  localStorage.removeItem(TITLE_CARD_KEY);
  resetStageOverlayPreferenceState();
});

afterEach(() => {
  jest.useRealTimers();
});

const preset = makePresetEntry({
  id: 'krash-cerebral',
  title: 'Krash & Rovastar - Cerebral Demons (Stars Remix)',
  author: 'Krash',
});

function mount({
  activePresetId = preset.id,
  selectedPreset = preset,
  panel = null as string | null,
} = {}) {
  const baseUi = makeUiValue();
  return renderWorkspace(createElement(PresetTitleCard), {
    snapshot: { ...createEmptyEngineSnapshot(), activePresetId },
    engine: { selectedPreset },
    ui: {
      routeState: { ...baseUi.routeState, panel } as typeof baseUi.routeState,
    },
  });
}

describe('PresetTitleCard', () => {
  test('sets the playing preset as a title with its byline split off', () => {
    const rendered = mount();
    const card = rendered.container.querySelector(CARD);
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Cerebral Demons (Stars Remix)');
    expect(card?.textContent).toContain('Krash + Rovastar');
    // The dock's title button is the accessible name; this is decoration.
    expect(card?.getAttribute('aria-hidden')).toBe('true');
    rendered.dispose();
  });

  test('leaves, then unmounts, after the hold', () => {
    jest.useFakeTimers();
    const rendered = mount();
    act(() => {
      jest.advanceTimersByTime(TITLE_CARD_HOLD_MS + 10);
    });
    expect(
      rendered.container.querySelector<HTMLElement>(CARD)?.dataset.leaving,
    ).toBe('true');
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(rendered.container.querySelector(CARD)).toBeNull();
    rendered.dispose();
  });

  test('says nothing when the selection does not name the rendered preset', () => {
    const rendered = mount({
      selectedPreset: makePresetEntry({ id: 'something-else' }),
    });
    expect(rendered.container.querySelector(CARD)).toBeNull();
    rendered.dispose();
  });

  test('stays out of the way while a panel is open', () => {
    const rendered = mount({ panel: 'browse' });
    expect(rendered.container.querySelector(CARD)).toBeNull();
    rendered.dispose();
  });

  test('respects the Settings switch', () => {
    setStageOverlayPreference({ presetTitleCard: false });
    const rendered = mount();
    expect(rendered.container.querySelector(CARD)).toBeNull();
    rendered.dispose();
  });
});

/**
 * The width fit, against a stand-in for layout. Real glyph widths do not
 * scale linearly with the width axis — the spaces and side bearings change
 * less than the strokes — so the model is affine, and `scrollWidth` rounds
 * up to whole pixels. A fit that assumed linearity, or trusted its rounded
 * guess, lands a pixel or two over the line, and the card's ellipsis then
 * clips the last letter.
 */
function nameOfWidth(naturalAt100: number) {
  return (stretch: number) =>
    Math.ceil(naturalAt100 * (0.3 + (0.7 * stretch) / 100));
}

describe('fitTitleStretch', () => {
  test('condenses a long name onto one line, without running over it', () => {
    const measure = nameOfWidth(1000);
    const fit = fitTitleStretch(measure, 808);
    expect(fit.wrap).toBe(false);
    expect(fit.stretch).toBeLessThan(100);
    expect(measure(fit.stretch)).toBeLessThanOrEqual(808);
    // ...and uses the line rather than over-condensing.
    expect(measure(fit.stretch + 1)).toBeGreaterThan(808);
  });

  test('opens a short name up, but only so far', () => {
    const fit = fitTitleStretch(nameOfWidth(240), 808);
    expect(fit).toEqual({ stretch: TITLE_STRETCH_MAX, wrap: false });
  });

  test('wraps a name too long for one line even fully condensed', () => {
    const measure = nameOfWidth(1600);
    expect(measure(TITLE_STRETCH_MIN)).toBeGreaterThan(808);
    expect(fitTitleStretch(measure, 808)).toEqual({
      stretch: TITLE_STRETCH_WRAPPED,
      wrap: true,
    });
  });

  test('never settles on a width that overflows, across name lengths', () => {
    for (let natural = 300; natural <= 1250; natural += 37) {
      const measure = nameOfWidth(natural);
      const fit = fitTitleStretch(measure, 808);
      if (!fit.wrap) expect(measure(fit.stretch)).toBeLessThanOrEqual(808);
    }
  });

  test('leaves the name alone when there is no layout to measure', () => {
    expect(fitTitleStretch(() => 0, 808)).toEqual({
      stretch: 100,
      wrap: false,
    });
    expect(fitTitleStretch(nameOfWidth(500), 0)).toEqual({
      stretch: 100,
      wrap: false,
    });
  });
});
