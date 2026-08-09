import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { AudioSourcePanel } from '../../src/js/frontend/AudioSourcePanel.tsx';
import { BrowseSheetPanel } from '../../src/js/frontend/BrowseSheetPanel.tsx';
import { StageControls } from '../../src/js/frontend/StageControls.tsx';
import { PresetRowRenderer } from '../../src/js/milkdrop/overlay/preset-row.ts';
import { makePresetEntry, renderWorkspace } from '../frontend-harness.tsx';
import { makeCatalogEntry } from '../milkdrop-fixtures.ts';

/**
 * These assert the accessibility contract against rendered DOM rather than
 * component source text, so they fail when the user-facing behavior regresses
 * and stay quiet when the implementation is refactored.
 */

describe('Accessibility regression guards', () => {
  test('panel toggle buttons expose expanded state, not pressed', () => {
    const rendered = renderWorkspace(
      createElement(StageControls, {
        isFullscreen: false,
        onToggleFullscreen: () => {},
      }),
    );

    const toggles = rendered.container.querySelectorAll('[aria-expanded]');
    expect(toggles.length).toBeGreaterThan(0);
    expect(rendered.container.querySelectorAll('[aria-pressed]').length).toBe(
      0,
    );

    rendered.dispose();
  });

  test('the overflow menu toggle reports its open state', () => {
    const rendered = renderWorkspace(
      createElement(StageControls, {
        isFullscreen: false,
        onToggleFullscreen: () => {},
      }),
    );

    const toggle =
      rendered.container.querySelector<HTMLButtonElement>('[aria-expanded]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    rendered.click(toggle);

    expect(
      rendered.container
        .querySelector('[aria-expanded]')
        ?.getAttribute('aria-expanded'),
    ).toBe('true');

    rendered.dispose();
  });

  test('browse sheet controls have accessible names', () => {
    const preset = makePresetEntry();
    const rendered = renderWorkspace(createElement(BrowseSheetPanel), {
      engine: { catalog: [preset], filteredCatalog: [preset] },
    });

    expect(rendered.byLabel('Search presets')).not.toBeNull();
    expect(rendered.byLabel('Sort presets')).not.toBeNull();
    expect(rendered.byLabel('Preset collections')).not.toBeNull();

    rendered.dispose();
  });

  test('every browse control is reachable by an accessible name', () => {
    const preset = makePresetEntry();
    const rendered = renderWorkspace(createElement(BrowseSheetPanel), {
      engine: { catalog: [preset], filteredCatalog: [preset] },
    });

    const unnamed = [
      ...rendered.container.querySelectorAll('button, select, input'),
    ].filter((node) => {
      if (node.getAttribute('aria-label')?.trim()) return false;
      if (node.getAttribute('aria-labelledby')?.trim()) return false;
      if (node.getAttribute('title')?.trim()) return false;
      if ((node.textContent ?? '').trim()) return false;
      if (
        node.id &&
        rendered.container.querySelector(`label[for="${node.id}"]`)
      )
        return false;
      return true;
    });

    expect(unnamed.map((node) => node.outerHTML)).toEqual([]);

    rendered.dispose();
  });

  test('audio setup surface keeps source changes in a polite live region', () => {
    const rendered = renderWorkspace(createElement(AudioSourcePanel));

    const live = rendered.container.querySelector('[aria-live]');
    expect(live?.getAttribute('aria-live')).toBe('polite');

    rendered.dispose();
  });

  test('milkdrop preset rows expose current and load labels', () => {
    const renderer = new PresetRowRenderer({
      onSelectPreset: () => {},
      onToggleFavorite: () => {},
      onSetRating: () => {},
    });

    const active = renderer.render({
      preset: makeCatalogEntry(),
      activePresetId: 'preset-alpha',
      activeBackend: 'webgl',
      preview: null,
    });
    const inactive = renderer.render({
      preset: makeCatalogEntry({ id: 'preset-beta', title: 'Beta' }),
      activePresetId: 'preset-alpha',
      activeBackend: 'webgl',
      preview: null,
    });

    expect(active.getAttribute('aria-current')).toBe('true');
    expect(inactive.getAttribute('aria-current')).toBeNull();

    const label = inactive.getAttribute('aria-label') ?? inactive.textContent;
    expect(label).toContain('Beta');
  });
});
