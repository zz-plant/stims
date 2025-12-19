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
    return typeof input === 'string' ? new URL(input) : input;
  } catch (error) {
    console.warn('Unable to parse base URL', error);
    return null;
  }
}

function resolveFromBase(baseUrl: URL | null, path: string) {
  if (baseUrl) {
    return new URL(path, baseUrl).pathname;
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
    return new URL(entry, baseUrl).pathname;
  }

  return entry.startsWith('/') || entry.startsWith('.') ? entry : `/${entry}`;
}

export function createManifestClient({
  fetchImpl = globalThis.fetch as FetchImpl | undefined,
  baseUrl,
}: { fetchImpl?: FetchImpl; baseUrl?: BaseUrlInput } = {}) {
  const getBaseUrl = () => resolveBaseUrl(baseUrl);
  let manifestPromise: Promise<Record<string, ManifestEntry> | null> | null = null;

  const getManifestPaths = () => buildManifestPaths(getBaseUrl());

  const fetchManifest = async () => {
    if (!manifestPromise) {
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

    return manifestPromise;
  };

  const resolveModulePath = async (entry: string) => {
    const manifest = await fetchManifest();
    const manifestEntry = manifest?.[entry];

    if (manifestEntry) {
      const compiledFile = manifestEntry.file || manifestEntry.url;
      if (compiledFile) {
        const base = getBaseUrl();
        if (base) {
          return new URL(compiledFile, base).pathname;
        }

        if (typeof window !== 'undefined' && window.location?.origin) {
          return new URL(compiledFile, window.location.origin).pathname;
        }

        return compiledFile.startsWith('/') ? compiledFile : `/${compiledFile}`;
      }
    }

    return resolveFallbackPath(entry, getBaseUrl());
  };

  const reset = () => {
    manifestPromise = null;
  };

  return {
    resolveModulePath,
    fetchManifest,
    getManifestPaths,
    getBaseUrl,
    reset,
  };
}
