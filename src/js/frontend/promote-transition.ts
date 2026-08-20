// Tile → stage promote transition: when a preset is selected from a browse
// tile, an overlay carries the tile's visual (the live tile canvas when
// `?liveTiles` is on, else the preview image) from the tile rect onto the
// stage rect while the engine switches presets behind it. FLIP-style manual
// animation — the View Transitions API snapshots would freeze the canvas
// mid-morph, so the canvas keeps rendering while it travels.

const MOVE_MS = 340;
// Fallback hold if the readiness poll never confirms the swap (e.g. the load
// fails and the toast/error path takes over) — the overlay must not hang
// forever, but this is a ceiling, not the expected wait.
const MAX_HOLD_MS = 4000;
const READY_POLL_MS = 60;
const FADE_MS = 360;

let activeCleanup: (() => void) | null = null;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function findStageElement(): HTMLElement | null {
  return (
    document.getElementById('stims-visualizer') ??
    document.querySelector<HTMLElement>('.stims-shell__stage-root')
  );
}

function findStageFrame(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.stims-shell__stage-frame');
}

/**
 * True once the stage has actually switched to `presetId` — its frame's
 * `data-active-preset-id` (set from the live engine snapshot) matches, and a
 * canvas is present. Compile+load for a fresh preset can take anywhere from
 * tens of ms to multiple seconds (worker unavailable falls back to
 * main-thread compile), so this is polled rather than assumed from a fixed
 * timer — a guessed constant either reveals a stale frame too early or holds
 * the overlay open needlessly long after the real swap already happened.
 */
function stageShowsPreset(presetId: string): boolean {
  const frame = findStageFrame();
  if (!frame || frame.dataset.activePresetId !== presetId) {
    return false;
  }
  return !!frame.querySelector('canvas');
}

/**
 * Starts the promote animation for a preset selected from `sourceElement`
 * (any element containing the tile's `.stims-shell__preset-art`). Call it
 * BEFORE committing the route change: selection closes the browse panel, so
 * the source rect must be captured while the tile is still laid out.
 *
 * `presetId` is the preset being promoted — the overlay holds at the stage
 * rect until the real engine actually shows it (or a max wait elapses),
 * instead of guessing how long compile+load will take.
 *
 * Fire-and-forget; cleans itself up and never blocks selection.
 */
export function runPresetPromoteTransition({
  sourceElement,
  presetId,
}: {
  sourceElement: HTMLElement;
  presetId: string;
}) {
  if (typeof document === 'undefined' || prefersReducedMotion()) {
    return;
  }
  const stage = findStageElement();
  const art =
    sourceElement.querySelector<HTMLElement>('.stims-shell__preset-art') ??
    sourceElement;
  if (!stage || !art) {
    return;
  }
  const from = art.getBoundingClientRect();
  const to = stage.getBoundingClientRect();
  if (from.width < 1 || from.height < 1 || to.width < 1 || to.height < 1) {
    return;
  }

  // One promote at a time; a fast second selection supersedes the first.
  activeCleanup?.();

  const overlay = document.createElement('div');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = [
    'position:fixed',
    `left:${from.left}px`,
    `top:${from.top}px`,
    `width:${from.width}px`,
    `height:${from.height}px`,
    'z-index:80',
    'pointer-events:none',
    'overflow:hidden',
    'background:#000',
    `border-radius:${getComputedStyle(art).borderRadius}`,
    'will-change:opacity',
    // Rect properties animate instead of transform so the inner canvas keeps
    // object-fit:cover (a square tile scaling onto a wide stage must crop,
    // not stretch). Single fixed element; layout cost is negligible.
    `transition:left ${MOVE_MS}ms cubic-bezier(0.32,0.72,0.28,1),top ${MOVE_MS}ms cubic-bezier(0.32,0.72,0.28,1),width ${MOVE_MS}ms cubic-bezier(0.32,0.72,0.28,1),height ${MOVE_MS}ms cubic-bezier(0.32,0.72,0.28,1),border-radius ${MOVE_MS}ms ease,opacity ${FADE_MS}ms ease`,
  ].join(';');

  // Snapshot the live tile canvas onto a 2D canvas clone for the transition.
  // Reparenting WebGL canvas DOM nodes directly across containers can trigger
  // WebGL context loss in Chromium/WebKit browsers and leaks the element when
  // overlay.remove() runs.
  //
  // data-live-tile-ready gates this on the pool's real engine status, not
  // just canvas presence: the canvas element exists (with its full tile
  // size already set) the instant it's acquired, well before the engine has
  // compiled or painted a first frame — clicking a tile that just scrolled
  // into view would otherwise snapshot a blank/black frame into the overlay.
  const liveCanvas = art.querySelector<HTMLCanvasElement>(
    '[data-live-tile][data-live-tile-ready="true"] canvas',
  );
  if (liveCanvas && liveCanvas.width > 0 && liveCanvas.height > 0) {
    const clone = document.createElement('canvas');
    clone.width = liveCanvas.width;
    clone.height = liveCanvas.height;
    clone.style.cssText = 'width:100%;height:100%;object-fit:cover';
    const ctx = clone.getContext('2d');
    if (ctx) {
      try {
        ctx.drawImage(liveCanvas, 0, 0);
      } catch {
        // Fall back to image clone if readback is blocked
      }
    }
    overlay.append(clone);
  } else {
    const image = art.querySelector<HTMLImageElement>('img');
    if (!image?.src) {
      return;
    }
    const clone = image.cloneNode() as HTMLImageElement;
    clone.style.cssText = 'width:100%;height:100%;object-fit:cover';
    overlay.append(clone);
  }

  document.body.append(overlay);

  let done = false;
  let pollHandle: number | null = null;
  let maxWaitHandle: number | null = null;
  const cleanup = () => {
    if (done) {
      return;
    }
    done = true;
    if (pollHandle !== null) {
      window.clearInterval(pollHandle);
    }
    if (maxWaitHandle !== null) {
      window.clearTimeout(maxWaitHandle);
    }
    overlay.remove();
    if (activeCleanup === cleanup) {
      activeCleanup = null;
    }
  };
  activeCleanup = cleanup;

  // FLIP: force layout at the source rect, then ease to the stage rect.
  overlay.getBoundingClientRect();
  overlay.style.left = `${to.left}px`;
  overlay.style.top = `${to.top}px`;
  overlay.style.width = `${to.width}px`;
  overlay.style.height = `${to.height}px`;
  overlay.style.borderRadius = '0px';

  const beginFade = () => {
    if (pollHandle !== null) {
      window.clearInterval(pollHandle);
      pollHandle = null;
    }
    if (maxWaitHandle !== null) {
      window.clearTimeout(maxWaitHandle);
      maxWaitHandle = null;
    }
    overlay.style.opacity = '0';
    window.setTimeout(cleanup, FADE_MS + 60);
  };

  window.setTimeout(() => {
    if (done) {
      return;
    }
    if (stageShowsPreset(presetId)) {
      beginFade();
      return;
    }
    pollHandle = window.setInterval(() => {
      if (stageShowsPreset(presetId)) {
        beginFade();
      }
    }, READY_POLL_MS);
    maxWaitHandle = window.setTimeout(beginFade, MAX_HOLD_MS);
  }, MOVE_MS);
}
