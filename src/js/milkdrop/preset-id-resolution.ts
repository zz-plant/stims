import { createLogger } from '../core/logger.ts';

const log = createLogger('PresetIdResolution');

type PresetLookupEntry = {
  id: string;
  title?: string | null;
  file?: string | null;
  bundledFile?: string | null;
};

type PresetLookupValues = {
  exact: Set<string>;
  slug: Set<string>;
};

const LEGACY_PRESET_ID_ALIASES = new Map<string, string>([
  ['signal-bloom', 'eos-glowsticks-v2-03-music'],
]);

function normalizeExactCandidate(value: string) {
  return value.trim().toLowerCase();
}

function safeDecodeCandidate(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getPathBasename(value: string) {
  const withoutQuery = value.split(/[?#]/u, 1)[0] ?? value;
  const segments = withoutQuery.split(/[\\/]/u).filter(Boolean);
  return segments[segments.length - 1] ?? withoutQuery;
}

function stripPresetExtension(value: string) {
  return value.replace(/\.(milk|mpr)$/iu, '');
}

function isLikelyPresetPath(value: string) {
  return (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.includes('\\') ||
    /^[a-z]+:\/\//iu.test(value) ||
    /\.(milk|mpr)(?:[?#]|$)/iu.test(value)
  );
}

function slugifyPresetCandidate(value: string) {
  return stripPresetExtension(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function addLookupValues(
  lookup: PresetLookupValues,
  value: string | null | undefined,
) {
  if (!value) {
    return;
  }

  const decoded = safeDecodeCandidate(value).trim();
  if (!decoded) {
    return;
  }

  const variants = new Set<string>([decoded]);
  if (isLikelyPresetPath(decoded)) {
    const basename = getPathBasename(decoded);
    variants.add(basename);
    variants.add(stripPresetExtension(basename));
  }

  variants.forEach((candidate) => {
    const normalized = normalizeExactCandidate(candidate);
    if (normalized) {
      lookup.exact.add(normalized);
    }

    const slug = slugifyPresetCandidate(candidate);
    if (slug) {
      lookup.slug.add(slug);
    }
  });
}

function buildLookupValues(
  entry: Pick<PresetLookupEntry, 'id' | 'title' | 'file' | 'bundledFile'>,
) {
  const lookup: PresetLookupValues = {
    exact: new Set<string>(),
    slug: new Set<string>(),
  };

  addLookupValues(lookup, entry.id);
  addLookupValues(lookup, entry.title);
  addLookupValues(lookup, entry.file);
  addLookupValues(lookup, entry.bundledFile);

  return lookup;
}

function setsIntersect(left: Set<string>, right: Set<string>) {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function findUniqueMatch<T extends PresetLookupEntry>(
  entries: readonly T[],
  predicate: (entry: T) => boolean,
) {
  let match: T | null = null;

  for (const entry of entries) {
    if (!predicate(entry)) {
      continue;
    }

    if (match && match !== entry) {
      return null;
    }

    match = entry;
  }

  return match;
}

/**
 * Result cache keyed by catalog array identity. An id that resolves exits
 * via the cheap exact scan, but an id that does NOT resolve pays two full
 * catalog scans with per-entry slug building — and several callers resolve
 * in React render bodies, so an unresolvable `?preset=` id (stale share
 * link, renamed preset) burned that cost on every render (~54ms/frame on
 * the 2,686-preset catalog, measured 2026-08-18). Bounded per catalog
 * array; the WeakMap lets replaced catalog snapshots collect.
 */
const RESOLUTION_CACHE_LIMIT = 64;
const resolutionCache = new WeakMap<
  readonly PresetLookupEntry[],
  Map<string, PresetLookupEntry | null>
>();

export function resolvePresetCatalogEntry<T extends PresetLookupEntry>(
  entries: readonly T[],
  requestedPresetId: string | null | undefined,
): T | null {
  const requested = requestedPresetId?.trim();
  if (!requested) {
    return null;
  }

  let cache = resolutionCache.get(entries);
  if (cache?.has(requested)) {
    return (cache.get(requested) ?? null) as T | null;
  }

  const resolved = resolvePresetCatalogEntryUncached(entries, requested);
  if (!cache) {
    cache = new Map();
    resolutionCache.set(entries, cache);
  } else if (cache.size >= RESOLUTION_CACHE_LIMIT) {
    cache.clear();
  }
  cache.set(requested, resolved);
  return resolved;
}

function resolvePresetCatalogEntryUncached<T extends PresetLookupEntry>(
  entries: readonly T[],
  requested: string,
): T | null {
  const normalizedRequestedId = normalizeExactCandidate(
    safeDecodeCandidate(requested),
  );
  const exactIdMatch =
    entries.find(
      (entry) => normalizeExactCandidate(entry.id) === normalizedRequestedId,
    ) ?? null;
  if (exactIdMatch) {
    return exactIdMatch;
  }

  const legacyAliasTarget =
    LEGACY_PRESET_ID_ALIASES.get(normalizedRequestedId) ??
    LEGACY_PRESET_ID_ALIASES.get(slugifyPresetCandidate(requested));
  if (legacyAliasTarget) {
    log.log(`"${requested}" → legacy alias "${legacyAliasTarget}"`);
    const exactAliasMatch =
      entries.find(
        (entry) =>
          normalizeExactCandidate(entry.id) ===
          normalizeExactCandidate(legacyAliasTarget),
      ) ?? null;
    if (exactAliasMatch) {
      return exactAliasMatch;
    }
  }

  const requestedLookup = buildLookupValues({
    id: requested,
  });

  const directAliasMatch = findUniqueMatch(entries, (entry) =>
    setsIntersect(buildLookupValues(entry).exact, requestedLookup.exact),
  );
  if (directAliasMatch) {
    log.log(`"${requested}" → alias match "${directAliasMatch.id}"`);
    return directAliasMatch;
  }

  const fuzzyMatch = findUniqueMatch(entries, (entry) =>
    setsIntersect(buildLookupValues(entry).slug, requestedLookup.slug),
  );
  if (fuzzyMatch) {
    log.log(`"${requested}" → fuzzy slug match "${fuzzyMatch.id}"`);
  }
  return fuzzyMatch;
}

export function resolvePresetId<T extends PresetLookupEntry>(
  entries: readonly T[],
  requestedPresetId: string | null | undefined,
) {
  return resolvePresetCatalogEntry(entries, requestedPresetId)?.id ?? null;
}
