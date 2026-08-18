import type { MotionPreference } from '../core/motion-preferences.ts';
import {
  DEFAULT_QUALITY_PRESETS,
  describeQualityPresetImpact,
  type QualityPreset,
} from '../core/settings-panel.ts';
import type { RenderPreferences } from '../core/state/render-preference-store.ts';
import {
  creditedHandles,
  creditsHandle,
  resolveHandleKey,
} from '../milkdrop/preset-handles.ts';
import type { MilkdropCatalogEntry } from '../milkdrop/types.ts';
import type {
  AudioSource,
  LaunchIntent,
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';

/** Stims' own repository — surfaced on the launch screen and in credits. */
export const STIMS_REPO_URL = 'https://github.com/zz-plant/stims';

export type StarterPreset = {
  key: string;
  label: string;
  summary: string;
  preset: PresetCatalogEntry;
};

export type WorkspaceLaunchState = {
  engineReady: boolean;
  featuredPreset: PresetCatalogEntry | null;
  audioActive: boolean;
  launchEyebrow: string;
  launchTitle: string;
  launchSummary: string;
  showExtendedSources: boolean;
  youtubeReady: boolean;
  youtubeUrl: string;
};

export type WorkspaceStageState = {
  audioSource: AudioSource | null | undefined;
  backend: 'webgl' | 'webgpu' | null | undefined;
  featuredPreset: PresetCatalogEntry | null;
  missingRequestedPreset: boolean;
  stageEyebrow: string;
  stageTitle: string;
  stageSummary: string;
};

export type WorkspaceSettingsState = {
  motionPreference: MotionPreference;
  qualityPreset: QualityPreset;
  renderPreferences: RenderPreferences;
};

export type WorkspaceBrowseState = {
  catalog: PresetCatalogEntry[];
  catalogError: string | null;
  catalogReady: boolean;
  collectionTags: string[];
  currentPresetId: string | null;
  filteredCatalog: PresetCatalogEntry[];
  routeState: SessionRouteState;
  searchQuery: string;
};

export const TOOL_TABS: Array<Exclude<PanelState, null>> = [
  'browse',
  'editor',
  'settings',
];

export function getToolLabel(tool: Exclude<PanelState, null>) {
  switch (tool) {
    case 'browse':
      return 'Browse presets';
    case 'editor':
      return 'Edit preset code';
    case 'refine':
      return 'Refine with AI';
    // Both ids open the same finder panel, so they share its title rather
    // than keeping the two names the two old panels had.
    case 'audiomatch':
    case 'visualsearch':
      return 'Find a preset';
    case 'synthesize':
      return 'Generate with AI';
    case 'capture':
      return 'Record video';
    case 'settings':
      return 'Settings';
    default:
      return '';
  }
}

export function getToolDescription(tool: Exclude<PanelState, null>) {
  switch (tool) {
    case 'settings':
      return 'Choose a quality preset, then adjust performance and motion options.';
    default:
      return '';
  }
}

const COLLECTION_TAG_LABEL_MAP: Record<string, string> = {
  'collection:hall-of-fame': 'Hall of Fame Masterpieces',
  'collection:webgpu-showcase': 'WebGPU Ultra Showcase',
  'collection:audio-reactive': 'Audio-Reactive Masterpieces',
  'collection:butterchurn': 'Butterchurn',
  'collection:cream-of-the-crop': 'Cream of the Crop',
  'collection:classic-milkdrop': 'Classic MilkDrop',
  'collection:rovastar-and-collaborators': 'Rovastar & Collaborators',
  'collection:author-geiss': 'Author: Ryan Geiss',
  'collection:author-rovastar': 'Author: Rovastar',
  'collection:author-eos': 'Author: Eo.S.',
  'collection:author-flexi': 'Author: Flexi',
  'collection:author-martin': 'Author: Martin',
  'collection:author-fishbrain': 'Author: Fishbrain',
  'collection:author-cope': 'Author: Cope',
  'collection:author-unchained': 'Author: Unchained',
  'collection:author-suksma': 'Author: Suksma',
  'collection:author-amandio-c': 'Author: Amandio C',
  'collection:author-stahlregen': 'Author: Stahlregen',
  'collection:vj-high-intensity': 'VJ: High Intensity Rave',
  'collection:vj-ambient-glow': 'VJ: Ambient & Chill Glow',
  'collection:vj-tunnel-geometry': 'VJ: 3D Tunnel & Geometry',
  'collection:vj-reaction-diffusion': 'VJ: Reaction-Diffusion',
  'collection:mood-deep-space': 'Mood: Deep Space',
  'collection:mood-psychedelic': 'Mood: Psychedelic',
  'collection:mood-rave': 'Mood: Rave Lightshow',
  'collection:mood-ambient': 'Mood: Ambient Glow',
  'collection:touch-friendly': 'Touch Friendly',
};

/**
 * Pages an author publishes under — their own home, not a place their files
 * ended up.
 *
 * Most preset authors have no live page. Pointing their byline at a preset
 * pack that merely redistributes their work implies "this is their site" and
 * quietly credits the distributor, so those links are deliberately absent
 * rather than approximated. An entry belongs here only when the author
 * publishes there themselves.
 */
const AUTHOR_PROFILES: Record<string, string> = {
  geiss: 'http://www.geisswerks.com/milkdrop/',
};

export function resolveAuthorUrl(
  author?: string,
  explicitUrl?: string,
): string | undefined {
  if (explicitUrl) return explicitUrl;
  if (!author) return undefined;
  // Only link a byline that resolves to exactly one author — a chain like
  // "Flexi + Geiss" must not link the whole credit to one of its hands.
  const handles = creditedHandles(author);
  if (handles.length !== 1) return undefined;
  return AUTHOR_PROFILES[resolveHandleKey(handles[0])];
}

export function prettifyCollectionTag(collectionTag: string) {
  if (COLLECTION_TAG_LABEL_MAP[collectionTag]) {
    return COLLECTION_TAG_LABEL_MAP[collectionTag];
  }
  return collectionTag
    .replace(/^collection:/u, '')
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

export function matchesPreset(entry: PresetCatalogEntry, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const searchIndex = getPresetSearchIndex(entry);
  if (searchIndex.includes(normalizedQuery)) {
    return true;
  }

  const queryTokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  if (queryTokens.length === 0) {
    return true;
  }

  return queryTokens.every((token) => searchIndex.includes(token));
}

export type BrowseSortMode =
  | 'relevance'
  | 'title'
  | 'author'
  | 'recent'
  | 'favorites-first'
  | 'webgpu-supported'
  | 'random';

/**
 * Order browse results for a given sort mode. Lives here beside
 * `matchesPreset` so the browse filter and sort stay testable as plain
 * functions rather than only through a rendered sheet.
 *
 * `seed` only affects 'random': it keeps the shuffle stable across re-renders
 * so rows don't jump while the user scrolls.
 */
function deterministicPresetHash(id: string, seed: number): number {
  let hash = (seed | 0) ^ 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sortBrowseEntries(
  entries: PresetCatalogEntry[],
  sort: BrowseSortMode,
  seed: number,
): PresetCatalogEntry[] {
  const sorted = [...entries];
  switch (sort) {
    case 'title':
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case 'author':
      return sorted.sort((a, b) =>
        (a.author ?? 'Unknown').localeCompare(b.author ?? 'Unknown'),
      );
    case 'recent':
      return sorted.sort(
        (a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0),
      );
    case 'favorites-first':
      return sorted.sort(
        (a, b) => Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite)),
      );
    case 'webgpu-supported':
      return sorted.sort(
        (a, b) =>
          Number(Boolean(b.supports?.webgpu)) -
          Number(Boolean(a.supports?.webgpu)),
      );
    case 'random': {
      const hashes = new Map<string, number>();
      for (let i = 0; i < sorted.length; i += 1) {
        const id = sorted[i].id;
        if (!hashes.has(id)) {
          hashes.set(id, deterministicPresetHash(id, seed));
        }
      }
      return sorted.sort(
        (a, b) => (hashes.get(a.id) ?? 0) - (hashes.get(b.id) ?? 0),
      );
    }
    default:
      return sorted;
  }
}

/**
 * Distinct authors for the "Browse by author" filter.
 *
 * MilkDrop bylines are accretive credit chains, so the filter lists the
 * individual handles credited across the catalog rather than the raw author
 * strings. Listing the strings instead both split one author across spelling
 * variants and buried anyone who mostly published in company — 102 catalog
 * presets credit Phat, and only 5 name him alone.
 */
export function getAuthorOptions(entries: PresetCatalogEntry[]): string[] {
  const byKey = new Map<string, string>();
  for (const entry of entries) {
    for (const handle of creditedHandles(entry.author)) {
      byKey.set(resolveHandleKey(handle), handle);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

/** True when the entry's credit chain names this author anywhere in it. */
export function matchesAuthor(
  entry: PresetCatalogEntry,
  author: string | null,
) {
  if (!author) return true;
  return creditsHandle(entry.author, author);
}

export function getCollectionTags(entries: PresetCatalogEntry[]) {
  const collectionTags = new Set<string>();
  entries.forEach((entry) => {
    entry.tags?.forEach((tag) => {
      if (tag.startsWith('collection:')) {
        collectionTags.add(tag);
      }
    });
  });
  return [...collectionTags].sort((left, right) => left.localeCompare(right));
}

export function getFeaturedCollectionTags(collectionTags: string[]) {
  const featuredHints = [
    'collection:hall-of-fame',
    'collection:webgpu-showcase',
    'collection:audio-reactive',
    'collection:cream-of-the-crop',
    'collection:classic-milkdrop',
    'collection:vj-high-intensity',
    'collection:vj-ambient-glow',
    'collection:vj-tunnel-geometry',
    'collection:vj-reaction-diffusion',
    'collection:author-geiss',
    'collection:author-rovastar',
    'collection:author-eos',
    'collection:author-fishbrain',
    'collection:author-cope',
    'collection:author-unchained',
    'collection:author-suksma',
    'collection:author-amandio-c',
    'collection:author-stahlregen',
    'collection:mood-deep-space',
    'collection:mood-psychedelic',
    'collection:mood-rave',
    'collection:mood-ambient',
    'collection:rovastar-and-collaborators',
    'collection:touch-friendly',
    // Catch-all import (97.6% of the catalog) — listed last so the smaller,
    // curated collections above stay easy to spot for discovery.
    'collection:butterchurn',
  ];
  const featured = featuredHints.filter((tag) => collectionTags.includes(tag));
  if (featured.length > 0) {
    return featured;
  }
  return collectionTags.slice(0, 4);
}

export function buildAppliedFilterSummary({
  searchQuery,
  collectionTag,
  authorFilter,
}: {
  searchQuery: string;
  collectionTag: string | null;
  authorFilter?: string | null;
}) {
  const appliedFilters = [
    searchQuery.trim().length > 0 ? `Search: "${searchQuery.trim()}"` : null,
    collectionTag
      ? `Collection: ${prettifyCollectionTag(collectionTag)}`
      : null,
    authorFilter ? `Author: ${authorFilter}` : null,
  ].filter(Boolean);

  if (appliedFilters.length === 0) {
    return 'Applied filters: none';
  }

  return `Applied filters: ${appliedFilters.join(' · ')}`;
}

export function buildPresetSearchIndex(entry: PresetCatalogEntry) {
  const collectionLabels = (entry.tags ?? [])
    .filter((tag) => tag.startsWith('collection:'))
    .map((tag) => prettifyCollectionTag(tag));
  const rawTerms = [
    entry.id,
    entry.title,
    entry.author,
    ...(entry.tags ?? []),
    ...collectionLabels,
  ]
    .filter(Boolean)
    .join(' ');
  return normalizeSearchText(rawTerms);
}

const presetSearchIndexCache = new WeakMap<PresetCatalogEntry, string>();

function getPresetSearchIndex(entry: PresetCatalogEntry) {
  const cached = presetSearchIndexCache.get(entry);
  if (cached !== undefined) {
    return cached;
  }
  // searchTerms are appended here (the query-matching path) and deliberately
  // kept out of buildPresetSearchIndex: describePresetMood reads that index,
  // and semantic terms like "dark" or "fire" would re-bucket preset moods.
  const semanticTerms = entry.searchTerms?.length
    ? ` ${normalizeSearchText(entry.searchTerms.join(' '))}`
    : '';
  const searchIndex = buildPresetSearchIndex(entry) + semanticTerms;
  presetSearchIndexCache.set(entry, searchIndex);
  return searchIndex;
}

const moodCache = new Map<string, string>();

export function describePresetMood(entry: PresetCatalogEntry) {
  const cached = moodCache.get(entry.id);
  if (cached) return cached;

  const index = buildPresetSearchIndex(entry);
  let mood: string;

  // Anchor keywords to a word boundary so a descriptive term is only matched
  // as its own word — not as a substring buried inside an author name. Without
  // this, "star" inside the prolific author "Rovastar" (and "light" inside
  // "skylight", etc.) forced ~170 presets into "Bright pulse", making the browse
  // list read as one repeated label. Compound titles that begin with a keyword
  // ("Glowsticks", "Cubetrace") still match because the keyword starts the word.
  if (/\b(?:glow|sun|flare|star|light|bloom)/u.test(index)) {
    mood = 'Bright pulse';
  } else if (/\b(?:cube|matrix|square|line|grid|trace)/u.test(index)) {
    mood = 'Sharp geometry';
  } else if (
    /\b(?:quasar|ether|parallel|space|mars|radiation|vacuum)/u.test(index)
  ) {
    mood = 'Space drift';
  } else if (/\b(?:dark|ritual|apocalypse|demon|moon)/u.test(index)) {
    mood = 'Moody sweep';
  } else if (/\b(?:trippy|psychaos|rotation|spectro|glassworms)/u.test(index)) {
    mood = 'Psychedelic spin';
  } else if (entry.tags?.includes('collection:classic-milkdrop')) {
    mood = 'Classic rush';
  } else {
    mood = 'Instant pick';
  }

  moodCache.set(entry.id, mood);
  return mood;
}

export function buildStarterPresets(entries: PresetCatalogEntry[]) {
  const usedPresetIds = new Set<string>();
  const starterPresets: StarterPreset[] = [];

  // Score entries by fidelity so we prefer certified presets
  const scoreFidelity = (entry: PresetCatalogEntry) => {
    const fc = entry.visualCertification?.fidelityClass;
    if (fc === 'exact') return 4;
    if (fc === 'near-exact') return 3;
    if (fc === 'partial') return 2;
    return 1;
  };

  // Pick the best entry matching a tag predicate
  const pickByTag = (predicate: (tag: string) => boolean) => {
    const candidates = entries
      .filter((e) => !usedPresetIds.has(e.id) && (e.tags ?? []).some(predicate))
      .sort(
        (a, b) =>
          scoreFidelity(b) - scoreFidelity(a) ||
          (a.historyIndex ?? 999) - (b.historyIndex ?? 999),
      );
    return candidates[0] ?? null;
  };

  const categories = [
    {
      key: 'popular',
      label: 'Popular pick',
      summary: 'A community favorite with broad appeal.',
      tagPredicate: (tag: string) => tag === 'popular',
    },
    {
      key: 'classic',
      label: 'Classic MilkDrop',
      summary: 'A grounded first pick from the classic MilkDrop lineage.',
      tagPredicate: (tag: string) =>
        /^collection:/.test(tag) && /classic/i.test(tag),
    },
    {
      key: 'lasers',
      label: 'Bright & sharp',
      summary: 'Glowing motion with clean contrast and geometry.',
      tagPredicate: (tag: string) =>
        ['glowsticks', 'lasers', 'bright', 'geometry'].includes(tag),
    },
    {
      key: 'space',
      label: 'Space drift',
      summary: 'Slower cosmic motion with more room to breathe.',
      tagPredicate: (tag: string) =>
        ['space', 'moody', 'atmospheric'].includes(tag) ||
        /space|cosmos/i.test(tag),
    },
  ];

  categories.forEach(({ key, label, summary, tagPredicate }) => {
    const preset = pickByTag(tagPredicate);
    if (preset) {
      usedPresetIds.add(preset.id);
      starterPresets.push({ key, label, summary, preset });
    }
  });

  // Fallback: pick the first remaining entry by order if any category missed
  if (starterPresets.length === 0 && entries.length > 0) {
    starterPresets.push({
      key: 'start-here',
      label: 'Start here',
      summary: 'A great preset to begin with.',
      preset: entries[0],
    });
  }

  return starterPresets;
}

export function isDocumentAudioActive(): boolean {
  return document.body.dataset.audioActive === 'true';
}

export function formatAudioSourceLabel(source: AudioSource | undefined | null) {
  switch (source) {
    case 'demo':
      return 'Demo audio';
    case 'microphone':
      return 'Mic';
    case 'tab':
      return 'Tab audio';
    case 'youtube':
      return 'YouTube tab';
    default:
      return 'Waiting for sound';
  }
}

export function formatPresetSupportLabel(entry: PresetCatalogEntry) {
  const visualCertification = entry.visualCertification;
  const fidelityTier = entry.fidelityTier;

  if (fidelityTier === 'semantic-only') {
    return 'Parsed (not measured)';
  }

  if (fidelityTier === 'unmeasured') {
    return 'No evidence';
  }

  if (
    visualCertification?.status === 'certified' &&
    visualCertification.measured
  ) {
    if (
      entry.expectedFidelityClass === 'exact' ||
      entry.expectedFidelityClass === 'near-exact'
    ) {
      return 'Measured parity';
    }
    return 'Measured approximation';
  }
  if (
    entry.expectedFidelityClass === 'fallback' ||
    entry.supports?.webgpu === false
  ) {
    return 'Simplified render';
  }
  if (
    visualCertification?.requiredBackend === 'webgpu' &&
    visualCertification.status !== 'certified'
  ) {
    return 'Runtime checked';
  }
  if (entry.expectedFidelityClass === 'partial') {
    return 'Approximate match';
  }
  if (entry.supports?.webgpu) {
    return 'Extra detail ready';
  }
  return 'Smooth playback';
}

export function formatPresetSupportNote(entry: PresetCatalogEntry) {
  const visualCertification = entry.visualCertification;
  const fidelityTier = entry.fidelityTier;

  if (fidelityTier === 'semantic-only') {
    return 'Compiler parses this preset, but visual verification is not yet recorded.';
  }

  if (fidelityTier === 'unmeasured') {
    return 'No compatibility evidence has been collected for this preset yet.';
  }

  if (
    visualCertification?.status === 'certified' &&
    visualCertification.measured
  ) {
    if (
      entry.expectedFidelityClass === 'exact' ||
      entry.expectedFidelityClass === 'near-exact'
    ) {
      return 'Measured against the reference render on WebGPU.';
    }
    return 'Measured against the reference render, with known approximations.';
  }
  if (
    entry.expectedFidelityClass === 'fallback' ||
    entry.supports?.webgpu === false
  ) {
    return 'Uses a fallback renderer or a simplified version until WebGPU parity improves.';
  }
  if (
    visualCertification?.requiredBackend === 'webgpu' &&
    visualCertification.status !== 'certified'
  ) {
    return visualCertification.measured
      ? (visualCertification.reasons[0] ??
          'Measured WebGPU parity did not pass yet; this is the current runtime output.')
      : 'Runs on WebGPU, but measured parity is still pending.';
  }
  if (entry.expectedFidelityClass === 'partial') {
    return 'Runs in the browser with visible approximations.';
  }
  if (entry.supports?.webgpu) {
    return 'Adds extra detail when newer GPU features are available.';
  }
  return 'Prioritizes smooth playback on lighter hardware.';
}

export function getPresetCardSupportLabel(entry: PresetCatalogEntry) {
  const label = formatPresetSupportLabel(entry);
  return label === 'Smooth playback' ? null : label;
}

export function mapRuntimeCatalogEntry(
  entry: MilkdropCatalogEntry,
): PresetCatalogEntry {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    authorUrl: resolveAuthorUrl(entry.author, entry.authorUrl),
    derivedFrom: entry.derivedFrom,
    file: entry.bundledFile,
    tags: entry.tags,
    isFavorite: entry.isFavorite,
    rating: entry.rating,
    historyIndex:
      entry.historyIndex !== undefined && entry.historyIndex >= 0
        ? entry.historyIndex
        : undefined,
    lastOpenedAt: entry.lastOpenedAt,
    expectedFidelityClass: entry.fidelityClass,
    similarity: entry.similarity,
    fidelityTier: entry.fidelityTier,
    visualCertification: entry.visualCertification,
    supports: {
      webgl: entry.supports.webgl.status === 'supported',
      webgpu: entry.supports.webgpu.status === 'supported',
    },
    preview: entry.preview,
  };
}

export function mergeCatalogActivity(
  baseEntries: PresetCatalogEntry[],
  activityEntries: PresetCatalogEntry[],
) {
  const activityById = new Map(
    activityEntries.map((entry) => [entry.id, entry] as const),
  );
  const merged = baseEntries.map((entry) => {
    const activityEntry = activityById.get(entry.id);
    if (!activityEntry) {
      return entry;
    }

    return {
      ...entry,
      isFavorite: activityEntry.isFavorite ?? entry.isFavorite,
      historyIndex: activityEntry.historyIndex ?? entry.historyIndex,
      lastOpenedAt: activityEntry.lastOpenedAt ?? entry.lastOpenedAt,
    };
  });

  const seenIds = new Set(merged.map((entry) => entry.id));
  activityEntries.forEach((entry) => {
    if (!seenIds.has(entry.id)) {
      merged.push(entry);
    }
  });

  return merged;
}

export function pickRecentPresets(
  entries: PresetCatalogEntry[],
  limit = 3,
): PresetCatalogEntry[] {
  return entries
    .filter(
      (entry) => entry.historyIndex !== undefined && entry.historyIndex >= 0,
    )
    .sort((left, right) => {
      const leftHistory = left.historyIndex ?? Number.MAX_SAFE_INTEGER;
      const rightHistory = right.historyIndex ?? Number.MAX_SAFE_INTEGER;
      if (leftHistory !== rightHistory) {
        return leftHistory - rightHistory;
      }
      const leftOpenedAt = left.lastOpenedAt ?? 0;
      const rightOpenedAt = right.lastOpenedAt ?? 0;
      return rightOpenedAt - leftOpenedAt;
    })
    .slice(0, limit);
}

export function pickFavoritePresets(
  entries: PresetCatalogEntry[],
  limit = 3,
): PresetCatalogEntry[] {
  return entries
    .filter((entry) => entry.isFavorite)
    .sort((left, right) => {
      const leftOpenedAt = left.lastOpenedAt ?? 0;
      const rightOpenedAt = right.lastOpenedAt ?? 0;
      if (leftOpenedAt !== rightOpenedAt) {
        return rightOpenedAt - leftOpenedAt;
      }
      const leftHistory = left.historyIndex ?? Number.MAX_SAFE_INTEGER;
      const rightHistory = right.historyIndex ?? Number.MAX_SAFE_INTEGER;
      if (leftHistory !== rightHistory) {
        return leftHistory - rightHistory;
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}

export function buildLaunchIntent(routeState: SessionRouteState): LaunchIntent {
  return {
    presetId: routeState.presetId,
    collectionTag: routeState.collectionTag,
    panel: routeState.panel === 'editor' ? routeState.panel : null,
    audioSource: routeState.audioSource,
    agentMode: routeState.agentMode,
    previewMode: routeState.previewMode,
  };
}

export function getSettingsPresetOptions() {
  return DEFAULT_QUALITY_PRESETS;
}

export function getQualityImpactSummary(preset: QualityPreset) {
  return describeQualityPresetImpact(preset);
}

export type ImageToPresetResponse = {
  description?: string;
  milkSource?: string;
  presetId?: string;
  title?: string;
};

export type ImageToPresetAction =
  | {
      kind: 'generated-source';
      description: string;
      source: string;
      title: string;
    }
  | {
      kind: 'preset-id';
      description: string;
      presetId: string;
    };

export function resolveImageToPresetAction(
  data: ImageToPresetResponse,
): ImageToPresetAction | null {
  const description = data.description?.trim() || 'Generated from image.';
  const source = data.milkSource?.trim();
  if (source) {
    return {
      kind: 'generated-source',
      description,
      source,
      title: data.title?.trim() || 'Image generated preset',
    };
  }
  const presetId = data.presetId?.trim();
  if (presetId) {
    return {
      kind: 'preset-id',
      description,
      presetId,
    };
  }
  return null;
}
