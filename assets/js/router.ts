type WindowGetter = () => (Window & typeof globalThis) | null;

export type Route =
  | { view: 'library'; slug: null }
  | { view: 'toy'; slug: string | null };

export function createRouter({
  windowRef = () => (typeof window === 'undefined' ? null : window),
  queryParam = 'toy',
  libraryPath = 'index.html',
  toyPath = 'toy.html',
}: {
  windowRef?: WindowGetter;
  queryParam?: string;
  libraryPath?: string;
  toyPath?: string;
} = {}) {
  let isListening = false;

  const getWindow = () => windowRef();

  const getBasePath = (pathname: string) => {
    if (pathname.endsWith('/')) return pathname;
    const lastSlash = pathname.lastIndexOf('/');
    return lastSlash >= 0 ? pathname.slice(0, lastSlash + 1) : '/';
  };

  const resolvePath = (pathname: string, target: string) => {
    if (target.startsWith('/')) return target;
    const base = getBasePath(pathname);
    return `${base}${target}`;
  };

  const getUrl = (win: Window & typeof globalThis) =>
    new URL(win.location.href);

  const getCurrentSlug = () => {
    const win = getWindow();
    if (!win) return null;

    const params = new URLSearchParams(win.location.search);
    return params.get(queryParam);
  };

  const isToyPath = (pathname: string) =>
    pathname === `/${toyPath}` ||
    pathname.endsWith(`/${toyPath}`) ||
    pathname.endsWith(toyPath);

  const getCurrentRoute = (): Route => {
    const win = getWindow();
    if (!win) return { view: 'library', slug: null };

    const url = getUrl(win);
    const slug = url.searchParams.get(queryParam);
    if (slug) {
      return { view: 'toy', slug };
    }

    if (isToyPath(url.pathname)) {
      return { view: 'toy', slug: null };
    }

    return { view: 'library', slug: null };
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
    const nextUrl = new URL(url.toString());
    nextUrl.searchParams.delete(queryParam);
    nextUrl.pathname = resolvePath(url.pathname, libraryPath);

    if (nextUrl.toString() === url.toString()) return;

    win.history.pushState({}, '', nextUrl);
  };

  const getLibraryHref = () => {
    const win = getWindow();
    if (!win) return libraryPath;
    const url = getUrl(win);
    url.searchParams.delete(queryParam);
    url.pathname = resolvePath(url.pathname, libraryPath);
    return url.toString();
  };

  const listen = (onChange: (route: Route) => void) => {
    const win = getWindow();
    if (!win || isListening) return () => {};

    isListening = true;

    const handler = () => {
      onChange(getCurrentRoute());
    };

    win.addEventListener('popstate', handler);

    return () => {
      win.removeEventListener('popstate', handler);
      isListening = false;
    };
  };

  return {
    getCurrentSlug,
    getCurrentRoute,
    pushToyState,
    goToLibrary,
    getLibraryHref,
    listen,
  };
}
