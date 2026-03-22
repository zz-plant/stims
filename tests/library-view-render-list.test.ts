import { beforeEach, expect, mock, test } from 'bun:test';

import {
  createLibraryListRenderer,
  type RenderListToy,
} from '../assets/js/library-view/render-list.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="toy-list"></div>';
});

const getToyKey = (toy: RenderListToy) => String(toy.slug ?? '');

test('batched renderer reuses cards while the query is unchanged', async () => {
  const createCard = mock((toy: RenderListToy) => {
    const card = document.createElement('article');
    card.className = 'webtoy-card';
    card.textContent = String(toy.title ?? '');
    return card;
  });

  const renderer = createLibraryListRenderer({
    document,
    windowObject: window,
    targetId: 'toy-list',
    getToyKey,
    createCard,
    renderGrowthPanels() {},
    createEmptyState() {
      const node = document.createElement('div');
      node.textContent = 'Empty';
      return node;
    },
    onCardsRendered() {},
  });

  const list = [
    { slug: 'a', title: 'Alpha' },
    { slug: 'b', title: 'Beta' },
  ];

  renderer.render({
    listToRender: list,
    query: 'alpha',
    queryTokens: ['alpha'],
  });
  const initialCards = Array.from(document.querySelectorAll('.webtoy-card'));
  expect(initialCards).toHaveLength(2);
  expect(createCard).toHaveBeenCalledTimes(2);

  renderer.render({
    listToRender: [...list].reverse(),
    query: 'alpha',
    queryTokens: ['alpha'],
  });
  const rerenderedCards = Array.from(document.querySelectorAll('.webtoy-card'));
  expect(createCard).toHaveBeenCalledTimes(2);
  expect(rerenderedCards[0]).toBe(initialCards[1]);
  expect(rerenderedCards[1]).toBe(initialCards[0]);
});

test('renderer rebuilds cards when the search query changes', () => {
  const createCard = mock((toy: RenderListToy) => {
    const card = document.createElement('article');
    card.className = 'webtoy-card';
    card.textContent = String(toy.title ?? '');
    return card;
  });

  const renderer = createLibraryListRenderer({
    document,
    windowObject: window,
    targetId: 'toy-list',
    getToyKey,
    createCard,
    renderGrowthPanels() {},
    createEmptyState() {
      return document.createElement('div');
    },
    onCardsRendered() {},
  });

  const list = [{ slug: 'a', title: 'Alpha' }];
  renderer.render({
    listToRender: list,
    query: 'alpha',
    queryTokens: ['alpha'],
  });
  renderer.render({ listToRender: list, query: 'beta', queryTokens: ['beta'] });

  expect(createCard).toHaveBeenCalledTimes(2);
});
