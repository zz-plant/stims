type ViteEnv = {
  DEV?: boolean;
  VITE_STIMS_API_BASE?: string;
};

function normalizeApiBase(base: string) {
  return base.endsWith('/') ? base : `${base}/`;
}

export function resolveOptionalApiUrl(
  path: string,
  options: {
    env?: ViteEnv;
    location?: Pick<Location, 'hostname' | 'origin'> | null;
  } = {},
) {
  const env =
    options.env ?? (import.meta as unknown as { env?: ViteEnv }).env ?? {};
  const configuredBase = env.VITE_STIMS_API_BASE?.trim();
  const apiPath = path.replace(/^\//u, '');

  if (configuredBase) {
    const base = new URL(normalizeApiBase(configuredBase));
    const basePath = base.pathname.replace(/\/$/u, '');
    const pathForBase = basePath.endsWith('/api')
      ? apiPath.replace(/^api\//u, '')
      : apiPath;
    return new URL(pathForBase, base).href;
  }

  const location = options.location ?? globalThis.location;
  if (!location) {
    return null;
  }

  const hostname = location?.hostname;
  const isLocalHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]';

  if (env.DEV || isLocalHost) {
    return null;
  }

  return new URL(path, location.origin).href;
}
