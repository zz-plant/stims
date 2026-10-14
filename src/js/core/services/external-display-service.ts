/**
 * Putting the visuals on a screen that isn't this one.
 *
 * Two browser capabilities, one per physical situation:
 *
 *  - **Presentation API** (`PresentationRequest`) is Chrome's cast path. The
 *    receiver is a separate device that loads a URL over the network, so the
 *    URL has to render the show on its own: a sync-session ("watch party")
 *    link, which follows this tab's preset changes. It is a second copy with
 *    no audio input of its own, which a cast cannot avoid.
 *  - **Window Management API** (`getScreenDetails`) covers a monitor or
 *    projector attached to this machine. It reports where each screen sits in
 *    the virtual desktop, which is the only way to put a window on one. The
 *    window placed there is the projector mirror
 *    (projector-window-service.ts), not a second session, because an
 *    attached screen can show this tab's own pixels.
 */

export type ExternalDisplayMode = 'cast';

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

export type SecondScreen = {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
};

/**
 * The work area of a screen other than the one holding the controls, for
 * placing the projector. Asks for the window-management permission on first
 * use. Never throws: each refusal comes back as a sentence to show.
 */
export async function findSecondScreen(): Promise<
  { ok: true; screen: SecondScreen } | { ok: false; error: string }
> {
  if (!isSecondScreenSupported()) {
    return {
      ok: false,
      error: 'This browser cannot place a window on another screen.',
    };
  }
  const getScreenDetails = (
    window as unknown as { getScreenDetails: () => Promise<ScreenDetails> }
  ).getScreenDetails;

  let details: ScreenDetails;
  try {
    details = await getScreenDetails.call(window);
  } catch {
    return {
      ok: false,
      error:
        'Screen access was blocked. Allow it in the browser’s site settings.',
    };
  }

  const target =
    details.screens.find((screen) => screen !== details.currentScreen) ?? null;
  if (!target) return { ok: false, error: 'No second screen was found.' };
  return {
    ok: true,
    screen: {
      left: target.availLeft,
      top: target.availTop,
      width: target.availWidth,
      height: target.availHeight,
      label: target.label || 'the second screen',
    },
  };
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
  setState({ mode: null, target: null, error: null });
}

export const __externalDisplayTestUtils = {
  reset(): void {
    connection = null;
    state = { mode: null, target: null, error: null };
    listeners.clear();
  },
};
