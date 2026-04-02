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
