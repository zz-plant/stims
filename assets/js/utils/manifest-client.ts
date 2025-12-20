type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

type BaseUrlInput = string | URL | null | undefined | (() => string | URL | null | undefined);

type ManifestEntry = {
  file?: string;
  url?: string;
};

const MANIFEST_CANDIDATES = ['./manifest.json', './.vite/manifest.json'];

function resolveBaseUrl(input?: BaseUrlInput): URL | null {
  if (typeof input === 'function') {
    return resolveBaseUrl(input());
  }

  if (!input) {
    const win = typeof window !== 'undefined' ? window : null;
    const href = win?.location?.href;
    if (href) return new URL(href);

    const origin = win?.location?.origin;
    if (origin) return new URL(origin);

    return null;
  }

  try {
    const parsed = typeof input === 'string' ? new URL(input) : input;
    if (parsed?.protocol === 'about:' || parsed?.protocol === 'null:') return null;
    return parsed;
  } catch (error) {
    console.warn('Unable to parse base URL', error);
    return null;
  }
}

function resolveFromBase(baseUrl: URL | null, path: string) {
  if (baseUrl && baseUrl.protocol !== 'about:') {
    try {
      return new URL(path, baseUrl).pathname;
    } catch (error) {
      console.warn('Unable to resolve manifest path from base URL', error);
    }
  }

  return path.replace(/^\.\//, '/');
}

function buildManifestPaths(baseUrl: URL | null) {
  return MANIFEST_CANDIDATES.map((path) => resolveFromBase(baseUrl, path));
}

function resolveFallbackPath(entry: string, baseUrl: URL | null) {
  if (entry.startsWith('./')) {
    try {
      return new URL(entry, import.meta.url).pathname;
    } catch (error) {
      console.error('Error resolving module path from import.meta.url:', error);
    }
  }

  if (baseUrl) {
    try {
      return new URL(entry, baseUrl).pathname;
    } catch (error) {
      console.warn('Unable to resolve fallback path from base URL', error);
    }
  }

  return entry.startsWith('/') || entry.startsWith('.') ? entry : `/${entry}`;
}

function tryResolveUrl(target: string, base: string | URL | null) {
  if (!base) return null;

  try {
    return new URL(target, base).pathname;
  } catch {
    return null;
  }
}

export function createManifestClient({
  fetchImpl = globalThis.fetch as FetchImpl | undefined,
  baseUrl,
}: { fetchImpl?: FetchImpl; baseUrl?: BaseUrlInput } = {}) {
  const getBaseUrl = () => resolveBaseUrl(baseUrl);
  let manifestPromise: Promise<Record<string, ManifestEntry> | null> | null = null;
  let manifestBaseUrl: string | null | undefined;

  const getManifestPaths = () => buildManifestPaths(getBaseUrl());

  const fetchManifest = async () => {
    const currentBaseUrl = getBaseUrl()?.toString() ?? null;

    if (!manifestPromise || manifestBaseUrl !== currentBaseUrl) {
      manifestBaseUrl = currentBaseUrl;
      manifestPromise = (async () => {
        const paths = getManifestPaths();

        for (const path of paths) {
          try {
            const response = await fetchImpl?.(path);
            if (response?.ok) {
              return response.json();
            }
          } catch (error) {
            console.warn('Error fetching manifest from', path, error);
          }
        }

        return null;
      })();
    }

    const manifest = await manifestPromise;

    if (manifest === null) {
      manifestPromise = null;
    }

    return manifest;
  };

  const resolveModulePath = async (entry: string) => {
    const manifest = await fetchManifest();
    const manifestEntry = manifest?.[entry];

    if (manifestEntry) {
      const compiledFile = manifestEntry.file || manifestEntry.url;
      if (compiledFile) {
        const base = getBaseUrl();
        const resolvedFromBase = tryResolveUrl(compiledFile, base);
        if (resolvedFromBase) {
          return resolvedFromBase;
        }

        const origin =
          typeof window !== 'undefined' && window.location?.origin !== 'null'
            ? window.location?.origin
            : null;

        const resolvedFromOrigin = tryResolveUrl(compiledFile, origin);
        if (resolvedFromOrigin) {
          return resolvedFromOrigin;
        }

        return compiledFile.startsWith('/') ? compiledFile : `/${compiledFile}`;
      }
    }

    return resolveFallbackPath(entry, getBaseUrl());
  };

  const reset = () => {
    manifestPromise = null;
    manifestBaseUrl = null;
  };

  return {
    resolveModulePath,
    fetchManifest,
    getManifestPaths,
    getBaseUrl,
    reset,
  };
}
