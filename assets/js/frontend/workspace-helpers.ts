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

export type ReadinessItem = {
  id: string;
  label: string;
  state: 'ready' | 'warn' | 'blocked';
  summary: string;
};

export type StarterPreset = {
  key: string;
  label: string;
  summary: string;
  preset: PresetCatalogEntry;
};

export type WorkspaceLaunchState = {
  engineReady: boolean;
  featuredPreset: PresetCatalogEntry | null;
  launchControlsHidden: boolean;
  launchEyebrow: string;
  launchTitle: string;
  launchSummary: string;
  readinessAlerts: ReadinessItem[];
  showExtendedSources: boolean;
  youtubeReady: boolean;
  youtubeUrl: string;
};

export type WorkspaceStageState = {
  audioSource: AudioSource | null | undefined;
  backend: 'webgl' | 'webgpu' | null | undefined;
  featuredPreset: PresetCatalogEntry | null;
  missingRequestedPreset: boolean;
  invalidExperienceSlug: string | null;
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
  'inspector',
  'settings',
];

export function getToolLabel(tool: Exclude<PanelState, null>) {
  switch (tool) {
    case 'browse':
      return 'Presets';
    case 'editor':
      return 'Edit';
    case 'inspector':
      return 'Inspect';
    case 'settings':
      return 'Settings';
  }
}

export function getToolDescription(tool: Exclude<PanelState, null>) {
  switch (tool) {
    case 'browse':
      return 'Browse or shuffle presets.';
    case 'editor':
      return 'Edit the active preset.';
    case 'inspector':
      return 'Inspect the active preset.';
    case 'settings':
      return 'Tune only what you need.';
  }
}

export function prettifyCollectionTag(collectionTag: string) {
  return collectionTag
    .replace(/^collection:/u, '')
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

export function matchesPreset(entry: PresetCatalogEntry, query: string) {
  if (!query) {
    return true;
  }

  const haystack = [entry.title, entry.author, entry.id, ...(entry.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
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

export function buildPresetSearchIndex(entry: PresetCatalogEntry) {
  return [entry.id, entry.title, entry.author, ...(entry.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function describePresetMood(entry: PresetCatalogEntry) {
  const index = buildPresetSearchIndex(entry);

  if (/(glow|sun|flare|star|light|bloom)/u.test(index)) {
    return 'Bright pulse';
  }
  if (/(cube|matrix|square|line|grid|trace)/u.test(index)) {
    return 'Sharp geometry';
  }
  if (/(quasar|ether|parallel|space|mars|radiation|vacuum)/u.test(index)) {
    return 'Space drift';
  }
  if (/(dark|ritual|apocalypse|demon|moon)/u.test(index)) {
    return 'Moody sweep';
  }
  if (/(trippy|psychaos|rotation|spectro|glassworms)/u.test(index)) {
    return 'Psychedelic spin';
  }
  if (entry.tags?.includes('collection:classic-milkdrop')) {
    return 'Classic rush';
  }
  return 'Instant pick';
}

export function buildStarterPresets(entries: PresetCatalogEntry[]) {
  const usedPresetIds = new Set<string>();
  const starterPresets: StarterPreset[] = [];
  const definitions = [
    {
      key: 'bright-pulse',
      label: 'Bright pulse',
      summary: 'Fast payoff with glowing motion and clean contrast.',
      matchers: [/glowsticks/u, /(sun|flare|star)/u],
    },
    {
      key: 'space-drift',
      label: 'Space drift',
      summary: 'Slower cosmic motion with more room to breathe.',
      matchers: [/(parallel universe|quasar|ether|mars|radiation)/u],
    },
    {
      key: 'sharp-geometry',
      label: 'Sharp geometry',
      summary: 'Hard edges, grids, and satisfying symmetry.',
      matchers: [/(cube|matrix|square|trace|line)/u],
    },
    {
      key: 'classic-rush',
      label: 'Classic rush',
      summary: 'A grounded first pick from the classic MilkDrop lineage.',
      matchers: [/(happy drops|casino|classic milkdrop)/u],
    },
  ];

  definitions.forEach((definition) => {
    const preset = entries.find((entry) => {
      if (usedPresetIds.has(entry.id)) {
        return false;
      }
      const index = buildPresetSearchIndex(entry);
      return definition.matchers.some((matcher) => matcher.test(index));
    });

    if (!preset) {
      return;
    }

    usedPresetIds.add(preset.id);
    starterPresets.push({ ...definition, preset });
  });

  if (starterPresets.length > 0) {
    return starterPresets;
  }

  return entries.slice(0, 3).map((preset, index) => ({
    key: `starter-${preset.id}`,
    label: ['First pick', 'Try next', 'Then go wide'][index] ?? 'Starter',
    summary: 'A quick way into the library without overthinking it.',
    preset,
  }));
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
  if (
    entry.expectedFidelityClass === 'exact' ||
    entry.expectedFidelityClass === 'near-exact'
  ) {
    return 'Full preset';
  }
  if (
    entry.expectedFidelityClass === 'partial' ||
    entry.expectedFidelityClass === 'fallback'
  ) {
    return 'Adjusted preset';
  }
  if (entry.supports?.webgpu) {
    return 'High-detail ready';
  }
  return 'Lighter mode';
}

export function getPresetCardSupportLabel(entry: PresetCatalogEntry) {
  const label = formatPresetSupportLabel(entry);
  return label === 'Adjusted preset' ? null : label;
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
    expectedFidelityClass: entry.fidelityClass,
    supports: {
      webgl: entry.supports.webgl.status === 'supported',
      webgpu: entry.supports.webgpu.status === 'supported',
    },
  };
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
  };
}

export function getSettingsPresetOptions() {
  return DEFAULT_QUALITY_PRESETS;
}

export function getQualityImpactSummary(preset: QualityPreset) {
  return describeQualityPresetImpact(preset);
}
