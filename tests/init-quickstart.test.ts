import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import toyManifest from '../assets/js/data/toy-manifest.ts';
import { initQuickstartCta } from '../assets/js/utils/init-quickstart.ts';

const energeticTags = new Set([
  'energetic',
  'high-energy',
  'party',
  'hype',
  'dance',
  'neon',
  'pulse',
  'pulsing',
]);

const calmingTags = new Set([
  'calming',
  'calm',
  'serene',
  'ambient',
  'focus',
  'grounded',
]);

const isEnergetic = (slug: string) => {
  const toy = toyManifest.find((entry) => entry.slug === slug);
  if (!toy) return false;
  const metadata = [...(toy.moods ?? []), ...(toy.tags ?? [])].map((value) =>
    value.toLowerCase(),
  );
  return metadata.some((value) => energeticTags.has(value));
};

const isCalming = (slug: string) => {
  const toy = toyManifest.find((entry) => entry.slug === slug);
  if (!toy) return false;
  const metadata = [...(toy.moods ?? []), ...(toy.tags ?? [])].map((value) =>
    value.toLowerCase(),
  );
  return metadata.some((value) => calmingTags.has(value));
};

describe('quickstart energetic pool', () => {
  const originalRandom = Math.random;

  beforeEach(() => {
    document.body.innerHTML =
      '<a href="#" data-quickstart-mode="random" data-quickstart-pool="energetic">Surprise me</a>';
    mock.restore();
  });

  afterEach(() => {
    Math.random = originalRandom;
    document.body.innerHTML = '';
    mock.restore();
  });

  test('filters random energetic picks to energetic-tagged toys only', () => {
    const loadToy = mock();

    Math.random = () => 1 / toyManifest.length;

    initQuickstartCta({
      loadToy:
        loadToy as unknown as typeof import('../assets/js/loader.ts').loadToy,
    });

    const cta = document.querySelector('[data-quickstart-pool="energetic"]');
    expect(cta).not.toBeNull();
    cta?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(loadToy).toHaveBeenCalledTimes(1);

    const selectedSlug = loadToy.mock.calls[0]?.[0] as string;
    expect(selectedSlug).not.toBe('aurora-painter');
    expect(isEnergetic(selectedSlug)).toBe(true);
  });
});

describe('quickstart calming pool', () => {
  const originalRandom = Math.random;

  beforeEach(() => {
    document.body.innerHTML =
      '<a href="#" data-quickstart-mode="random" data-quickstart-pool="calming">Start flow mode</a>';
    mock.restore();
  });

  afterEach(() => {
    Math.random = originalRandom;
    document.body.innerHTML = '';
    mock.restore();
  });

  test('filters random calming picks to calming-tagged toys only', () => {
    const loadToy = mock();

    Math.random = () => 1 / toyManifest.length;

    initQuickstartCta({
      loadToy:
        loadToy as unknown as typeof import('../assets/js/loader.ts').loadToy,
    });

    const cta = document.querySelector('[data-quickstart-pool="calming"]');
    expect(cta).not.toBeNull();
    cta?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(loadToy).toHaveBeenCalledTimes(1);

    const selectedSlug = loadToy.mock.calls[0]?.[0] as string;
    expect(isCalming(selectedSlug)).toBe(true);
  });
});
