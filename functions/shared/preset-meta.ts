// The preset catalog table, /preset-meta.json, and its shared per-isolate
// loader.
//
// One table describes every bundled preset (the root catalog plus the
// libraries, first entry wins) for everything that is not the app itself: the
// sitemap, the /presets/ index and the edge's <title>, OG tags, hub lists and
// related links. `buildPresetMetaMap` in scripts/generate-seo.ts writes it.
// The sitemap used to read the root catalog alone while related links read
// this table, so 144 library presets were linked from preset pages and absent
// from the sitemap.
//
// Three functions carried three drifting copies of the memoized fetch (the OG
// middleware, the dynamic OG card renderer, and the oEmbed provider), so one
// cold isolate could fetch the same JSON up to three times and the copies
// could drift in failure semantics. Success is memoized per isolate; any
// failure or miss resets the memo so a transient error cannot poison it.

/**
 * Directories a bundled preset's .milk file lives in. An entry stores the
 * index, and its file is `${PRESET_FILE_DIRS[index]}${id}.milk`.
 */
export const PRESET_FILE_DIRS = [
  '/milkdrop-presets/',
  '/milkdrop-presets/butterchurn/',
  '/milkdrop-presets/libraries/projectm-cream-of-the-crop/',
  '/milkdrop-presets/libraries/projectm-upstream/',
] as const;

/** The `indexing` value of a preset page that carries `noindex`. */
export const NOINDEX = 'noindex';

/**
 * One preset. Trailing fields are omitted at their defaults to keep the file
 * small, so a reader must treat each as optional.
 */
export type PresetMetaEntry = [
  title: string,
  /** '' when the catalog credits nobody, including the literal "Unknown". */
  author: string,
  /** Index into PRESET_FILE_DIRS; absent when the file is not bundled. */
  fileDir?: number,
  /**
   * Bit i is set when the preset is in DISCOVER_ROUTES[i]
   * (functions/discover-slugs.ts), by the rule Browse filters that page with.
   */
  topics?: number,
  /**
   * Absent or '': the page is indexable and in the sitemap. NOINDEX: the page
   * carries `noindex`. Any other value: the id of the preset this one
   * duplicates, which its page names as canonical.
   */
  indexing?: string,
];

export type PresetMetaTable = Record<string, PresetMetaEntry>;

/** How the edge and the sitemap treat one preset page. */
export type PresetIndexing =
  | { kind: 'index' }
  | { kind: 'noindex' }
  | { kind: 'canonical'; id: string };

export function presetIndexing(entry: PresetMetaEntry): PresetIndexing {
  const value = entry[4];
  if (!value) return { kind: 'index' };
  if (value === NOINDEX) return { kind: 'noindex' };
  return { kind: 'canonical', id: value };
}

/** Ids whose pages are indexable, in table order. */
export function indexablePresetIds(table: PresetMetaTable): string[] {
  return Object.keys(table).filter(
    (id) => presetIndexing(table[id] as PresetMetaEntry).kind === 'index',
  );
}

/**
 * The PRESET_FILE_DIRS index for a bundled file path, or undefined when the
 * path is not `<one of those dirs><id>.milk`.
 */
export function presetFileDirIndex(
  file: string | undefined,
  id: string,
): number | undefined {
  if (!file) return undefined;
  const index = PRESET_FILE_DIRS.findIndex(
    (dir) => file === `${dir}${id}.milk`,
  );
  return index === -1 ? undefined : index;
}

/** Where a preset's .milk file is served, or null when it is not bundled. */
export function presetFileHref(
  id: string,
  entry: PresetMetaEntry,
): string | null {
  const dir = entry[2] === undefined ? undefined : PRESET_FILE_DIRS[entry[2]];
  return dir ? `${dir}${id}.milk` : null;
}

type AssetsBinding = { fetch: (input: Request) => Promise<Response> };

let presetMetaPromise: Promise<PresetMetaTable | null> | null = null;

export function loadPresetMeta(
  assets: AssetsBinding | undefined,
  origin: string,
): Promise<PresetMetaTable | null> {
  presetMetaPromise ??= (async () => {
    if (!assets) return null;
    try {
      const response = await assets.fetch(
        new Request(new URL('/preset-meta.json', origin).toString()),
      );
      if (!response.ok) return null;
      return (await response.json()) as PresetMetaTable;
    } catch {
      return null;
    }
  })().then(
    (value) => {
      if (value === null) presetMetaPromise = null;
      return value;
    },
    () => {
      presetMetaPromise = null;
      return null;
    },
  );

  return presetMetaPromise;
}

// Test seam: the memo is per-isolate by design, but bun runs every test
// file in one process, so suites that mock the ASSETS binding must reset
// between tests or inherit an earlier file's cached table.
export function __resetPresetMetaForTest(): void {
  presetMetaPromise = null;
}
