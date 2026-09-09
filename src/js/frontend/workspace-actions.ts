/**
 * Shared behavior bodies for workspace actions.
 *
 * Three surfaces expose the same verbs — the stage dock's ☰ menu, the ⌘K
 * command palette, and window.__stims_agent.run — and while they shared ids
 * (guarded by scripts/check-agent-action-ids.ts) they did not share
 * implementations. That drifted in practice: the menu's "Record video"
 * auto-started recording with the remembered format while the palette's
 * "Record video" only opened the form. Each behavior here exists once;
 * surfaces keep their own presentation (labels, icons, focus handling) and
 * call in.
 */

import { shareOrCopyLink } from '../utils/media/share-link.ts';
import type {
  AudioSource,
  PanelState,
  PresetCatalogEntry,
} from './contracts.ts';
import {
  leaveSyncSession,
  setSyncUrlParam,
  startOrCopyWatchParty,
} from './sync-session.ts';
import { buildRemixShareUrl } from './url-state.ts';
import { recentlyOpenedPresetIds } from './workspace-helpers.ts';

export interface PanelSurface {
  updatePanel: (panel: PanelState) => void;
  routePanel: () => PanelState;
}

/** Toggle semantics shared by every panel verb: same panel closes, any
 * other opens. The palette used plain-open while the menu toggled — now
 * both toggle. */
export function togglePanel(surface: PanelSurface, panel: PanelState): void {
  surface.updatePanel(surface.routePanel() === panel ? null : panel);
}

/**
 * Record video: repeat use starts recording immediately with the
 * remembered format (CapturePanel's mount effect consumes the flag);
 * first-ever use (no stored format) just opens the form.
 */
export function openRecordPanel(surface: PanelSurface): void {
  if (surface.routePanel() === 'capture') {
    surface.updatePanel(null);
    return;
  }
  try {
    if (localStorage.getItem('stims:capture-format')) {
      sessionStorage.setItem('stims:capture-autostart', '1');
    }
  } catch {
    // Storage is unavailable (private mode, quota): the capture panel still
    // opens, it just will not auto-start with the remembered format.
  }
  surface.updatePanel('capture');
}

export interface TransitionEngine {
  setTransitionMode: (mode: 'blend' | 'cut') => void;
  setBlendDuration: (seconds: number) => void;
}

export function describeTransition(
  mode: 'blend' | 'cut',
  seconds: number,
): string {
  return mode === 'cut' ? 'Instant cut' : `Blend ${seconds}s`;
}

export function setTransition(
  engine: TransitionEngine,
  announce: (message: string) => void,
  mode: 'blend' | 'cut',
  seconds: number,
): void {
  engine.setTransitionMode(mode);
  if (mode === 'blend') {
    engine.setBlendDuration(seconds);
  }
  announce(`Transition: ${describeTransition(mode, seconds)}`);
}

export function startAudioSource(
  engine: {
    handleAudioStart: (source: AudioSource) => Promise<void> | void;
  },
  source: 'demo' | 'microphone' | 'tab',
): void {
  void engine.handleAudioStart(source);
}

export function toggleAutoplay(
  engine: { setAutoplay: (enabled: boolean) => void },
  announce: (message: string) => void,
  currentlyEnabled: boolean,
): void {
  const next = !currentlyEnabled;
  engine.setAutoplay(next);
  announce(next ? 'Autoplay on.' : 'Autoplay off.');
}

/** One action: create the room (unless already hosting) and put the invite
 * link on the clipboard. Re-exported so both surfaces import from here. */
export function startOrCopyWatchPartyAction(
  announce: (message: string) => void,
): void {
  void startOrCopyWatchParty(announce);
}

/**
 * Put a link to the current preset — including the unsaved editor draft — on
 * the clipboard.
 *
 * The `#code=` hash has been written into the address bar on every keystroke
 * since remix links shipped, so copying the URL by hand already worked. What
 * did not exist was any way to learn that: no control produced the link, and
 * nothing named it, so the only people who could share a work-in-progress
 * preset were the ones who had read `buildRemixShareUrl`.
 *
 * Built from the passed source rather than read off `window.location`,
 * because the effect that maintains the hash runs after a render and the
 * keystroke that prompted this copy may not have reached it yet.
 */
export async function copyRemixLinkAction({
  source,
  dirty,
  announce,
  share = shareOrCopyLink,
  href = typeof window === 'undefined' ? '' : window.location.href,
}: {
  source: string;
  dirty: boolean;
  announce: (message: string) => void;
  /** Test seam for the clipboard/native-share path. */
  share?: typeof shareOrCopyLink;
  href?: string;
}): Promise<void> {
  if (!href) return;
  const url = buildRemixShareUrl(href, dirty && source ? source : null);
  // Whether the draft actually made it into the link, rather than whether we
  // asked for it. `buildRemixShareUrl` returns the URL unchanged if the hash
  // cannot be built, and announcing "carries your unsaved edits" over a link
  // that carries none sends the recipient to an empty editor, or to whatever
  // stale draft the old hash held.
  const carriesDraft = Boolean(dirty && source) && url.includes('#code=');
  const result = await share(url, {
    title: 'Stims preset',
    text: dirty
      ? 'Open this Stims preset draft in the editor.'
      : 'Open this Stims preset.',
  });

  if (result === 'cancelled') return;

  if (result === 'shared' || result === 'copied') {
    const verb = result === 'shared' ? 'shared' : 'copied';
    announce(
      carriesDraft
        ? `Link ${verb} — it carries your unsaved edits, and opens in their editor.`
        : `Link ${verb}.`,
    );
    return;
  }

  // No clipboard and no native share: the address bar is the fallback, and
  // it already holds the same URL, so say that rather than reporting failure.
  announce(
    carriesDraft
      ? 'Could not reach the clipboard. The address bar already holds this link, edits included.'
      : 'Could not reach the clipboard. Copy the link from the address bar.',
  );
}

export function endWatchParty(announce: (message: string) => void): void {
  leaveSyncSession();
  setSyncUrlParam(null);
  announce('Watch party ended — viewers keep local control.');
}

/** Point a camera at the preset's video sampler, or turn it back off. */
export function toggleCameraAction(announce: (message: string) => void): void {
  void (async () => {
    const {
      toggleCameraVideoSource,
      isCameraVideoSupported,
      CameraVideoError,
    } = await import('../core/services/camera-video-source.ts');
    if (!isCameraVideoSupported()) {
      announce('This browser cannot open a camera.');
      return;
    }
    try {
      const on = await toggleCameraVideoSource();
      announce(
        on
          ? 'Camera on — presets that sample video now see it.'
          : 'Camera off.',
      );
    } catch (error) {
      announce(
        error instanceof CameraVideoError
          ? error.message
          : 'Could not start the camera.',
      );
    }
  })();
}

/**
 * Put the show on a projector, second monitor, or Chromecast. The external
 * display loads this tab's watch-party link, so it renders the show itself
 * and follows every preset change — no video is streamed to it.
 */
export function presentToExternalDisplayAction(
  announce: (message: string) => void,
): void {
  void (async () => {
    const [display, { ensureHostRoom }] = await Promise.all([
      import('../core/services/external-display-service.ts'),
      import('./sync-session.ts'),
    ]);
    if (display.getExternalDisplayState().mode !== null) {
      display.stopExternalDisplay();
      announce('External display disconnected.');
      return;
    }
    if (!display.isCastSupported() && !display.isSecondScreenSupported()) {
      announce('This browser cannot drive a second screen or cast.');
      return;
    }
    const hosted = await ensureHostRoom();
    if (!hosted) {
      announce('Could not prepare the link for the external display.');
      return;
    }
    try {
      await display.presentToExternalDisplay(hosted.url);
      const state = display.getExternalDisplayState();
      if (state.mode === null) return; // Picker dismissed.
      // Not a mirror, and saying "showing on X" invited people to expect
      // one: the receiver loads the sync link and renders its OWN copy, so
      // it follows preset changes but reacts to whatever audio IT can hear.
      // On this machine that is the same input; on a cast device there is
      // no input at all, and the visuals will not be beat-matched to the
      // room. Better to know that before the set than during it.
      announce(
        state.mode === 'window'
          ? `Showing on ${state.target ?? 'the second screen'} — it renders its own copy and uses its own audio input.`
          : 'Casting — the receiver follows every preset you play, but reacts to its own audio, not this machine’s input.',
      );
    } catch {
      announce(
        display.getExternalDisplayState().error ??
          'Could not reach an external display.',
      );
    }
  })();
}

/**
 * How many recently-played presets a nearby jump refuses to land on.
 *
 * Named `_LIMIT` on purpose: it is the bound on the exclusion Set built
 * below, and `check-cache-bounds.ts` reads the name to prove that set cannot
 * grow without one.
 *
 * Without this, "Nearby" against a strong match is a two-preset loop: the
 * nearest neighbour of B is usually A, so the second press walks straight
 * back. Wandering has to keep moving even when the neighbourhood is small.
 */
export const NEARBY_RECENT_EXCLUSION_LIMIT = 8;

/**
 * How many matches a nearby jump asks the index for.
 *
 * Must exceed {@link NEARBY_RECENT_EXCLUSION_LIMIT}, or the control is
 * guaranteed to exhaust: every candidate ends up in the recency window and
 * there is nothing left to play. Measured on the deployed index before this
 * existed — the endpoint's default of five against an eight-deep exclusion
 * ran dry after four presses, which reads as a broken button rather than a
 * small neighbourhood.
 */
export const NEARBY_SEARCH_RESULTS = 25;

/**
 * The nearby search currently on the wire, so a newer press can cancel it.
 *
 * Module-scoped because the control is module-scoped: the dock button and the
 * palette entry are two doors onto one stage, and a press at either supersedes
 * whatever the other started.
 */
let inFlightNearby: AbortController | null = null;

/** Test seam: forget any in-flight search between cases. */
export function resetNearbyPresetState(): void {
  inFlightNearby = null;
}

export interface NearbyPresetRequest {
  /** The stage canvas, which is the query — nearby means "looks like this". */
  canvas: HTMLCanvasElement | null;
  currentPresetId: string | null;
  /** Most-recent-first; the head of this list is what we refuse to repeat. */
  recentPresetIds: string[];
  /** Guards against playing an id the index knows and this build does not. */
  isKnownPreset: (presetId: string) => boolean;
  play: (presetId: string) => void;
  announce: (message: string) => void;
  /**
   * Test seam for the index lookup.
   *
   * An injected function rather than `mock.module`: mocking a module in this
   * graph and re-importing it is a known way to hang `bun test` here, and the
   * behaviour worth testing is the filtering around the lookup, not the fetch
   * inside it.
   */
  searchByFrame?: (
    canvas: HTMLCanvasElement,
    signal?: AbortSignal,
    topK?: number,
  ) => Promise<Array<{ presetId: string; score: number }>>;
}

/**
 * Assembles a nearby request from the two things every caller actually has:
 * the stage element and the catalog.
 *
 * Both entry points — the dock button and the command palette — used to build
 * this object by hand, and had already drifted apart on how the current
 * preset was derived, so one press could exclude a different preset depending
 * on which control you reached it from.
 */
export function nearbyPresetRequest({
  stage,
  catalog,
  currentPresetId,
  play,
  announce,
}: {
  stage: HTMLElement | null;
  catalog: PresetCatalogEntry[];
  currentPresetId: string | null;
  play: (presetId: string) => void;
  announce: (message: string) => void;
}): NearbyPresetRequest {
  return {
    canvas: stage?.querySelector('canvas') ?? null,
    currentPresetId,
    recentPresetIds: recentlyOpenedPresetIds(catalog),
    isKnownPreset: (presetId) => catalog.some((e) => e.id === presetId),
    play,
    announce,
  };
}

/**
 * Play the nearest look-alike to what is on screen.
 *
 * This is the small step next to shuffle's big one: same wandering loop, but
 * the next preset is chosen for resemblance instead of at random. It rides
 * the visual-embedding index that already backs the finder's "by look" tab,
 * so there is one definition of "similar" in the app rather than two.
 *
 * The index lives behind `/api/visual-search`, which the Vite dev server does
 * not serve — `resolveOptionalApiUrl` returns null there and `searchByFrame`
 * throws. That is a real limit of local development, not a failure state, and
 * it is worth saying so plainly rather than reporting a broken feature.
 */
export async function playNearbyPreset({
  canvas,
  currentPresetId,
  recentPresetIds,
  isKnownPreset,
  play,
  announce,
  searchByFrame: injectedSearch,
}: NearbyPresetRequest): Promise<void> {
  if (!canvas) {
    announce('Nothing on the stage to match yet.');
    return;
  }

  // A press supersedes the one before it. Two searches in flight both reach
  // play(), and the slower one lands second with an exclusion set built
  // before the first jump — so the stage moves twice and can land on the
  // preset the recency window was there to avoid.
  inFlightNearby?.abort();
  const attempt = new AbortController();
  inFlightNearby = attempt;
  const superseded = () => attempt.signal.aborted;

  announce('Looking for something nearby…');

  let matches: Array<{ presetId: string; score: number }>;
  try {
    // Deferred so the embedding client and its schema stay out of the initial
    // bundle; the dock button is on screen from the first frame, and almost
    // nobody presses it before the stage is running. Inside the try because a
    // chunk that fails to load rejects here, and every caller invokes this as
    // a bare `void` — an escape becomes an unhandled rejection with the status
    // line stuck on "Looking for something nearby…".
    const searchByFrame =
      injectedSearch ??
      (await import('../core/services/visual-embedding.ts')).searchByFrame;
    matches = await searchByFrame(
      canvas,
      attempt.signal,
      NEARBY_SEARCH_RESULTS,
    );
  } catch (error) {
    if (superseded()) return;
    // Matched on the error's declared `name`, not on its message: the class
    // is exported from a module this one deliberately does not import
    // statically, and `name` is a discriminant the type states rather than
    // prose that reads as rewordable. Same shape as DOMException's AbortError.
    const unavailable =
      error instanceof Error && error.name === 'VisualSearchUnavailableError';
    announce(
      unavailable
        ? 'Nearby needs the visual search index, which the dev server does not run. It works on the deployed site.'
        : 'Could not reach the visual search index. Try again in a moment.',
    );
    return;
  }

  // A newer press already owns the stage; landing this one would undo it.
  if (superseded()) return;

  const excluded = new Set(
    recentPresetIds.slice(0, NEARBY_RECENT_EXCLUSION_LIMIT),
  );
  if (currentPresetId) excluded.add(currentPresetId);

  const next = matches.find(
    (match) => !excluded.has(match.presetId) && isKnownPreset(match.presetId),
  );

  if (!next) {
    // A neighbourhood can genuinely run out — a preset with few look-alikes,
    // all of them just played. Saying so beats silently doing nothing, and
    // names the control that does still have somewhere to go.
    announce('No new neighbours for this one. Try Surprise me.');
    return;
  }

  play(next.presetId);
}
