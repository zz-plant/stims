export type PanelState = 'browse' | 'editor' | 'settings' | null;
export type AudioSource = 'demo' | 'file' | 'microphone' | 'tab' | 'youtube';
export type RequestedRenderer = 'webgl' | 'webgpu' | 'auto' | null;

export interface RoutingURLParams {
  presetId: string | null;
  collectionTag: string | null;
  panel: PanelState;
  audioSource: AudioSource | null;
  agentMode: boolean;
  previewMode: boolean;
  invalidExperienceSlug: string | null;
}

export interface PerformanceURLParams {
  maxPixelRatio: number | null;
  particleBudget: number | null;
  shaderQuality: string | null;
}

export interface MockAudioURLParams {
  type: string | null;
  frequency: number | null;
}

export interface OverlayURLParams {
  autoplay: string | null;
  blend: string | null;
  transition: string | null;
}

export interface HarnessURLParams {
  component: string | null;
  props: string | null;
  mockBackend: string | null;
  mockPresetId: string | null;
  mockAudioActive: boolean;
  grid: string | null;
}

export interface ParsedURLParams {
  routing: RoutingURLParams;
  renderer: RequestedRenderer;
  corpus: string | null;
  performance: PerformanceURLParams;
  audioMock: MockAudioURLParams;
  stats: '1' | '0' | null;
  tvOverride: string | null;
  overlay: OverlayURLParams;
  harness: HarnessURLParams;
}

const VALID_PANELS = new Set<Exclude<PanelState, null>>([
  'browse',
  'editor',
  'settings',
]);

const VALID_AUDIO_SOURCES = new Set<AudioSource>([
  'demo',
  'file',
  'microphone',
  'tab',
  'youtube',
]);

const LEGACY_PANEL_ALIASES: Record<string, Exclude<PanelState, null>> = {
  looks: 'browse',
};

const LEGACY_AUDIO_ALIASES: Record<string, AudioSource> = {
  sample: 'demo',
  mic: 'microphone',
};

function readParamValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const first = value.find(
      (v) =>
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean',
    );
    if (first !== undefined) {
      return String(first);
    }
  }
  return null;
}

function normalizeEnum<T extends string>(
  value: unknown,
  validValues: Set<T>,
  aliases: Record<string, T> = {},
): T | null {
  const str = readParamValue(value);
  const normalized = str?.trim().toLowerCase() ?? '';
  if (!normalized) return null;

  const mapped = aliases[normalized] ?? normalized;
  if (!validValues.has(mapped as T)) return null;

  return mapped as T;
}

export function normalizeCollectionTag(value: unknown): string | null {
  const str = readParamValue(value);
  const normalized = str?.trim().toLowerCase() ?? '';
  if (!normalized) return null;

  return normalized.startsWith('collection:')
    ? normalized
    : `collection:${normalized}`;
}

function resolveSearchParams(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): URLSearchParams {
  if (!input) {
    if (typeof window !== 'undefined' && window.location) {
      return new URLSearchParams(window.location.search);
    }
    return new URLSearchParams();
  }

  if (input instanceof URLSearchParams) {
    return input;
  }

  if (typeof input === 'string') {
    const queryStr = input.includes('?')
      ? input.slice(input.indexOf('?'))
      : input.startsWith('#')
        ? ''
        : `?${input}`;
    return new URLSearchParams(queryStr);
  }

  if (input instanceof URL) {
    return input.searchParams;
  }

  if (
    typeof input === 'object' &&
    'search' in input &&
    typeof input.search === 'string'
  ) {
    return new URLSearchParams(input.search);
  }

  if (typeof input === 'object') {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(input)) {
      if (val == null) continue;
      if (Array.isArray(val)) {
        val.forEach((item) => {
          if (item != null) params.append(key, String(item));
        });
      } else {
        params.set(key, String(val));
      }
    }
    return params;
  }

  return new URLSearchParams();
}

function parseNumberParam(val: string | null): number | null {
  if (!val) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

export function parseURLParams(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): ParsedURLParams {
  const params = resolveSearchParams(input);

  const get = (key: string) => readParamValue(params.get(key));

  const legacyExperience = get('experience');
  const isAgent = get('agent') === 'true';

  const rawRenderer = get('renderer')?.trim().toLowerCase();
  const renderer: RequestedRenderer =
    rawRenderer === 'webgl' ||
    rawRenderer === 'webgpu' ||
    rawRenderer === 'auto'
      ? rawRenderer
      : null;

  const statsRaw = get('stats');
  const stats: '1' | '0' | null =
    statsRaw === '1' ? '1' : statsRaw === '0' ? '0' : null;

  const tvRaw = get('tv') ?? get('tvMode');

  return {
    routing: {
      presetId: get('preset')?.trim() || null,
      collectionTag: normalizeCollectionTag(params.get('collection')),
      panel: normalizeEnum(
        get('tool') ?? get('panel'),
        VALID_PANELS,
        LEGACY_PANEL_ALIASES,
      ),
      audioSource: normalizeEnum(
        get('audio'),
        VALID_AUDIO_SOURCES,
        LEGACY_AUDIO_ALIASES,
      ),
      agentMode: isAgent,
      previewMode: get('embedded') === 'true' || get('preview') === 'true',
      invalidExperienceSlug:
        legacyExperience && legacyExperience !== 'milkdrop'
          ? legacyExperience
          : null,
    },
    renderer,
    corpus: get('corpus')?.trim() || null,
    performance: {
      maxPixelRatio: parseNumberParam(get('maxPixelRatio')),
      particleBudget: parseNumberParam(get('particleBudget')),
      shaderQuality: get('shaderQuality')?.trim() || null,
    },
    audioMock: {
      type: get('mockAudio')?.trim() || null,
      frequency: parseNumberParam(get('mockFrequency')),
    },
    stats,
    tvOverride: tvRaw?.trim() || null,
    overlay: {
      autoplay: get('autoplay')?.trim() || null,
      blend: get('blend')?.trim() || null,
      transition: get('transition')?.trim() || null,
    },
    harness: {
      component: get('component')?.trim() || null,
      props: get('props') || null,
      mockBackend: get('mockBackend')?.trim() || null,
      mockPresetId: get('mockPresetId')?.trim() || null,
      mockAudioActive: get('mockAudioActive') === 'true',
      grid: get('grid')?.trim() || null,
    },
  };
}

export function isAgentMode(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): boolean {
  return parseURLParams(input).routing.agentMode;
}

export function getRequestedRenderer(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): RequestedRenderer {
  return parseURLParams(input).renderer;
}

export function getRequestedCorpus(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): string | null {
  return parseURLParams(input).corpus;
}

export function getPerformanceOverrideParams(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): PerformanceURLParams {
  return parseURLParams(input).performance;
}

export function getMockAudioParams(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): MockAudioURLParams {
  return parseURLParams(input).audioMock;
}

export function getSmartTvOverride(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): string | null {
  return parseURLParams(input).tvOverride;
}
