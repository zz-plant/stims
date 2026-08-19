import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import { PresetSignals } from '../../src/js/frontend/PresetSignals.tsx';

function render(entry: PresetCatalogEntry, showReactivity = true) {
  return renderToStaticMarkup(
    createElement(PresetSignals, { entry, showReactivity }),
  );
}

function entry(over: Partial<PresetCatalogEntry> = {}): PresetCatalogEntry {
  return { id: 'p', title: 'P', ...over };
}

function withReactivity(score: number): PresetCatalogEntry {
  return entry({
    quality: { components: { measuredReactivity: score } },
  } as Partial<PresetCatalogEntry>);
}

describe('photosensitivity warning', () => {
  test('warns only for a measured high-risk preset', () => {
    const high = entry({
      sensoryProfile: {
        flashRiskLevel: 'high',
        maxTransitionsPerSecondEstimate: 5,
        meanLuminance: 0.4,
        maxLuminanceDelta: 0.2,
        measuredAt: '2026-08-19T00:00:00.000Z',
      },
    });
    expect(render(high)).toContain('Flashing');
  });

  test('a preset with no measurement shows no warning and no false calm', () => {
    const markup = render(entry());
    expect(markup).not.toContain('Flashing');
    // Critically, it also must not assert the opposite.
    expect(markup).not.toContain('No flashing');
  });

  test('a measured-calm preset still shows no warning chip', () => {
    const calm = entry({
      sensoryProfile: {
        flashRiskLevel: 'none',
        maxTransitionsPerSecondEstimate: 0,
        meanLuminance: 0.1,
        maxLuminanceDelta: 0.01,
        measuredAt: '2026-08-19T00:00:00.000Z',
      },
    });
    expect(render(calm)).not.toContain('Flashing');
  });

  test('the warning carries text, not only an icon', () => {
    const high = entry({
      sensoryProfile: {
        flashRiskLevel: 'high',
        maxTransitionsPerSecondEstimate: 9,
        meanLuminance: 0.4,
        maxLuminanceDelta: 0.3,
        measuredAt: '2026-08-19T00:00:00.000Z',
      },
    });
    const markup = render(high);
    // The ⚡ is decorative; a screen reader must still hear the word.
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toMatch(/>\s*Flashing/);
  });
});

describe('reactivity band', () => {
  test('bands split high / medium / low', () => {
    expect(render(withReactivity(0.95))).toContain('Strongly beat-reactive');
    expect(render(withReactivity(0.6))).toContain('Moderately reactive');
    expect(render(withReactivity(0.1))).toContain('Ambient');
  });

  test('an unmeasured preset shows no reactivity claim', () => {
    expect(render(entry())).toBe('');
  });

  test('suppressed where space is tightest', () => {
    expect(render(withReactivity(0.95), false)).toBe('');
  });
});

describe('against the shipped catalog', () => {
  test('real entries carry the reactivity field this reads', () => {
    // Guards the shape, not a value: if catalog generation ever stops
    // emitting quality.components.measuredReactivity, the chip would silently
    // vanish from every row rather than fail anything.
    const catalog = JSON.parse(
      readFileSync(
        join(
          import.meta.dir,
          '..',
          '..',
          'public',
          'milkdrop-presets',
          'catalog.json',
        ),
        'utf8',
      ),
    ) as { presets: Array<Record<string, unknown>> };

    const withMeasured = catalog.presets.filter((p) => {
      const q = p.quality as
        | { components?: { measuredReactivity?: number | null } }
        | undefined;
      return typeof q?.components?.measuredReactivity === 'number';
    });
    expect(withMeasured.length).toBeGreaterThan(0);

    const rendered = render(withMeasured[0] as unknown as PresetCatalogEntry);
    expect(rendered).not.toBe('');
  });
});
