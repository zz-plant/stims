import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { initMilkdropShowcase } from '../assets/js/utils/init-milkdrop-showcase.ts';

describe('initMilkdropShowcase', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    document.body.innerHTML = `
      <p data-milkdrop-preset-count>Loading bundled preset collections…</p>
      <div data-milkdrop-preset-filters>
        <button type="button">Fallback collection</button>
      </div>
      <div data-milkdrop-preset-list>
        <article>Fallback preset</article>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('hydrates preset collections and launch cards from the bundled catalog', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        presets: [
          {
            id: 'kinetic-grid-pulse',
            title: 'Kinetic Grid Pulse',
            order: 2,
            preview: true,
            tags: ['collection:feedback-lab', 'grid'],
          },
          {
            id: 'aurora-feedback-core',
            title: 'Aurora Feedback Core',
            order: 1,
            preview: true,
            author: 'Stims Curated',
            tags: ['collection:classic-milkdrop', 'feedback', 'warp'],
          },
          {
            id: 'low-motion-halo-drift',
            title: 'Low Motion Halo Drift',
            order: 3,
            preview: false,
            tags: ['collection:low-motion', 'ambient'],
          },
        ],
      }),
    })) as unknown as typeof fetch;

    await initMilkdropShowcase();

    const count = document.querySelector('[data-milkdrop-preset-count]');
    const filters = Array.from(
      document.querySelectorAll('[data-milkdrop-preset-filters] button'),
    ).map((button) => button.textContent?.replace(/\s+/gu, ' ').trim());
    const cards = Array.from(
      document.querySelectorAll(
        '[data-milkdrop-preset-list] .milkdrop-showcase__card-title',
      ),
    ).map((card) => card.textContent?.trim());

    expect(count?.textContent).toBe(
      '3 bundled presets. 3 quick collections. 1 shown from Classic MilkDrop.',
    );
    expect(filters).toEqual([
      'All presets3',
      'Classic MilkDrop1',
      'Feedback Lab1',
      'Low Motion1',
    ]);
    expect(cards).toEqual(['Aurora Feedback Core']);
  });

  test('keeps fallback markup when the catalog cannot be fetched', async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
    })) as unknown as typeof fetch;

    await initMilkdropShowcase();

    const count = document.querySelector('[data-milkdrop-preset-count]');
    const cards = Array.from(
      document.querySelectorAll('[data-milkdrop-preset-list] article'),
    ).map((card) => card.textContent?.trim());

    expect(count?.textContent).toBe('Loading bundled preset collections…');
    expect(cards).toEqual(['Fallback preset']);
  });
});
