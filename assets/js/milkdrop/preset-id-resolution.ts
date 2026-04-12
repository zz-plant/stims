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

export function resolvePresetCatalogEntry<T extends PresetLookupEntry>(
  entries: readonly T[],
  requestedPresetId: string | null | undefined,
) {
  const requested = requestedPresetId?.trim();
  if (!requested) {
    return null;
  }

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

  const requestedLookup = buildLookupValues({
    id: requested,
  });

  const directAliasMatch = findUniqueMatch(entries, (entry) =>
    setsIntersect(buildLookupValues(entry).exact, requestedLookup.exact),
  );
  if (directAliasMatch) {
    return directAliasMatch;
  }

  return findUniqueMatch(entries, (entry) =>
    setsIntersect(buildLookupValues(entry).slug, requestedLookup.slug),
  );
}

export function resolvePresetId<T extends PresetLookupEntry>(
  entries: readonly T[],
  requestedPresetId: string | null | undefined,
) {
  return resolvePresetCatalogEntry(entries, requestedPresetId)?.id ?? null;
}
