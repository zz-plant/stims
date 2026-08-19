import { describe, expect, test } from 'bun:test';
import {
  type PanelState,
  parseURLParams,
} from '../../src/js/core/url-params.ts';

/**
 * Every PanelState must be URL-addressable. 'refine', 'finder', and
 * 'synthesize' were silently missing from VALID_PANELS, so the AI panels
 * could not be linked or restored on reload. This is the guard that keeps a
 * newly added panel from shipping unaddressable the same way.
 */

function panelFor(search: string) {
  return parseURLParams(`https://toil.fyi/?${search}`).routing.panel;
}

function invalidPanelFor(search: string) {
  return parseURLParams(`https://toil.fyi/?${search}`).routing.invalidPanel;
}

describe('panel URL addressability', () => {
  const ALL_PANELS: Array<Exclude<PanelState, null>> = [
    'browse',
    'capture',
    'editor',
    'finder',
    'refine',
    'settings',
    'synthesize',
  ];
  for (const panel of ALL_PANELS) {
    test(`?tool=${panel} round-trips`, () => {
      expect(panelFor(`tool=${panel}`)).toBe(panel);
      expect(invalidPanelFor(`tool=${panel}`)).toBeNull();
    });
  }

  test('?panel= is accepted as an alias for ?tool=', () => {
    expect(panelFor('panel=refine')).toBe('refine');
  });

  test('the legacy looks alias still maps to browse', () => {
    expect(panelFor('tool=looks')).toBe('browse');
    expect(invalidPanelFor('tool=looks')).toBeNull();
  });

  test('panel names are case- and whitespace-insensitive', () => {
    expect(panelFor('tool=%20Synthesize%20')).toBe('synthesize');
  });

  test('an unknown panel is reported rather than silently dropped', () => {
    expect(panelFor('tool=nonsense')).toBeNull();
    expect(invalidPanelFor('tool=nonsense')).toBe('nonsense');
  });

  test('the retired audiomatch id reads as unknown, not as finder', () => {
    // It was never URL-addressable, so no real link can carry it; if one
    // does, saying so beats quietly opening a panel the link did not name.
    expect(invalidPanelFor('tool=audiomatch')).toBe('audiomatch');
  });

  test('no panel param means no panel and no complaint', () => {
    expect(panelFor('preset=signal-bloom')).toBeNull();
    expect(invalidPanelFor('preset=signal-bloom')).toBeNull();
  });
});
