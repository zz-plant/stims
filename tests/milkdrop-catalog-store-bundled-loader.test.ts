import { afterEach, expect, mock, test } from 'bun:test';
import { createBundledCatalogLoader } from '../assets/js/milkdrop/catalog-store-bundled-loader.ts';
import { replaceProperty } from './test-helpers.ts';

const originalFetch = globalThis.fetch;
let restoreLocation = () => {};

afterEach(() => {
  mock.restore();
  globalThis.fetch = originalFetch;
  restoreLocation();
  restoreLocation = () => {};
});

test('bundled catalog loader appends certification-only presets when the certification corpus is requested', async () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL('http://localhost/milkdrop/?corpus=certification'),
  );

  const fetchMock = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/milkdrop-presets/catalog.json')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            presets: [
              {
                id: 'aurora-feedback-core',
                title: 'Aurora Feedback Core',
                file: '/milkdrop-presets/aurora-feedback-core.milk',
              },
            ],
          }),
        ),
      );
    }

    if (
      url.endsWith('/assets/data/milkdrop-parity/certification-corpus.json')
    ) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            presets: [
              {
                id: 'aurora-feedback-core',
                title: 'Aurora Feedback Core',
                file: 'aurora-feedback-core.milk',
                fixtureRoot: 'public/milkdrop-presets',
                sourceFamily: 'bundled',
                strata: ['feedback'],
              },
              {
                id: '100-square',
                title: '100 Square',
                file: '100-square.milk',
                fixtureRoot:
                  'tests/fixtures/milkdrop/projectm-upstream/presets/tests',
                sourceFamily: 'projectm-fixture',
                strata: ['geometry'],
              },
            ],
          }),
        ),
      );
    }

    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const loader = createBundledCatalogLoader({
    catalogUrl: '/milkdrop-presets/catalog.json',
  });
  const entries = await loader.getBundledCatalog();

  expect(entries.map((entry) => entry.id)).toEqual([
    'aurora-feedback-core',
    '100-square',
  ]);
  expect(entries[1]).toMatchObject({
    id: '100-square',
    file: '/tests/fixtures/milkdrop/projectm-upstream/presets/tests/100-square.milk',
    certification: 'certified',
    corpusTier: 'certified',
  });
});

test('bundled catalog loader stays on the shipped catalog when no certification corpus is requested', async () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL('http://localhost/milkdrop/'),
  );

  const fetchMock = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/milkdrop-presets/catalog.json')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            presets: [
              {
                id: 'aurora-feedback-core',
                title: 'Aurora Feedback Core',
                file: '/milkdrop-presets/aurora-feedback-core.milk',
              },
            ],
          }),
        ),
      );
    }

    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const loader = createBundledCatalogLoader({
    catalogUrl: '/milkdrop-presets/catalog.json',
  });
  const entries = await loader.getBundledCatalog();

  expect(entries.map((entry) => entry.id)).toEqual(['aurora-feedback-core']);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
