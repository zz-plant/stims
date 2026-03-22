export const LIBRARY_RENDER_BATCH_SIZE = 24;
export const LIBRARY_INITIAL_RENDER_COUNT = 24;

export const applyCardMotionVariant = (card, index) => {
  if (!(card instanceof HTMLElement)) return;
  const variants = [
    'card-motion--rise',
    'card-motion--tilt',
    'card-motion--glide',
    'card-motion--bloom',
  ];
  card.classList.remove(...variants);
  card.classList.add(variants[index % variants.length]);
  card.style.setProperty('--card-enter-delay', `${index * 45}ms`);
};

export const createLibraryListRenderer = ({
  document,
  windowObject = window,
  targetId,
  getToyKey,
  createCard,
  renderGrowthPanels,
  createEmptyState,
  onCardsRendered,
}) => {
  let pendingBatchHandle = 0;
  let activeRenderToken = 0;
  let renderedCardMap = new Map();
  let lastRenderedQuery = '';

  const getToyList = () => document.getElementById(targetId);

  const cancelPendingBatch = () => {
    if (!pendingBatchHandle) return;
    if (typeof windowObject.cancelIdleCallback === 'function') {
      windowObject.cancelIdleCallback(pendingBatchHandle);
    } else {
      windowObject.clearTimeout(pendingBatchHandle);
    }
    pendingBatchHandle = 0;
  };

  const render = ({ listToRender, query, queryTokens }) => {
    const list = getToyList();
    if (!list) return;

    cancelPendingBatch();
    activeRenderToken += 1;
    const renderToken = activeRenderToken;
    const shouldRebuildCards = lastRenderedQuery !== query;
    if (shouldRebuildCards) {
      renderedCardMap = new Map();
    }

    if (listToRender.length === 0) {
      renderedCardMap.clear();
      const fragment = document.createDocumentFragment();
      fragment.appendChild(createEmptyState());
      list.replaceChildren(fragment);
      onCardsRendered([], []);
      lastRenderedQuery = query;
      return;
    }

    const nextCardMap = new Map();
    const cards = [];
    listToRender.forEach((toy, index) => {
      const key = getToyKey(toy, index);
      const card = renderedCardMap.get(key) ?? createCard(toy, queryTokens);
      applyCardMotionVariant(card, index);
      nextCardMap.set(key, card);
      cards.push(card);
    });

    renderedCardMap = nextCardMap;
    lastRenderedQuery = query;

    const appendBatch = (count) => {
      if (renderToken !== activeRenderToken) return;
      const fragment = document.createDocumentFragment();
      renderGrowthPanels(fragment);
      cards.slice(0, count).forEach((card) => {
        fragment.appendChild(card);
      });
      list.replaceChildren(fragment);
      onCardsRendered(cards.slice(0, count), listToRender.slice(0, count));
    };

    const scheduleRemainingBatches = (count) => {
      if (count >= cards.length) return;
      const nextCount = Math.min(
        cards.length,
        count + LIBRARY_RENDER_BATCH_SIZE,
      );
      const commit = () => {
        pendingBatchHandle = 0;
        if (renderToken !== activeRenderToken) return;
        const fragment = document.createDocumentFragment();
        cards.slice(count, nextCount).forEach((card) => {
          fragment.appendChild(card);
        });
        list.appendChild(fragment);
        onCardsRendered(
          cards.slice(0, nextCount),
          listToRender.slice(0, nextCount),
        );
        scheduleRemainingBatches(nextCount);
      };

      if (typeof windowObject.requestIdleCallback === 'function') {
        pendingBatchHandle = windowObject.requestIdleCallback(commit, {
          timeout: 300,
        });
        return;
      }
      pendingBatchHandle = windowObject.setTimeout(commit, 32);
    };

    const initialCount = Math.min(cards.length, LIBRARY_INITIAL_RENDER_COUNT);
    appendBatch(initialCount);
    scheduleRemainingBatches(initialCount);
  };

  return {
    render,
    cancelPendingBatch,
  };
};
