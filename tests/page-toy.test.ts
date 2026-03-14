import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import toyManifest from '../assets/js/data/toy-manifest.ts';
import {
  createManifestBackedPageToyStarter,
  startPageToy,
} from '../assets/js/toys/page-toy.ts';

const pageBackedSlugs = [
  'evol',
  'geom',
  'holy',
  'legible',
  'multi',
  'seary',
  'symph',
];

describe('page-toy starters', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="active-toy-container"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  for (const slug of pageBackedSlugs) {
    test(`manifest-backed starter creates iframe with manifest title for ${slug}`, () => {
      const start = createManifestBackedPageToyStarter(slug);
      const activeToy = start();
      const manifestEntry = toyManifest.find((toy) => toy.slug === slug);

      const iframe = document.querySelector(
        'iframe.toy-frame',
      ) as HTMLIFrameElement | null;
      expect(iframe).toBeTruthy();
      expect(iframe?.title).toBe(manifestEntry?.title);

      activeToy?.dispose?.();
    });
  }

  test('manifest-backed starter throws for unknown slug', () => {
    expect(() => createManifestBackedPageToyStarter('not-a-toy')).toThrow(
      'Unknown toy slug for page-backed starter: not-a-toy',
    );
  });

  test('startPageToy supports explicit path and title', () => {
    const activeToy = startPageToy({
      path: './toys/evol.html',
      title: 'Custom title',
      description: 'Custom description',
    });

    const iframe = document.querySelector(
      'iframe.toy-frame',
    ) as HTMLIFrameElement | null;
    expect(iframe?.title).toBe('Custom title');

    activeToy.dispose();
  });
});
