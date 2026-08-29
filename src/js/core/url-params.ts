/**
 * Canonical panel and audio-source unions.
 *
 * These live in core rather than frontend/contracts.ts because core cannot
 * import from frontend, and both files used to declare their own copy. The
 * copies had already drifted — this one was missing 'refine', 'finder', and
 * 'synthesize', which is precisely why those panels were not URL-addressable.
 * frontend/contracts.ts re-exports these; do not reintroduce a second union.
 */
export type PanelState =
  | 'browse'
  | 'capture'
  | 'editor'
  | 'finder'
  | 'refine'
  | 'settings'
  | 'synthesize'
  | null;
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
  /** A ?tool=/?panel= value that matched no known panel, for shell feedback. */
  invalidPanel: string | null;
  /**
   * YouTube video the link was shared with. Without this, `audio=youtube`
   * restores the source mode but leaves the user staring at an empty input.
   */
  youtubeVideoId: string | null;
  /** Start offset in seconds for {@link youtubeVideoId}. */
  youtubeStartSeconds: number | null;
  /**
   * Watch-together room name from `?sync=`. Consumed by the sync bridge, not
   * part of canonical session state; it survives as a preserved unknown param.
   */
  syncRoom: string | null;
}

export interface PerformanceURLParams {
  maxPixelRatio: number | null;
  particleBudget: number | null;
  shaderQuality: string | null;
  /**
   * Pins the adaptive quality controller to a fixed step so performance runs
   * measure frame time at constant quality. Without this the controller trades
   * frame time for visual quality, which hides both wins and regressions.
   */
  lockedQualityStep: number | null;
  /**
   * Pins the resolution multipliers to 1 while leaving mesh/wave density at
   * whatever the step specifies. Parity captures set it so a frame is not
   * supersampled at 1.25x and then downsampled, where the projectM reference
   * renders natively.
   */
  nativeResolution: boolean;
  /**
   * Forces the power-saver mode (`auto`/`on`/`off`) for this session, so a QA
   * link can pin the frame cap instead of waiting for a laptop to discharge.
   * Left as a raw string; `power-saver-store` owns the normalization.
   */
  powerSaver: string | null;
}

export interface MockAudioURLParams {
  type: string | null;
  frequency: number | null;
}

export interface HarnessURLParams {
  component: string | null;
  props: string | null;
  grid: string | null;
}

export interface FlagURLParams {
  /** `?debug=hud` mounts the on-canvas debug HUD (the only diagnostic surface). */
  debug: string | null;
  /** `?liveTiles` renders catalog tiles with live engine instances. */
  liveTiles: boolean;
  /** `?strudel` mounts the Strudel live-coding lab. */
  strudel: boolean;
}

export interface WebGpuFlagURLParams {
  proceduralMainWave: boolean | null;
  proceduralTrailWaves: boolean | null;
  proceduralCustomWaves: boolean | null;
  proceduralMesh: boolean | null;
  proceduralMotionVectors: boolean | null;
  directFeedbackShaders: boolean | null;
  descriptorFallbackToWebgl: boolean | null;
  gpuComputeVM: boolean | null;
  renderBundles: boolean | null;
  shaderBranchDesugar: boolean | null;
}

export interface ParsedURLParams {
  routing: RoutingURLParams;
  renderer: RequestedRenderer;
  corpus: string | null;
  /**
   * `?seed=<integer>` — makes autoplay's weighted random preset pick
   * reproducible. Without it a flaky "shuffle crashed on some preset" is
   * unreproducible; with it, CI/an agent can replay the exact sequence to
   * bisect which pick triggered the failure. See core/deterministic-random.ts.
   */
  seed: number | null;
  performance: PerformanceURLParams;
  audioMock: MockAudioURLParams;
  /**
   * Legacy alias for the debug HUD. `?stats=1` used to open a separate
   * stats-gl panel; it now enables (and persists) the same HUD as
   * `?debug=hud`, and `?stats=0` clears the persisted opt-in.
   */
  stats: '1' | '0' | null;
  tvOverride: string | null;
  flags: FlagURLParams;
  harness: HarnessURLParams;
  webgpuFlags: WebGpuFlagURLParams;
}

/**
 * Every panel is addressable. 'refine', 'finder', and 'synthesize' were
 * missing here for no reason anyone recorded — they simply never got added as
 * they shipped — which meant the AI panels, the newest capability in the app,
 * could not be linked, bookmarked, or restored across a reload.
 */
const VALID_PANELS = new Set<Exclude<PanelState, null>>([
  'browse',
  'capture',
  'editor',
  'finder',
  'refine',
  'settings',
  'synthesize',
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

/** YouTube ids are exactly 11 URL-safe base64 characters. */
const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

function normalizeYouTubeVideoId(value: unknown): string | null {
  const str = readParamValue(value)?.trim() ?? '';
  return YOUTUBE_ID_PATTERN.test(str) ? str : null;
}

function parseNumberParam(val: string | null): number | null {
  if (!val) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function parseBoolParam(val: string | null): boolean | null {
  if (!val) return null;
  const lower = val.trim().toLowerCase();
  if (lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on')
    return true;
  if (lower === '0' || lower === 'false' || lower === 'no' || lower === 'off')
    return false;
  return null;
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
      // A misspelled ?tool= used to normalize to null and drop you on the
      // stage with no explanation. Keep the rejected value so the shell can
      // say which name it did not recognize.
      invalidPanel: (() => {
        const requested = readParamValue(get('tool') ?? get('panel'))
          ?.trim()
          .toLowerCase();
        if (!requested) return null;
        const mapped = LEGACY_PANEL_ALIASES[requested] ?? requested;
        return VALID_PANELS.has(mapped as Exclude<PanelState, null>)
          ? null
          : requested;
      })(),
      audioSource: normalizeEnum(
        get('audio'),
        VALID_AUDIO_SOURCES,
        LEGACY_AUDIO_ALIASES,
      ),
      agentMode: isAgent,
      previewMode:
        get('embedded') === 'true' ||
        get('preview') === 'true' ||
        get('embed') === 'true' ||
        get('chromeless') === 'true',
      invalidExperienceSlug:
        legacyExperience && legacyExperience !== 'milkdrop'
          ? legacyExperience
          : null,
      youtubeVideoId: normalizeYouTubeVideoId(params.get('yt')),
      youtubeStartSeconds: (() => {
        const seconds = parseNumberParam(get('t'));
        return seconds != null && seconds > 0 ? Math.floor(seconds) : null;
      })(),
      syncRoom: get('sync')?.trim() || null,
    },
    renderer,
    corpus: get('corpus')?.trim() || null,
    seed: parseNumberParam(get('seed')),
    performance: {
      maxPixelRatio: parseNumberParam(get('maxPixelRatio')),
      particleBudget: parseNumberParam(get('particleBudget')),
      shaderQuality: get('shaderQuality')?.trim() || null,
      lockedQualityStep: parseNumberParam(get('lockQualityStep')),
      // `?nativeResolution=1` pins the resolution multipliers to 1 without
      // touching mesh/wave density. Parity captures use it so a frame is not
      // supersampled and downsampled against a reference rendered natively.
      nativeResolution: get('nativeResolution')?.trim() === '1',
      powerSaver: get('powerSaver')?.trim() || null,
    },
    audioMock: {
      type: get('mockAudio')?.trim() || null,
      frequency: parseNumberParam(get('mockFrequency')),
    },
    stats,
    tvOverride: tvRaw?.trim() || null,
    flags: {
      debug: get('debug')?.trim() || null,
      liveTiles: params.has('liveTiles'),
      strudel: params.has('strudel'),
    },
    harness: {
      component: get('component')?.trim() || null,
      props: get('props') || null,
      grid: get('grid')?.trim() || null,
    },
    webgpuFlags: {
      proceduralMainWave: parseBoolParam(get('milkdrop-webgpu-main-wave')),
      proceduralTrailWaves: parseBoolParam(get('milkdrop-webgpu-trail-waves')),
      proceduralCustomWaves: parseBoolParam(
        get('milkdrop-webgpu-custom-waves'),
      ),
      proceduralMesh: parseBoolParam(get('milkdrop-webgpu-mesh')),
      proceduralMotionVectors: parseBoolParam(
        get('milkdrop-webgpu-motion-vectors'),
      ),
      directFeedbackShaders: parseBoolParam(get('milkdrop-webgpu-feedback')),
      descriptorFallbackToWebgl: parseBoolParam(
        get('milkdrop-webgpu-fallback'),
      ),
      gpuComputeVM: parseBoolParam(get('milkdrop-webgpu-compute-vm')),
      renderBundles: parseBoolParam(get('milkdrop-webgpu-render-bundles')),
      shaderBranchDesugar: parseBoolParam(
        get('milkdrop-webgpu-branch-desugar'),
      ),
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

export function getPowerSaverOverride(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): string | null {
  return parseURLParams(input).performance.powerSaver;
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

export function getWebGpuFlagParams(
  input?: string | URL | Location | URLSearchParams | Record<string, unknown>,
): WebGpuFlagURLParams {
  return parseURLParams(input).webgpuFlags;
}
