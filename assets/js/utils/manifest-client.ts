import { type ToyManifest, toyManifestSchema } from '../data/toy-schema.ts';

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

type BaseUrlInput =
  | string
  | URL
  | null
  | undefined
  | (() => string | URL | null | undefined);

type ManifestEntry = {
  file?: string;
  url?: string;
};

// Prefer the public manifest first; fall back to the hidden Vite output when present.
const MANIFEST_CANDIDATES = ['./manifest.json', './.vite/manifest.json'];

function getCurrentOrigin() {
  const origin = typeof window !== 'undefined' ? window.location?.origin : null;
  if (!origin || origin === 'null') return null;
  return origin;
}

function formatResolvedUrl(resolved: URL) {
  const currentOrigin = getCurrentOrigin();
  if (currentOrigin && resolved.origin === currentOrigin) {
    return resolved.pathname;
  }

  return resolved.toString();
}

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
    if (parsed?.protocol === 'about:' || parsed?.protocol === 'null:')
      return null;
    return parsed;
  } catch (error) {
    console.warn('Unable to parse base URL', error);
    return null;
  }
}

function resolveFromBase(baseUrl: URL | null, path: string) {
  if (baseUrl && baseUrl.protocol !== 'about:') {
    try {
      return formatResolvedUrl(new URL(path, baseUrl));
    } catch (error) {
      console.warn('Unable to resolve manifest path from base URL', error);
    }
  }

  return path.replace(/^\.\//, '/');
}

function resolveOriginRoot(baseUrl: URL | null) {
  const origin = baseUrl?.origin ?? getCurrentOrigin();
  if (!origin) return null;
  try {
    return new URL('/', origin);
  } catch (error) {
    console.warn('Unable to resolve manifest origin root', error);
    return null;
  }
}

function buildManifestPaths(baseUrl: URL | null) {
  const candidates = new Set<string>();
  const originRoot = resolveOriginRoot(baseUrl);
  const bases = [baseUrl, originRoot].filter((entry): entry is URL =>
    Boolean(entry),
  );

  for (const base of bases) {
    for (const path of MANIFEST_CANDIDATES) {
      candidates.add(resolveFromBase(base, path));
    }
  }

  if (!candidates.size) {
    MANIFEST_CANDIDATES.forEach((path) =>
      candidates.add(resolveFromBase(null, path)),
    );
  }

  return Array.from(candidates);
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
      return formatResolvedUrl(new URL(entry, baseUrl));
    } catch (error) {
      console.error('Error resolving fallback path from base URL:', error);
    }
  }

  return entry.startsWith('/') || entry.startsWith('.') ? entry : `/${entry}`;
}

function tryResolveUrl(target: string, base: string | URL | null) {
  if (!base) return null;

  try {
    return formatResolvedUrl(new URL(target, base));
  } catch {
    return null;
  }
}

function formatZodIssues(error: {
  issues: { path: PropertyKey[]; message: string }[];
}) {
  return error.issues
    .map((issue) => {
      const pathLabel = issue.path.length
        ? issue.path
            .map((segment) =>
              typeof segment === 'symbol'
                ? segment.toString()
                : String(segment),
            )
            .join('.')
        : 'manifest';
      return `- ${pathLabel}: ${issue.message}`;
    })
    .join('\n');
}

export function parseToyManifest(
  data: unknown,
  { source = 'toy manifest' }: { source?: string } = {},
): { ok: true; data: ToyManifest } | { ok: false; error: Error } {
  const parsed = toyManifestSchema.safeParse(data);
  if (!parsed.success) {
    const message = [
      `Toy manifest validation failed for ${source}:`,
      formatZodIssues(parsed.error),
    ].join('\n');
    return { ok: false, error: new Error(message) };
  }
  return { ok: true, data: parsed.data };
}

export function createManifestClient({
  fetchImpl = globalThis.fetch as FetchImpl | undefined,
  baseUrl,
}: {
  fetchImpl?: FetchImpl;
  baseUrl?: BaseUrlInput;
} = {}) {
  const getBaseUrl = () => resolveBaseUrl(baseUrl);
  let manifestPromise: Promise<Record<string, ManifestEntry> | null> | null =
    null;
  let manifestBaseUrl: URL | null = null;

  const getManifestPaths = () => buildManifestPaths(getBaseUrl());

  const fetchManifest = async () => {
    if (manifestPromise) {
      return manifestPromise;
    }

    const paths = getManifestPaths();
    for (const path of paths) {
      try {
        const response = await fetchImpl?.(path);
        if (response?.ok) {
          const data = await response.json();
          manifestPromise = Promise.resolve(data);
          const base = getBaseUrl();
          const origin = getCurrentOrigin();
          const baseForUrl = base ?? (origin ? new URL(origin) : null);
          try {
            const manifestUrl = baseForUrl
              ? new URL(path, baseForUrl)
              : new URL(path);
            manifestBaseUrl = new URL('.', manifestUrl);
          } catch (error) {
            console.warn('Unable to resolve manifest base URL', error);
          }
          return manifestPromise;
        }
      } catch (error) {
        console.warn('Error fetching manifest from', path, error);
      }
    }

    manifestPromise = Promise.resolve(null);
    return manifestPromise;
  };

  const resolveModulePath = async (entry: string) => {
    const manifest = await fetchManifest();
    const manifestEntry = manifest?.[entry];

    if (manifestEntry) {
      const compiledFile = manifestEntry.file || manifestEntry.url;
      if (compiledFile) {
        if (manifestBaseUrl) {
          const resolvedFromManifest = tryResolveUrl(
            compiledFile,
            manifestBaseUrl,
          );
          if (resolvedFromManifest) {
            return resolvedFromManifest;
          }
        }
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
