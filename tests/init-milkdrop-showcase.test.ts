import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { initMilkdropShowcase } from '../assets/js/bootstrap/milkdrop-showcase.ts';

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
            tags: [
              'collection:cream-of-the-crop',
              'collection:classic-milkdrop',
              'feedback',
              'warp',
            ],
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
      '3 bundled presets across 2 quick collections. Showing 1 featured picks from Cream of the Crop.',
    );
    expect(filters).toEqual([
      'All presets3',
      'Cream of the Crop1',
      'Classic MilkDrop1',
    ]);
    expect(cards).toEqual(['Aurora Feedback Core']);
    expect(
      document
        .querySelector('[data-milkdrop-preset-list] .cta-button')
        ?.getAttribute('href'),
    ).toBe(
      '/milkdrop/?audio=demo&panel=browse&preset=aurora-feedback-core&collection=cream-of-the-crop',
    );
  });

  test('builds launch links from the rendered preset collection instead of a hardcoded default', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        presets: [
          {
            id: 'kinetic-grid-pulse',
            title: 'Kinetic Grid Pulse',
            order: 1,
            preview: true,
            tags: ['collection:feedback-lab', 'grid'],
          },
        ],
      }),
    })) as unknown as typeof fetch;

    await initMilkdropShowcase();

    expect(
      document
        .querySelector('[data-milkdrop-preset-list] .cta-button')
        ?.getAttribute('href'),
    ).toBe(
      '/milkdrop/?audio=demo&panel=browse&preset=kinetic-grid-pulse&collection=feedback-lab',
    );
  });

  test('uses the active rendered collection when a preset belongs to multiple collections', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        presets: [
          {
            id: 'aurora-feedback-core',
            title: 'Aurora Feedback Core',
            order: 1,
            preview: true,
            tags: [
              'collection:classic-milkdrop',
              'collection:cream-of-the-crop',
              'feedback',
            ],
          },
        ],
      }),
    })) as unknown as typeof fetch;

    await initMilkdropShowcase();

    expect(
      document
        .querySelector('[data-milkdrop-preset-list] .cta-button')
        ?.getAttribute('href'),
    ).toBe(
      '/milkdrop/?audio=demo&panel=browse&preset=aurora-feedback-core&collection=cream-of-the-crop',
    );
  });

  test('shows the shipped Rovastar collection as a visible quick collection', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        presets: [
          {
            id: 'rovastar-parallel-universe',
            title: 'Rovastar - Parallel Universe',
            order: 1,
            preview: true,
            tags: [
              'collection:classic-milkdrop',
              'collection:cream-of-the-crop',
              'collection:rovastar-and-collaborators',
              'lasers',
            ],
          },
          {
            id: 'eos-glowsticks-v2-03-music',
            title: 'Eo.S. - Glowsticks v2 03 Music',
            order: 2,
            preview: true,
            tags: [
              'collection:classic-milkdrop',
              'collection:rovastar-and-collaborators',
              'glowsticks',
            ],
          },
        ],
      }),
    })) as unknown as typeof fetch;

    await initMilkdropShowcase();

    const filters = Array.from(
      document.querySelectorAll('[data-milkdrop-preset-filters] button'),
    ).map((button) => button.textContent?.replace(/\s+/gu, ' ').trim());

    expect(filters).toEqual([
      'All presets2',
      'Classic MilkDrop2',
      'Cream of the Crop1',
      'Rovastar and collaborators2',
    ]);
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
