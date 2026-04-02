import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { initQuickstartCta } from '../assets/js/bootstrap/quickstart-cta.ts';
import toyManifest from '../assets/js/data/toy-manifest.ts';

describe('quickstart random pool fallback', () => {
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

  test('falls back to the available catalog when the energetic pool is empty', () => {
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
    expect(selectedSlug).toBe('milkdrop');
  });
});

describe('quickstart edge-case random selection', () => {
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

  test('clamps the random index so a single-entry catalog still resolves a toy', () => {
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
    expect(selectedSlug).toBe('milkdrop');
  });
});
