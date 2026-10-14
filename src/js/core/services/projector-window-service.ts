/**
 * The projector: a window with no chrome that mirrors the stage, for the
 * screen the audience sees while the controls stay on the operator's.
 *
 * ## A mirror, not a second session
 *
 * The second-screen path used to open the watch-party link: a full second
 * session with its own audio, following only the preset id. MIDI moves,
 * edits, crossfades, a held frame and anything the operator tuned by hand
 * never reached the room. This window shows the stage's own pixels instead,
 * through `canvas.captureStream()` into a `<video>`, the same trick both
 * picture-in-picture paths use: the canvas never moves, so its WebGL or
 * WebGPU context is never lost, and the projector cannot disagree with what
 * the operator sees.
 *
 * ## Same-origin and re-adoptable
 *
 * `window.open('', name)` gives an about:blank window this page can write
 * into, and a second call with the same name returns that window instead of
 * opening another. So after the operator reloads, opening the projector again
 * takes over the window already on the projector, still full screen, rather
 * than leaving a dead one behind. When this page goes away the picture goes
 * black instead of freezing, and the window stays where it is.
 *
 * ## Placement
 *
 * The window is opened inside the click, because a popup needs that gesture
 * and awaiting a screen-access prompt first can spend it. Moving it onto the
 * second screen happens afterwards (see `placeOnScreen`). Going full screen
 * needs a gesture in the projector window itself, which is why its own hint
 * says double-click or press F.
 *
 * ## What is not in the canvas
 *
 * Three things the room must see are not canvas pixels: the flash
 * governor's dimming, the brightness ceiling and the D blackout, and the Y
 * white flash. A capture carries none of them, so the projector mirrors them
 * onto its video the way stage-presentation.ts does for every same-origin
 * copy. Without that, Reduce flashing would protect the operator's laptop
 * and not the audience.
 *
 * Limits a performer should know: the mirror has the stage's shape and size,
 * so a 16:9 projector letterboxes a portrait stage; and a hidden or minimised
 * operator window gets no frames from the browser, so the projector holds
 * its last one.
 */

import { mirrorStagePresentation } from './stage-presentation.ts';

export const PROJECTOR_WINDOW_NAME = 'stims-projector';

/** Marks a window this module has written, so a re-adopt knows it. */
const STAGE_ID = 'stims-projector-stage';

/** Pointer stillness after which the cursor and the hint leave the screen. */
const IDLE_HIDE_MS = 2000;

export type ProjectorPlacement = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ProjectorState = {
  open: boolean;
  /** The screen it was placed on, when one was. */
  screenLabel: string | null;
};

export type ProjectorOpenResult =
  | { ok: true; adopted: boolean }
  | { ok: false; reason: 'unsupported' | 'no-canvas' | 'popup-blocked' };

type OpenWindow = (features: string) => Window | null;

type Projector = {
  win: Window;
  video: HTMLVideoElement;
  stage: HTMLElement;
  canvas: HTMLCanvasElement | null;
  stream: MediaStream | null;
  observer: MutationObserver | null;
  stopPresentation: () => void;
  listeners: AbortController;
  closedPoll: ReturnType<typeof setInterval> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

type Listener = (state: ProjectorState) => void;

let projector: Projector | null = null;
let state: ProjectorState = { open: false, screenLabel: null };
const listeners = new Set<Listener>();
let openerPagehideBound = false;

function setState(next: Partial<ProjectorState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function getProjectorState(): ProjectorState {
  return state;
}

export function subscribeProjector(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For per-frame readers (the hidden-tab policy): no allocation. */
export function isProjectorWindowOpen(): boolean {
  return projector !== null;
}

export function isProjectorSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.open === 'function' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

const MARKUP = `
<head>
  <meta charset="utf-8">
  <title>Stims projector</title>
  <style>
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
    body.idle, html:fullscreen, html:fullscreen body { cursor: none; }
    #${STAGE_ID} {
      display: block; width: 100vw; height: 100vh;
      object-fit: contain; background: #000;
    }
    #flash { position: fixed; inset: 0; background: #fff; pointer-events: none; }
    #hint {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      margin: 0; padding: 8px 14px; border-radius: 6px;
      background: #111; color: #eee;
      font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      transition: opacity 300ms linear;
    }
    body.idle #hint { opacity: 0; }
    html:fullscreen #hint { display: none; }
  </style>
</head>
<body>
  <video id="${STAGE_ID}" autoplay muted playsinline aria-label="Visualizer stage"></video>
  <div id="flash" hidden></div>
  <p id="hint">Double-click or press F for full screen. Esc leaves it.</p>
</body>`;

function stopStream(target: Projector): void {
  for (const track of target.stream?.getTracks() ?? []) track.stop();
  target.stream = null;
}

/**
 * Points the projector's video at the stage's current canvas. Never throws:
 * the window is already up, and a failed capture leaves it black until the
 * next canvas swap retries.
 */
function attachCanvas(target: Projector): void {
  const canvas = target.stage.querySelector('canvas');
  if (!canvas || canvas === target.canvas) return;
  try {
    stopStream(target);
    target.stream = canvas.captureStream();
    target.canvas = canvas;
    target.video.srcObject = target.stream;
    void target.video.play().catch(() => {
      // A muted video in a window the user just opened is not normally
      // refused; the next swap retries if it is.
    });
  } catch {
    stopStream(target);
    target.canvas = null;
  }
}

function toggleFullscreen(doc: Document): void {
  if (doc.fullscreenElement) {
    void doc.exitFullscreen().catch(() => {});
    return;
  }
  void doc.documentElement.requestFullscreen?.().catch(() => {
    // Refused without a gesture in this window; the hint still says how.
  });
}

/** Writes the projector's document and wires its own controls. */
function build(win: Window, stage: HTMLElement, adopted: boolean): Projector {
  const doc = win.document;
  doc.documentElement.innerHTML = MARKUP;
  // Not every engine takes a <title> from innerHTML; the window's title bar
  // and the OS window switcher are where the operator finds it.
  doc.title = 'Stims projector';
  const video = doc.getElementById(STAGE_ID) as HTMLVideoElement;
  const body = doc.body;
  const controls = new AbortController();
  const { signal } = controls;

  const target: Projector = {
    win,
    video,
    stage,
    canvas: null,
    stream: null,
    observer: null,
    stopPresentation: () => {},
    listeners: controls,
    closedPoll: null,
    idleTimer: null,
  };

  const scheduleIdle = () => {
    body.classList.remove('idle');
    if (target.idleTimer !== null) clearTimeout(target.idleTimer);
    target.idleTimer = setTimeout(() => {
      body.classList.add('idle');
    }, IDLE_HIDE_MS);
  };
  video.addEventListener('dblclick', () => toggleFullscreen(doc), { signal });
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFullscreen(doc);
      }
    },
    { signal },
  );
  doc.addEventListener('pointermove', scheduleIdle, { signal });
  // A re-adopted window is usually already on the projector, and the hint
  // was for whoever set it up: do not put it back in front of the room.
  if (adopted) body.classList.add('idle');
  else scheduleIdle();

  // The user closing the projector leaves no event on this page, and
  // `pagehide` on the popup does not fire for every way it can close.
  win.addEventListener('pagehide', () => teardown(target), {
    signal,
    once: true,
  });
  target.closedPoll = setInterval(() => {
    if (win.closed) teardown(target);
  }, 1000);

  if (typeof MutationObserver === 'function') {
    // The renderer replaces the canvas on a backend switch or a renderer
    // rebuild; without this the projector froze on the detached one.
    target.observer = new MutationObserver(() => attachCanvas(target));
    target.observer.observe(stage, { childList: true, subtree: true });
  }
  attachCanvas(target);
  target.stopPresentation = mirrorStagePresentation(stage, {
    filtered: video,
    flash: doc.getElementById('flash') as HTMLElement,
  });
  return target;
}

function teardown(target: Projector, { close = false } = {}): void {
  if (projector !== target) return;
  projector = null;
  target.listeners.abort();
  target.observer?.disconnect();
  target.stopPresentation();
  if (target.closedPoll !== null) clearInterval(target.closedPoll);
  if (target.idleTimer !== null) clearTimeout(target.idleTimer);
  stopStream(target);
  if (!target.win.closed) {
    target.video.srcObject = null;
    if (close) target.win.close();
  }
  setState({ open: false, screenLabel: null });
}

/**
 * When this page unloads, its stream dies with it. Clearing the video shows
 * black rather than the last frame, and the window stays put so the next
 * open can take it back.
 */
function bindOpenerPagehide(): void {
  if (openerPagehideBound || typeof window === 'undefined') return;
  openerPagehideBound = true;
  window.addEventListener('pagehide', () => {
    if (projector) teardown(projector);
  });
}

/** A window the stage's shape, so the mirror opens without letterboxing. */
function windowFeatures(stage: HTMLElement): string {
  const canvas = stage.querySelector('canvas');
  const ratio =
    canvas && canvas.height > 0 ? canvas.width / canvas.height : 16 / 9;
  const width = 960;
  return `popup,width=${width},height=${Math.round(width / ratio)}`;
}

/**
 * Opens the projector, or brings an open one forward. Must run inside the
 * user's click: the popup needs that gesture.
 */
export function openProjectorWindow({
  getStage,
  openWindow = (spec) => window.open('', PROJECTOR_WINDOW_NAME, spec),
}: {
  getStage: () => HTMLElement | null;
  openWindow?: OpenWindow;
}): ProjectorOpenResult {
  if (!isProjectorSupported()) return { ok: false, reason: 'unsupported' };
  if (projector && !projector.win.closed) {
    projector.win.focus();
    return { ok: true, adopted: true };
  }
  const stage = getStage();
  if (!stage?.querySelector('canvas'))
    return { ok: false, reason: 'no-canvas' };

  const win = openWindow(windowFeatures(stage));
  if (!win) return { ok: false, reason: 'popup-blocked' };
  let adopted = false;
  try {
    adopted = win.document.getElementById(STAGE_ID) !== null;
  } catch {
    // Not ours to read: something else holds the name. Opening fresh under
    // it would navigate that window, so give up the way a block does.
    return { ok: false, reason: 'popup-blocked' };
  }
  projector = build(win, stage, adopted);
  bindOpenerPagehide();
  setState({ open: true, screenLabel: null });
  return { ok: true, adopted };
}

export function closeProjectorWindow(): void {
  if (projector) teardown(projector, { close: true });
}

/**
 * Moves the open projector onto `placement` (another screen's work area).
 * Returns false when there is no projector or the browser refused the move.
 */
export function placeOnScreen(
  placement: ProjectorPlacement,
  screenLabel: string | null,
): boolean {
  const target = projector;
  if (!target || target.win.closed) return false;
  try {
    target.win.moveTo(placement.left, placement.top);
    target.win.resizeTo(placement.width, placement.height);
  } catch {
    return false;
  }
  setState({ screenLabel });
  return true;
}

export const __projectorTestUtils = {
  reset(): void {
    if (projector) teardown(projector);
    projector = null;
    state = { open: false, screenLabel: null };
    listeners.clear();
  },
};
