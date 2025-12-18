type FetchLike = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type ManifestEntry = { file?: string; url?: string };
type ManifestData = Record<string, ManifestEntry>;
type BaseUrlOption = URL | string | null | undefined | (() => URL | string | null | undefined);

function resolveBaseUrl(option?: BaseUrlOption) {
  if (typeof option === 'function') {
    return option();
  }

  if (option) {
    return option;
  }

  if (typeof window === 'undefined') return null;

  const href = window.location?.href;
  if (href) return new URL(href);

  const origin = window.location?.origin;
  if (origin) return new URL(origin);

  return null;
}

function resolveRelativePath(relativePath: string, baseUrl: string | URL | null) {
  return baseUrl ? new URL(relativePath, baseUrl).pathname : relativePath.replace(/^\.\//, '/');
}

export function createManifestClient({
  fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined,
  baseUrl,
}: {
  fetchImpl?: FetchLike;
  baseUrl?: BaseUrlOption;
} = {}) {
  let manifestPromise: Promise<ManifestData | null> | null = null;
  const getBaseUrl = () => resolveBaseUrl(baseUrl);

  const getManifestPaths = () => {
    const resolvedBase = getBaseUrl();
    return [resolveRelativePath('./manifest.json', resolvedBase), resolveRelativePath('./.vite/manifest.json', resolvedBase)];
  };

  const fetchManifest = async () => {
    if (!manifestPromise) {
      const fetcher = fetchImpl;
      manifestPromise = (async () => {
        for (const path of getManifestPaths()) {
          if (!fetcher) break;

          try {
            const response = await fetcher(path);
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
    const base = getBaseUrl();

    if (manifestEntry) {
      const compiledFile = manifestEntry.file || manifestEntry.url;
      if (compiledFile) {
        if (base) {
          return new URL(compiledFile, base).pathname;
        }

        if (typeof window !== 'undefined' && window.location?.origin) {
          return new URL(compiledFile, window.location.origin).pathname;
        }

        return compiledFile;
      }
    }

    if (entry.startsWith('./')) {
      try {
        return new URL(entry, import.meta.url).pathname;
      } catch (error) {
        console.error('Error resolving module path from import.meta.url:', error);
      }
    }

    if (base) {
      return new URL(entry, base).pathname;
    }

    return entry.startsWith('/') || entry.startsWith('.') ? entry : `/${entry}`;
  };

  return {
    fetchManifest,
    resolveModulePath,
    getManifestPaths,
  };
}

const defaultClient = createManifestClient();

export const fetchManifest = () => defaultClient.fetchManifest();
export const resolveModulePath = (entry: string) => defaultClient.resolveModulePath(entry);
