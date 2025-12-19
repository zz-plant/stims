type WindowGetter = () => (Window & typeof globalThis) | null;

export function createRouter({
  windowRef = () => (typeof window === 'undefined' ? null : window),
  queryParam = 'toy',
}: { windowRef?: WindowGetter; queryParam?: string } = {}) {
  let isListening = false;

  const getWindow = () => windowRef();

  const getUrl = (win: Window & typeof globalThis) => new URL(win.location.href);

  const getCurrentSlug = () => {
    const win = getWindow();
    if (!win) return null;

    const params = new URLSearchParams(win.location.search);
    return params.get(queryParam);
  };

  const pushToyState = (slug: string) => {
    const win = getWindow();
    if (!win?.history) return;

    const url = getUrl(win);
    url.searchParams.set(queryParam, slug);
    win.history.pushState({ [queryParam]: slug }, '', url);
  };

  const goToLibrary = () => {
    const win = getWindow();
    if (!win?.history) return;

    const url = getUrl(win);
    if (!url.searchParams.has(queryParam)) return;

    url.searchParams.delete(queryParam);
    win.history.pushState({}, '', url);
  };

  const listen = (onChange: (slug: string | null) => void) => {
    const win = getWindow();
    if (!win || isListening) return () => {};

    isListening = true;

    const handler = () => {
      onChange(getCurrentSlug());
    };

    win.addEventListener('popstate', handler);

    return () => {
      win.removeEventListener('popstate', handler);
      isListening = false;
    };
  };

  return {
    getCurrentSlug,
    pushToyState,
    goToLibrary,
    listen,
  };
}
