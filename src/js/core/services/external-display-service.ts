/**
 * Putting the visuals on a screen that isn't this one — a projector, a second
 * monitor, or a Chromecast — while the controls stay on the operator's laptop.
 *
 * Two different browser capabilities cover the two physical situations, and
 * neither is a superset of the other:
 *
 *  - **Presentation API** (`PresentationRequest`) is Chrome's cast path. The
 *    receiver is a separate device that loads a URL over the network, so the
 *    URL has to be one that can render the show on its own.
 *  - **Window Management API** (`getScreenDetails`) covers a monitor physically
 *    attached to this machine: it reports where each screen is in the virtual
 *    desktop, which is the only way to open a window ON a specific one.
 *
 * Both are handed the same receiver URL. That URL is a sync-session ("watch
 * party") link, which already exists and already makes a second browser follow
 * this one's preset changes live — so the external display is just another
 * viewer, and no new sync transport had to be invented for it.
 *
 * Picture-in-picture is deliberately NOT part of this. PiP mirrors the canvas
 * as a video stream into a floating window on the SAME screen; these put an
 * independently-rendering copy on a DIFFERENT one.
 */

export type ExternalDisplayMode = 'cast' | 'window';

export type ExternalDisplayState = {
  mode: ExternalDisplayMode | null;
  /** Human-readable target, when the platform names one. */
  target: string | null;
  error: string | null;
};

type Listener = (state: ExternalDisplayState) => void;

/** The slice of the Presentation API this uses. Declared locally because it
 * is absent from the DOM lib in this TypeScript version. */
type PresentationConnectionLike = {
  close: () => void;
  terminate: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  id?: string;
};
type PresentationRequestLike = {
  start: () => Promise<PresentationConnectionLike>;
  getAvailability?: () => Promise<{ value: boolean }>;
};
type PresentationRequestConstructor = new (
  urls: string[],
) => PresentationRequestLike;

type ScreenDetailed = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
  label?: string;
};
type ScreenDetails = {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
};

let state: ExternalDisplayState = { mode: null, target: null, error: null };
const listeners = new Set<Listener>();
let connection: PresentationConnectionLike | null = null;
let externalWindow: Window | null = null;

function setState(next: Partial<ExternalDisplayState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function getExternalDisplayState(): ExternalDisplayState {
  return state;
}

export function subscribeExternalDisplay(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPresentationRequestCtor(): PresentationRequestConstructor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as { PresentationRequest?: unknown })
    .PresentationRequest;
  return typeof ctor === 'function'
    ? (ctor as PresentationRequestConstructor)
    : null;
}

/** Chrome with a cast-capable device reachable. Presence of the API does not
 * promise a receiver exists — `getAvailability` answers that, asynchronously
 * and only on some platforms, so the picker is still the real test. */
export function isCastSupported(): boolean {
  return getPresentationRequestCtor() !== null;
}

export function isSecondScreenSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as { getScreenDetails?: unknown }).getScreenDetails ===
      'function'
  );
}

/** True when the OS reports more than one screen, so offering "second screen"
 * is meaningful. `screen.isExtended` needs no permission, unlike
 * getScreenDetails, which makes it the right thing to gate the UI on. */
export function hasMultipleScreens(): boolean {
  if (typeof window === 'undefined') return false;
  return (window.screen as { isExtended?: boolean }).isExtended === true;
}

/**
 * Casts the receiver URL to a device the user picks. Must be called from a
 * user gesture — Chrome requires one to open the cast picker.
 */
export async function startCast(receiverUrl: string): Promise<void> {
  const Ctor = getPresentationRequestCtor();
  if (!Ctor) {
    setState({ error: 'Casting is not supported in this browser.' });
    throw new Error('Presentation API unavailable');
  }
  try {
    const request = new Ctor([receiverUrl]);
    const established = await request.start();
    connection = established;
    // The user can stop the cast from the device or the browser's own cast
    // menu; without this the app would keep claiming it is casting.
    established.addEventListener('close', handleCastEnded);
    established.addEventListener('terminate', handleCastEnded);
    setState({ mode: 'cast', target: 'Cast device', error: null });
  } catch (error) {
    // A dismissed picker rejects exactly like a failure does; treat it as a
    // cancel rather than surfacing an error the user did not cause.
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      setState({ mode: null, target: null, error: null });
      return;
    }
    setState({ error: 'Could not start casting.' });
    throw error;
  }
}

function handleCastEnded(): void {
  connection = null;
  if (state.mode === 'cast') {
    setState({ mode: null, target: null });
  }
}

/**
 * Opens the receiver fullscreen on a screen that isn't the one holding the
 * controls. Requires the window-management permission, which Chrome prompts
 * for on the first getScreenDetails call.
 */
export async function openOnSecondScreen(receiverUrl: string): Promise<void> {
  if (!isSecondScreenSupported()) {
    setState({
      error: 'This browser cannot place a window on a second screen.',
    });
    throw new Error('Window Management API unavailable');
  }
  const getScreenDetails = (
    window as unknown as { getScreenDetails: () => Promise<ScreenDetails> }
  ).getScreenDetails;

  let details: ScreenDetails;
  try {
    details = await getScreenDetails.call(window);
  } catch {
    setState({
      error:
        'Screen access was blocked. Allow it in the browser’s site settings.',
    });
    throw new Error('window-management permission denied');
  }

  const target =
    details.screens.find((screen) => screen !== details.currentScreen) ?? null;
  if (!target) {
    setState({ error: 'No second screen was found.' });
    throw new Error('no external screen');
  }

  // Position by the target screen's own coordinates in the virtual desktop —
  // that placement is the entire reason this API is needed over window.open.
  const features = [
    `left=${target.availLeft}`,
    `top=${target.availTop}`,
    `width=${target.availWidth}`,
    `height=${target.availHeight}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
  ].join(',');

  const opened = window.open(receiverUrl, 'stims-external-display', features);
  if (!opened) {
    setState({ error: 'The popup was blocked. Allow popups for this site.' });
    throw new Error('popup blocked');
  }
  externalWindow = opened;
  // A closed window leaves no event on the opener, so poll — cheaply, and
  // only while one is open.
  const poll = window.setInterval(() => {
    if (externalWindow?.closed) {
      window.clearInterval(poll);
      externalWindow = null;
      if (state.mode === 'window') setState({ mode: null, target: null });
    }
  }, 1000);

  setState({
    mode: 'window',
    target: target.label || 'Second screen',
    error: null,
  });
}

/**
 * Prefers a physically attached second screen and falls back to casting,
 * because a wired projector is both lower latency and higher fidelity than a
 * Chromecast re-rendering the show over the network.
 */
export async function presentToExternalDisplay(
  receiverUrl: string,
): Promise<void> {
  if (isSecondScreenSupported() && hasMultipleScreens()) {
    await openOnSecondScreen(receiverUrl);
    return;
  }
  await startCast(receiverUrl);
}

export function stopExternalDisplay(): void {
  if (connection) {
    try {
      connection.terminate();
    } catch {
      // Already gone — the state reset below is what matters.
    }
    connection = null;
  }
  if (externalWindow && !externalWindow.closed) {
    externalWindow.close();
  }
  externalWindow = null;
  setState({ mode: null, target: null, error: null });
}

export const __externalDisplayTestUtils = {
  reset(): void {
    connection = null;
    externalWindow = null;
    state = { mode: null, target: null, error: null };
    listeners.clear();
  },
};
