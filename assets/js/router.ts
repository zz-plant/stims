type WindowGetter = () => (Window & typeof globalThis) | null;

export type Route =
  | { view: 'library'; slug: null }
  | { view: 'experience'; slug: string | null };

type SlugPathMap = Record<string, string>;

const DEFAULT_SLUG_PATHS: SlugPathMap = {
  milkdrop: '/milkdrop/',
};

export function getToyRouteHref(
  slug: string,
  {
    queryParam = 'experience',
    routePath = 'milkdrop/',
    slugPaths = DEFAULT_SLUG_PATHS,
  }: {
    queryParam?: string;
    routePath?: string;
    slugPaths?: SlugPathMap;
  } = {},
) {
  const mappedPath = slugPaths[slug];
  if (mappedPath) {
    return mappedPath;
  }

  const normalizedRoutePath = routePath.endsWith('/')
    ? routePath
    : `${routePath}/`;
  return `/${normalizedRoutePath}?${queryParam}=${encodeURIComponent(slug)}`;
}

const normalizePath = (pathname: string) => {
  const normalized = pathname.replace(/\/index\.html$/u, '/');
  if (normalized === '') return '/';
  if (
    normalized !== '/' &&
    !normalized.endsWith('/') &&
    !normalized.split('/').pop()?.includes('.')
  ) {
    return `${normalized}/`;
  }
  return normalized;
};

export function createRouter({
  windowRef = () => (typeof window === 'undefined' ? null : window),
  queryParam = 'experience',
  libraryPath = '/',
  routePath = 'milkdrop/',
  defaultToySlug = 'milkdrop',
  slugPaths = DEFAULT_SLUG_PATHS,
}: {
  windowRef?: WindowGetter;
  queryParam?: string;
  libraryPath?: string;
  routePath?: string;
  defaultToySlug?: string | null;
  slugPaths?: SlugPathMap;
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

  const resolveNormalizedPath = (pathname: string, target: string) =>
    normalizePath(resolvePath(pathname, target));

  const getSlugFromPath = (pathname: string) =>
    Object.entries(slugPaths).find(([, target]) => {
      return (
        normalizePath(pathname) === resolveNormalizedPath(pathname, target)
      );
    })?.[0] ?? null;

  const getCurrentSlug = () => {
    const win = getWindow();
    if (!win) return null;

    const params = new URLSearchParams(win.location.search);
    const querySlug = params.get(queryParam);
    if (querySlug) {
      return querySlug;
    }

    return getSlugFromPath(win.location.pathname);
  };

  const normalizedRoutePath = routePath.endsWith('/')
    ? routePath
    : `${routePath}/`;

  const isExperiencePath = (pathname: string) => {
    const normalizedPath = normalizePath(pathname);
    return (
      normalizedPath === `/${normalizedRoutePath}` ||
      normalizedPath.endsWith(`/${normalizedRoutePath}`)
    );
  };

  const getCurrentRoute = (): Route => {
    const win = getWindow();
    if (!win) return { view: 'library', slug: null };

    const url = getUrl(win);
    const slug = url.searchParams.get(queryParam);
    if (slug) {
      return { view: 'experience', slug };
    }

    const pathSlug = getSlugFromPath(url.pathname);
    if (pathSlug) {
      return { view: 'experience', slug: pathSlug };
    }

    if (isExperiencePath(url.pathname)) {
      return { view: 'experience', slug: defaultToySlug };
    }

    return { view: 'library', slug: null };
  };

  const pushToyState = (slug: string) => {
    const win = getWindow();
    if (!win?.history) return;

    const url = getUrl(win);
    const href = getToyRouteHref(slug, { queryParam, routePath, slugPaths });
    if (href.startsWith('/')) {
      url.searchParams.delete(queryParam);
      url.pathname = resolvePath(url.pathname, href);
    } else {
      const nextUrl = new URL(href, url);
      url.pathname = nextUrl.pathname;
      url.search = nextUrl.search;
    }
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
