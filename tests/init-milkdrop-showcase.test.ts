import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { initMilkdropShowcase } from '../assets/js/utils/init-milkdrop-showcase.ts';

describe('initMilkdropShowcase', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    document.body.innerHTML = `
      <p data-milkdrop-preset-count>Loading curated preset pack…</p>
      <div data-milkdrop-preset-list>
        <span class="pill">Fallback preset</span>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('hydrates preset count and preset strip from the bundled catalog', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        presets: [
          { title: 'Kinetic Grid Pulse', order: 2, preview: true },
          { title: 'Aurora Feedback Core', order: 1, preview: true },
          { title: 'Low Motion Halo Drift', order: 3, preview: false },
        ],
      }),
    })) as unknown as typeof fetch;

    await initMilkdropShowcase();

    const count = document.querySelector('[data-milkdrop-preset-count]');
    const pills = Array.from(
      document.querySelectorAll('[data-milkdrop-preset-list] .pill'),
    ).map((pill) => pill.textContent?.trim());

    expect(count?.textContent).toBe('3 curated presets ship with Stims today.');
    expect(pills).toEqual(['Aurora Feedback Core', 'Kinetic Grid Pulse']);
  });

  test('keeps fallback markup when the catalog cannot be fetched', async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
    })) as unknown as typeof fetch;

    await initMilkdropShowcase();

    const count = document.querySelector('[data-milkdrop-preset-count]');
    const pills = Array.from(
      document.querySelectorAll('[data-milkdrop-preset-list] .pill'),
    ).map((pill) => pill.textContent?.trim());

    expect(count?.textContent).toBe('Loading curated preset pack…');
    expect(pills).toEqual(['Fallback preset']);
  });
});
