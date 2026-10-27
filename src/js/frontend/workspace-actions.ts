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

import { upsertMilkdropField } from 'milkdrop-toolchain/src/formatter.ts';
import {
  getActiveAccessibilityPreference,
  setAccessibilityPreference,
} from '../core/accessibility-preferences.ts';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import {
  closeProjectorWindow,
  getProjectorState,
  openProjectorWindow,
  placeOnScreen,
} from '../core/services/projector-window-service.ts';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import type { MilkdropPresetLineageRef } from '../milkdrop/types.ts';
import { shareOrCopyLink } from '../utils/media/share-link.ts';
import type {
  AudioSource,
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import { getPanelTitle } from './panel-registry.ts';
import type { QueuedCrossfadeResult } from './performance-hardware-controls.ts';
import {
  leaveSyncSession,
  setSyncUrlParam,
  startOrCopyWatchParty,
} from './sync-session.ts';
import { buildRemixShareUrl, REMIX_URL_FAILED } from './url-state.ts';
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
 * What a panel verb does from where the visitor is. `togglePanel` closes the
 * panel that is already open, and a label that kept saying "Browse presets"
 * while it closed Browse left the outcome to a checkmark.
 */
const PANEL_OPEN_LABELS: Partial<Record<Exclude<PanelState, null>, string>> = {
  finder: 'Find presets that match the music or picture',
};
const PANEL_CLOSE_LABELS: Partial<Record<Exclude<PanelState, null>, string>> = {
  browse: 'Close Browse',
  finder: 'Close the finder',
  synthesize: 'Close Generate with AI',
  refine: 'Close Refine with AI',
  editor: 'Close the editor',
  settings: 'Close Settings',
};

export function panelToggleLabel(
  panel: Exclude<PanelState, null>,
  open: boolean,
): string {
  if (open) return PANEL_CLOSE_LABELS[panel] ?? `Close ${getPanelTitle(panel)}`;
  return PANEL_OPEN_LABELS[panel] ?? getPanelTitle(panel);
}

/**
 * Pause holds the picture. Whether the sound stops too depends on the
 * source: a file or YouTube track pauses with it, while a microphone, a
 * shared tab or the demo loop keeps sounding. The label says which.
 */
export function soundStopsOnPause(source: AudioSource | null): boolean {
  return source === 'file' || source === 'youtube';
}

export function playbackToggleLabel(
  source: AudioSource | null,
  paused: boolean,
): string {
  if (soundStopsOnPause(source)) return paused ? 'Resume' : 'Pause';
  return paused ? 'Resume visuals' : 'Pause visuals';
}

export const SOUND_KEEPS_PLAYING = 'Sound keeps playing.';

const CAPTURE_FORMAT_KEY = 'stims:capture-format';

/** True once a recording format was chosen: Record then starts at once. */
export function hasRememberedCaptureFormat(): boolean {
  try {
    return Boolean(localStorage.getItem(CAPTURE_FORMAT_KEY));
  } catch {
    return false;
  }
}

/**
 * One item opens the form, starts a recording, or closes the panel, which
 * also ends the recording and saves it. Each case gets its own words.
 */
export function recordMenuLabel({
  panelOpen,
  recording,
}: {
  panelOpen: boolean;
  recording: boolean;
}): string {
  if (recording) return 'Stop recording and save';
  if (panelOpen) return 'Close the recording panel';
  return hasRememberedCaptureFormat()
    ? 'Start recording video'
    : 'Record video…';
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
    if (hasRememberedCaptureFormat()) {
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
  // The choice is persisted (runtime-preferences), so a tap mid-set changes
  // the default Settings shows; say so rather than let it look temporary.
  announce(
    `Transition: ${describeTransition(mode, seconds)}. Saved as your default.`,
  );
}

export function startAudioSource(
  engine: {
    handleAudioStart: (source: AudioSource) => Promise<unknown>;
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
  local = false,
  title,
  derivedFrom,
  announce,
  onSuccess,
  share = shareOrCopyLink,
  href = typeof window === 'undefined' ? '' : window.location.href,
}: {
  source: string;
  dirty: boolean;
  /**
   * The preset exists only in this browser (made or imported here). Its id
   * means nothing to anyone else, so the link has to carry the code even
   * when there are no unsaved edits — without it the recipient got "could
   * not be loaded".
   */
  local?: boolean;
  /**
   * The preset's own title, written into a local preset's shared code.
   */
  title?: string;
  /**
   * The preset's remix parents, from its catalog entry's `derivedFrom`.
   * Embedded in the shared code as `remix_of_N_*` fields — the same channel
   * an export uses — so the recipient's import restores the lineage.
   */
  derivedFrom?: readonly MilkdropPresetLineageRef[];
  announce: (message: string) => void;
  onSuccess?: () => void;
  /** Test seam for the clipboard/native-share path. */
  share?: typeof shareOrCopyLink;
  href?: string;
}): Promise<void> {
  if (!href) return;
  const carriesCode = dirty || local;
  let url: string;
  try {
    url = buildRemixShareUrl(
      href,
      carriesCode ? codeForLocalShare(source, { local, dirty, title }) : null,
      derivedFrom,
    );
  } catch (error) {
    announce(error instanceof Error ? error.message : REMIX_URL_FAILED);
    return;
  }
  const carriesDraft = dirty;
  const result = await share(url, {
    title: 'Stims preset',
    text: carriesCode
      ? 'Open this Stims preset draft in the editor.'
      : 'Open this Stims preset.',
  });

  noteGrowthEvent(
    result === 'shared'
      ? 'share-shared'
      : result === 'copied'
        ? 'share-copied'
        : result === 'cancelled'
          ? 'share-cancelled'
          : 'share-unavailable',
  );
  if (result === 'cancelled') return;

  if (result === 'shared' || result === 'copied') {
    const verb = result === 'shared' ? 'shared' : 'copied';
    announce(
      carriesDraft
        ? `Link ${verb} — it carries your unsaved edits and opens in their editor.`
        : carriesCode
          ? `Link ${verb} — it carries this preset's code, since it exists only in your browser.`
          : `Link ${verb}.`,
    );
    onSuccess?.();
    return;
  }

  // URL synchronization can lag behind the latest keystroke; do not claim
  // the address bar already contains this draft.
  announce(
    carriesCode
      ? 'Could not share this link or reach the clipboard. Export the .milk file to share this preset.'
      : 'Could not reach the clipboard. Copy the link from the address bar.',
  );
}

/**
 * The code a link carries for a preset that exists only in this browser.
 * Without edits the buffer still holds the title it was made from — a
 * remix's buffer names its parent — so the preset's own title is written in
 * for the recipient's copy. With edits the buffer is shared as it stands.
 */
export function codeForLocalShare(
  source: string,
  { local, dirty, title }: { local: boolean; dirty: boolean; title?: string },
): string {
  return local && !dirty && title
    ? upsertMilkdropField(source, 'title', title)
    : source;
}

/** Flip Reduce flashing and say what it now does. */
export function toggleReduceFlashingAction(
  announce: (message: string) => void,
): void {
  const next = !getActiveAccessibilityPreference().reduceFlashing;
  setAccessibilityPreference({ reduceFlashing: next });
  announce(
    next
      ? 'Reduce flashing is on: flashing presets are skipped and strobes are dimmed.'
      : 'Reduce flashing is off.',
  );
}

/**
 * Queue a preset from Browse, or take it back out. The dock and palette can
 * only queue what is already on stage, which made the queue useless for its
 * one job: lining up presets you have *not* played yet.
 */
export function togglePresetQueuedAction({
  queue,
  entry,
  announce,
}: {
  queue: {
    presetIds: string[];
    add: (presetId: string) => void;
    remove: (presetId: string) => void;
  };
  entry: Pick<PresetCatalogEntry, 'id' | 'title' | 'author'>;
  announce: (message: string) => void;
}): boolean {
  // The name the card shows, not the raw "Author - Name" file title.
  const { title } = splitPresetDisplay(entry.title || entry.id, entry.author);
  if (queue.presetIds.includes(entry.id)) {
    queue.remove(entry.id);
    announce(`Removed “${title}” from the queue.`);
    return false;
  }
  queue.add(entry.id);
  announce(`Queued “${title}”. It shows in the cue monitor.`);
  return true;
}

/**
 * Take the next queued preset with a hand-driven crossfade: pop it, arm the
 * manual fade, then switch, in that order — arming has to land before the
 * switch, which is when the outgoing frame is captured. Shared by the cue
 * deck's "Fade by hand" and a hardware crossfader.
 */
export function startQueuedCrossfade({
  queue,
  startManualCrossfade,
  setRouteState,
  activePresetId,
}: {
  queue: { entries: ReadonlyArray<{ id: string }>; popNext: () => unknown };
  startManualCrossfade: () => void;
  setRouteState: (
    update: (current: SessionRouteState) => SessionRouteState,
  ) => void;
  activePresetId: string | null;
}): QueuedCrossfadeResult {
  const presetId = queue.entries[0]?.id;
  if (!presetId) return 'empty';
  // The route push is a no-op for the preset already on stage, so the armed
  // fade would never fire.
  if (presetId === activePresetId) return 'already-active';
  queue.popNext();
  startManualCrossfade();
  setRouteState((current) => ({ ...current, presetId }));
  return 'started';
}

export function endWatchParty(announce: (message: string) => void): void {
  leaveSyncSession();
  setSyncUrlParam(null);
  announce('Watch party ended — viewers keep local control.');
}

/**
 * Whether the camera feeds the preset, for labels that must say which way a
 * click goes. The camera module is code-split, so this mirrors its state
 * after each toggle and re-reads it on demand (`refreshCameraInput`) to
 * catch a camera that stopped on its own, such as an unplugged device.
 */
let cameraInputOn = false;
let cameraModuleLoaded = false;
const cameraListeners = new Set<() => void>();

function setCameraInputOn(on: boolean): void {
  if (cameraInputOn === on) return;
  cameraInputOn = on;
  for (const listener of cameraListeners) listener();
}

export function isCameraInputOn(): boolean {
  return cameraInputOn;
}

export function subscribeCameraInput(listener: () => void): () => void {
  cameraListeners.add(listener);
  return () => {
    cameraListeners.delete(listener);
  };
}

export function refreshCameraInput(): void {
  if (!cameraModuleLoaded) return;
  void import('../core/services/camera-video-source.ts').then(
    ({ isCameraVideoActive }) => setCameraInputOn(isCameraVideoActive()),
  );
}

export function cameraMenuLabel(on: boolean): string {
  return on
    ? 'Stop using the camera'
    : 'Use camera as video input (asks for camera access)';
}

/** Point a camera at the preset's video sampler, or turn it back off. */
export function toggleCameraAction(announce: (message: string) => void): void {
  void (async () => {
    const {
      toggleCameraVideoSource,
      isCameraVideoActive,
      isCameraVideoSupported,
      CameraVideoError,
    } = await import('../core/services/camera-video-source.ts');
    cameraModuleLoaded = true;
    if (!isCameraVideoSupported()) {
      announce('This browser cannot open a camera.');
      return;
    }
    try {
      const on = await toggleCameraVideoSource();
      setCameraInputOn(isCameraVideoActive());
      announce(
        on
          ? 'Camera on — presets that sample video now see it.'
          : 'Camera off.',
      );
    } catch (error) {
      setCameraInputOn(isCameraVideoActive());
      announce(
        error instanceof CameraVideoError
          ? error.message
          : 'Could not start the camera.',
      );
    }
  })();
}

/** Cast's two states. Casting runs through a watch party, and says so. */
export function castMenuLabel(casting: boolean): string {
  return casting
    ? 'Stop casting'
    : 'Cast to a TV or Chromecast (starts a watch party)';
}

/** The projector window may ask for screen access when a second screen is
 * attached, which is when it tries to move itself there. */
export function projectorMenuLabel(
  open: boolean,
  multipleScreens: boolean,
): string {
  if (open) return 'Close projector window';
  return multipleScreens
    ? 'Open projector window (asks to use your other screen)'
    : 'Open projector window';
}

/**
 * Cast the show to a TV or Chromecast. A cast device loads this tab's
 * watch-party link and renders its own copy: it follows every preset change
 * but hears no audio, so it is the fallback for a screen this machine cannot
 * drive. An attached projector gets the mirror instead (toggleProjectorAction).
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
      announce('Cast stopped.');
      return;
    }
    if (!display.isCastSupported()) {
      announce(
        'This browser cannot cast. For a screen plugged into this machine, open the projector window.',
      );
      return;
    }
    const hosted = await ensureHostRoom();
    if (!hosted) {
      announce('Could not prepare the link for the cast device.');
      return;
    }
    try {
      await display.startCast(hosted.url);
      if (display.getExternalDisplayState().mode === null) return; // Picker dismissed.
      announce(
        hosted.alreadyHosting
          ? 'Casting your watch party. The receiver follows every preset you play, but reacts to its own audio, not this machine’s input.'
          : 'Casting. This started a watch party, so anyone with its link can watch too. The receiver follows every preset you play, but reacts to its own audio, not this machine’s input.',
      );
    } catch {
      announce(
        display.getExternalDisplayState().error ?? 'Could not start casting.',
      );
    }
  })();
}

/**
 * Open or close the projector: a window with no chrome that mirrors the
 * stage (projector-window-service.ts). With a second screen attached it is
 * moved onto that screen once the browser grants screen access.
 *
 * Synchronous up to the window.open: the popup needs the click that ran
 * this, and an await before it could spend that gesture.
 */
export function toggleProjectorAction({
  stage,
  announce,
}: {
  stage: () => HTMLElement | null;
  announce: (message: string) => void;
}): void {
  if (getProjectorState().open) {
    closeProjectorWindow();
    announce('Projector closed.');
    return;
  }
  const result = openProjectorWindow({ getStage: stage });
  if (!result.ok) {
    announce(
      result.reason === 'no-canvas'
        ? 'Start the visuals first. The projector mirrors the stage.'
        : result.reason === 'popup-blocked'
          ? 'The projector window was blocked. Allow pop-ups for this site and try again.'
          : 'This browser cannot mirror the stage into another window.',
    );
    return;
  }
  const fullScreenHint = 'Double-click it or press F there for full screen.';
  if (result.adopted) {
    announce('Projector reconnected to the stage.');
    return;
  }
  void (async () => {
    const display = await import(
      '../core/services/external-display-service.ts'
    );
    if (!display.hasMultipleScreens()) {
      announce(
        `Projector window open. Drag it to the projector. ${fullScreenHint}`,
      );
      return;
    }
    const found = await display.findSecondScreen();
    if (found.ok && placeOnScreen(found.screen, found.screen.label)) {
      announce(`Projector open on ${found.screen.label}. ${fullScreenHint}`);
      return;
    }
    announce(
      `Projector window open. ${found.ok ? 'It could not be moved there.' : found.error} Drag it to the projector. ${fullScreenHint}`,
    );
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
  /**
   * Test seam for the on-device lookup: the current preset's neighbours from
   * the shipped preview vectors, or null when it has none.
   */
  searchByPresetLook?: (
    presetId: string,
    topK: number,
  ) => Promise<Array<{ presetId: string; score: number }> | null>;
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
 * the next preset is chosen for resemblance instead of at random. It shares
 * the finder's "By look" lookup, so there is one definition of "similar" in
 * the app rather than two.
 *
 * A catalog preset is answered on the device from its preview vector
 * (`preset-visual-vectors.ts`). Anything without one falls back to the frame
 * description behind `/api/visual-search`, which the Vite dev server does not
 * serve — `resolveOptionalApiUrl` returns null there and `searchByFrame`
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
  searchByPresetLook: injectedPresetLook,
}: NearbyPresetRequest): Promise<void> {
  if (!canvas && !currentPresetId) {
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
    const searchByPresetLook =
      injectedPresetLook ??
      (await import('../core/services/preset-visual-vectors.ts'))
        .searchByPresetLook;
    const minScore = injectedPresetLook
      ? 0
      : (await import('../core/services/preset-visual-vectors.ts'))
          .VISUAL_MATCH_MIN_SCORE;
    const byPreset = currentPresetId
      ? await searchByPresetLook(
          currentPresetId,
          NEARBY_SEARCH_RESULTS,
          minScore,
        )
      : null;
    if (byPreset) {
      matches = byPreset;
    } else if (canvas) {
      const searchByFrame =
        injectedSearch ??
        (await import('../core/services/visual-embedding.ts')).searchByFrame;
      matches = await searchByFrame(
        canvas,
        attempt.signal,
        NEARBY_SEARCH_RESULTS,
      );
    } else {
      announce('Nothing on the stage to match yet.');
      return;
    }
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
    announce('No new neighbors for this one. Try Surprise me.');
    return;
  }

  play(next.presetId);
}
