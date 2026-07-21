import type { MotionPreference } from '../core/motion-preferences.ts';
import {
  DEFAULT_QUALITY_PRESETS,
  describeQualityPresetImpact,
  type QualityPreset,
} from '../core/settings-panel.ts';
import type { RenderPreferences } from '../core/state/render-preference-store.ts';
import type { MilkdropCatalogEntry } from '../milkdrop/types.ts';
import type {
  AudioSource,
  LaunchIntent,
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';

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
      return 'Browse';
    case 'editor':
      return 'Edit';
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
  'collection:cream-of-the-crop': 'Cream of the Crop',
  'collection:classic-milkdrop': 'Classic MilkDrop',
  'collection:rovastar-and-collaborators': 'Rovastar & Collaborators',
  'collection:touch-friendly': 'Touch Friendly',
};

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
    'collection:cream-of-the-crop',
    'collection:classic-milkdrop',
    'collection:rovastar-and-collaborators',
    'collection:touch-friendly',
    'collection:bright',
    'collection:space',
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
}: {
  searchQuery: string;
  collectionTag: string | null;
}) {
  const appliedFilters = [
    searchQuery.trim().length > 0 ? `Search: "${searchQuery.trim()}"` : null,
    collectionTag
      ? `Collection: ${prettifyCollectionTag(collectionTag)}`
      : null,
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
  const searchIndex = buildPresetSearchIndex(entry);
  presetSearchIndexCache.set(entry, searchIndex);
  return searchIndex;
}

const moodCache = new Map<string, string>();

export function describePresetMood(entry: PresetCatalogEntry) {
  const cached = moodCache.get(entry.id);
  if (cached) return cached;

  const index = buildPresetSearchIndex(entry);
  let mood: string;

  if (/(glow|sun|flare|star|light|bloom)/u.test(index)) {
    mood = 'Bright pulse';
  } else if (/(cube|matrix|square|line|grid|trace)/u.test(index)) {
    mood = 'Sharp geometry';
  } else if (
    /(quasar|ether|parallel|space|mars|radiation|vacuum)/u.test(index)
  ) {
    mood = 'Space drift';
  } else if (/(dark|ritual|apocalypse|demon|moon)/u.test(index)) {
    mood = 'Moody sweep';
  } else if (/(trippy|psychaos|rotation|spectro|glassworms)/u.test(index)) {
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
    fidelityTier: entry.fidelityTier,
    visualCertification: entry.visualCertification,
    supports: {
      webgl: entry.supports.webgl.status === 'supported',
      webgpu: entry.supports.webgpu.status === 'supported',
    },
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
    panel:
      routeState.panel === 'editor' || routeState.panel === 'inspector'
        ? routeState.panel
        : null,
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
