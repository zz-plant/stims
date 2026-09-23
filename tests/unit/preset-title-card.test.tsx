import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { act, createElement } from 'react';
import {
  resetStageOverlayPreferenceState,
  setStageOverlayPreference,
} from '../../src/js/core/stage-overlay-preferences.ts';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import {
  PresetTitleCard,
  TITLE_CARD_HOLD_MS,
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
