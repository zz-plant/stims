import { describe, expect, test } from 'bun:test';

import { createLibraryDomCache } from '../assets/js/library-view/dom-cache.js';

describe('createLibraryDomCache', () => {
  test('retries lookup when a node was missing on first ensure call', () => {
    document.body.innerHTML = '<div id="stage"></div>';

    const cache = createLibraryDomCache(document);

    expect(cache.ensureSearchForm()).toBeNull();

    const form = document.createElement('form');
    form.setAttribute('data-search-form', '');
    document.getElementById('stage')?.appendChild(form);

    expect(cache.ensureSearchForm()).toBe(form);
  });

  test('reuses cached node once it exists', () => {
    document.body.innerHTML = '<form data-search-form></form>';

    const cache = createLibraryDomCache(document);
    const initial = cache.ensureSearchForm();
    const replacement = document.createElement('form');
    replacement.setAttribute('data-search-form', '');
    initial?.replaceWith(replacement);

    expect(cache.ensureSearchForm()).toBe(initial);
  });
});
