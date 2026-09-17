/**
 * The stage in a real always-on-top window, with controls.
 *
 * Video picture-in-picture (see picture-in-picture-service.ts) floats the
 * pixels and nothing else: the browser's own transport is meaningless over a
 * canvas stream, so once the window is up there is no way to change preset
 * without going back to the tab — which is the whole thing the floating
 * window was for. Document PiP gives a real document to put controls in.
 *
 * ## The canvas is mirrored, never moved
 *
 * Same trick the video path uses, for the same reason: reparenting a WebGL
 * canvas across documents loses its context, and here it would also take the
 * stage away from the tab it came from. `captureStream()` leaves the canvas
 * exactly where it is and feeds a `<video>` in the other window.
 *
 * ## Styling
 *
 * A PiP document inherits no stylesheets from its opener. Rather than a
 * second hardcoded palette to drift against `tokens.css`, the handful of
 * values needed are read off the opener's computed root and written into the
 * new document — so the popout follows the app's theme, including a change
 * made while it is open.
 */

export type DocumentPictureInPictureState = {
  active: boolean;
};

export type DocumentPictureInPictureActions = {
  previousPreset: () => void;
  nextPreset: () => void;
  togglePlayback: () => void;
  /** Drives the play/pause button's label and icon. */
  isPaused: () => boolean;
};

export type DocumentPictureInPictureEnterResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'unsupported' | 'no-canvas' | 'request-failed';
      error?: unknown;
    };

type DocumentPipApi = {
  requestWindow: (options?: {
    width?: number;
    height?: number;
  }) => Promise<Window>;
  window: Window | null;
};

function getApi(): DocumentPipApi | null {
  if (typeof window === 'undefined') return null;
  const api = (
    window as unknown as { documentPictureInPicture?: DocumentPipApi }
  ).documentPictureInPicture;
  return api?.requestWindow ? api : null;
}

export function isDocumentPictureInPictureSupported(): boolean {
  return (
    getApi() !== null &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

/** Tokens the popout needs, read from the opener so the theme follows. */
const THEME_TOKENS = [
  '--card-bg',
  '--text-color',
  '--accent-color',
  '--surface-border',
] as const;

function readTheme(doc: Document): string {
  const computed = doc.defaultView?.getComputedStyle(doc.documentElement);
  if (!computed) return '';
  return THEME_TOKENS.map(
    (token) => `${token}: ${computed.getPropertyValue(token).trim()};`,
  ).join('\n    ');
}

const CONTROL_BUTTONS: ReadonlyArray<{
  id: 'previous' | 'playback' | 'next';
  label: string;
  glyph: string;
}> = [
  { id: 'previous', label: 'Previous preset', glyph: '⏮' },
  { id: 'playback', label: 'Pause', glyph: '⏸' },
  { id: 'next', label: 'Next preset', glyph: '⏭' },
];

function buildMarkup(theme: string): string {
  return `
  <style>
    :root {
      ${theme}
      color-scheme: dark light;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: #000;
      color: var(--text-color, #f7f4eb);
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    #stage { flex: 1; min-height: 0; display: block; width: 100%; object-fit: contain; background: #000; }
    #controls {
      display: flex;
      gap: 8px;
      justify-content: center;
      align-items: center;
      padding: 8px;
      background: var(--card-bg, #151e24);
      border-top: 1px solid var(--surface-border, rgba(255,255,255,0.14));
    }
    button {
      min-width: 44px;
      min-height: 36px;
      border-radius: 999px;
      border: 1px solid var(--surface-border, rgba(255,255,255,0.14));
      background: transparent;
      color: inherit;
      font-size: 15px;
      cursor: pointer;
    }
    button:hover { border-color: var(--accent-color, #77c9ff); }
    button:focus-visible {
      outline: 2px solid var(--accent-color, #77c9ff);
      outline-offset: 2px;
    }
  </style>
  <video id="stage" autoplay muted playsinline aria-label="Visualizer stage"></video>
  <div id="controls">
    ${CONTROL_BUTTONS.map(
      (button) =>
        `<button type="button" data-action="${button.id}" aria-label="${button.label}" title="${button.label}">${button.glyph}</button>`,
    ).join('\n    ')}
  </div>`;
}

export type DocumentPictureInPictureController = {
  isActive: () => boolean;
  enter: () => Promise<DocumentPictureInPictureEnterResult>;
  exit: () => Promise<void>;
  /** Re-point the popout at the current canvas after the stage swaps it. */
  resync: () => void;
  /** Refresh the play/pause button after a change made in the main window. */
  syncPlaybackState: () => void;
  subscribe: (
    listener: (state: DocumentPictureInPictureState) => void,
  ) => () => void;
  dispose: () => void;
};

export function createDocumentPictureInPictureController({
  getCanvas,
  actions,
  doc = document,
}: {
  getCanvas: () => HTMLCanvasElement | null;
  actions: DocumentPictureInPictureActions;
  doc?: Document;
}): DocumentPictureInPictureController {
  let pipWindow: Window | null = null;
  let stream: MediaStream | null = null;
  const listeners = new Set<(state: DocumentPictureInPictureState) => void>();

  const emit = () => {
    const state = { active: pipWindow !== null };
    for (const listener of listeners) listener(state);
  };

  const stopStream = () => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  };

  const videoIn = (win: Window) =>
    win.document.getElementById('stage') as HTMLVideoElement | null;

  /**
   * Points the popout's video at the current canvas.
   *
   * Never throws. The window is already open by the time this runs, so a
   * failed capture must not unwind `enter()` and strand it: the control row
   * still works without a picture, and `resync()` — which the stage calls
   * whenever it swaps the canvas — is the retry.
   */
  const attachCanvas = (win: Window) => {
    const canvas = getCanvas();
    const video = videoIn(win);
    if (!canvas || !video) return false;
    try {
      stopStream();
      stream = canvas.captureStream();
      video.srcObject = stream;
    } catch {
      stopStream();
      return false;
    }
    void video.play().catch(() => {
      // A muted autoplaying video in a window the user just opened is not
      // usually refused; if it is, the next resync retries.
    });
    return true;
  };

  const syncPlaybackState = () => {
    if (!pipWindow) return;
    const button = pipWindow.document.querySelector<HTMLButtonElement>(
      '[data-action="playback"]',
    );
    if (!button) return;
    const paused = actions.isPaused();
    button.textContent = paused ? '▶' : '⏸';
    const label = paused ? 'Resume' : 'Pause';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  };

  const teardown = () => {
    stopStream();
    pipWindow = null;
    emit();
  };

  const enter = async (): Promise<DocumentPictureInPictureEnterResult> => {
    const api = getApi();
    if (!api || !isDocumentPictureInPictureSupported()) {
      return { ok: false, reason: 'unsupported' };
    }
    if (pipWindow) return { ok: true };

    const canvas = getCanvas();
    if (!canvas) return { ok: false, reason: 'no-canvas' };

    try {
      // Proportioned from the stage so the popout does not letterbox it, and
      // with room under it for the control row.
      const ratio = canvas.height > 0 ? canvas.width / canvas.height : 16 / 9;
      const width = 420;
      const win = await api.requestWindow({
        width,
        height: Math.round(width / ratio) + 52,
      });
      pipWindow = win;
      win.document.body.innerHTML = buildMarkup(readTheme(doc));

      for (const { id } of CONTROL_BUTTONS) {
        win.document
          .querySelector<HTMLButtonElement>(`[data-action="${id}"]`)
          ?.addEventListener('click', () => {
            if (id === 'previous') actions.previousPreset();
            else if (id === 'next') actions.nextPreset();
            else {
              actions.togglePlayback();
              // The button is in another document, so nothing re-renders it.
              syncPlaybackState();
            }
          });
      }

      attachCanvas(win);
      syncPlaybackState();
      // `pagehide` rather than `unload`: closing a PiP window does not always
      // fire `unload`, and a missed teardown leaves the capture running.
      win.addEventListener('pagehide', teardown, { once: true });
      emit();
      return { ok: true };
    } catch (error) {
      pipWindow = null;
      return { ok: false, reason: 'request-failed', error };
    }
  };

  return {
    isActive: () => pipWindow !== null,
    enter,
    exit: async () => {
      pipWindow?.close();
      teardown();
    },
    resync: () => {
      if (pipWindow) attachCanvas(pipWindow);
    },
    syncPlaybackState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      pipWindow?.close();
      stopStream();
      pipWindow = null;
      listeners.clear();
    },
  };
}
