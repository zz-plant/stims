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
          {
            id: 'rovastar-parallel-universe',
            title: 'Rovastar - Parallel Universe',
            order: 1,
            preview: true,
            author: 'Rovastar',
            tags: [
              'collection:cream-of-the-crop',
              'collection:classic-milkdrop',
              'feedback',
              'collection:rovastar-and-collaborators',
            ],
          },
          {
            id: 'eos-phat-cubetrace-v2',
            title: 'Eo.S. + Phat - Cubetrace v2',
            order: 3,
            preview: false,
            tags: [
              'collection:cream-of-the-crop',
              'collection:classic-milkdrop',
              'geometry',
            ],
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
      '3 presets across 3 collections. Showing 1 from Cream of the Crop.',
    );
    expect(filters).toEqual([
      'All presets3',
      'Cream of the Crop2',
      'Classic MilkDrop3',
      'Rovastar and collaborators2',
    ]);
    expect(cards).toEqual(['Rovastar - Parallel Universe']);
    expect(
      document
        .querySelector('[data-milkdrop-preset-list] .cta-button')
        ?.getAttribute('href'),
    ).toBe(
      '/milkdrop/?audio=demo&panel=browse&preset=rovastar-parallel-universe&collection=cream-of-the-crop',
    );
  });

  test('builds launch links from the rendered preset collection instead of a hardcoded default', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        presets: [
          {
            id: 'eos-glowsticks-v2-03-music',
            title: 'Eo.S. - Glowsticks v2 03 Music',
            order: 1,
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

    expect(
      document
        .querySelector('[data-milkdrop-preset-list] .cta-button')
        ?.getAttribute('href'),
    ).toBe(
      '/milkdrop/?audio=demo&panel=browse&preset=eos-glowsticks-v2-03-music&collection=classic-milkdrop',
    );
  });

  test('uses the active rendered collection when a preset belongs to multiple collections', async () => {
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
      '/milkdrop/?audio=demo&panel=browse&preset=rovastar-parallel-universe&collection=cream-of-the-crop',
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
