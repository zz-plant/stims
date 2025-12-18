type WindowLike = Window & typeof globalThis;

export function createRouter({
  window: providedWindow = typeof window !== 'undefined' ? window : null,
  queryParam = 'toy',
  loadToy,
  onLibraryRoute,
}: {
  window?: WindowLike | null;
  queryParam?: string;
  loadToy?: (slug: string) => Promise<void> | void;
  onLibraryRoute?: () => void;
} = {}) {
  let navigationInitialized = false;
  const getWindow = () => providedWindow ?? null;

  const pushToyState = (slug: string) => {
    const win = getWindow();
    if (!win?.history) return;

    const url = new URL(win.location.href);
    url.searchParams.set(queryParam, slug);
    win.history.pushState({ [queryParam]: slug }, '', url);
  };

  const updateHistoryToLibraryView = () => {
    const win = getWindow();
    if (!win?.history) return;

    const url = new URL(win.location.href);
    if (!url.searchParams.has(queryParam)) {
      return;
    }

    url.searchParams.delete(queryParam);
    win.history.pushState({}, '', url);
  };

  const loadFromQuery = async () => {
    const win = getWindow();
    if (!win?.location) return;

    const params = new URLSearchParams(win.location.search);
    const slug = params.get(queryParam);

    if (slug && typeof loadToy === 'function') {
      await loadToy(slug);
    } else if (!slug && typeof onLibraryRoute === 'function') {
      onLibraryRoute();
    }
  };

  const initNavigation = () => {
    const win = getWindow();
    if (!win || navigationInitialized) return;

    navigationInitialized = true;
    win.addEventListener('popstate', () => {
      void loadFromQuery();
    });
  };

  return {
    pushToyState,
    loadFromQuery,
    initNavigation,
    updateHistoryToLibraryView,
  };
}
