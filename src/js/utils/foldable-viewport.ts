/** Read-only, progressive foldable viewport information.
 * Not a hardware emulator: absent APIs produce an unknown posture and one
 * rectangular segment. No device-name or width-based fold detection.
 */
export type Posture = 'folded' | 'continuous' | 'unknown';
export type Segment = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
export type FoldableViewport = Readonly<{
  posture: Posture;
  segments: readonly Segment[];
  width: number;
  height: number;
}>;
/**
 * How a hinge divides this window: `book` puts the two halves side by side,
 * `laptop` stacks them. `flat` is everything else, including every browser
 * without the API and a window that sits wholly on one side of the hinge.
 */
export type FoldLayout = 'flat' | 'book' | 'laptop';

type WindowLike = {
  innerWidth: number;
  innerHeight: number;
  viewport?: { segments?: ArrayLike<Segment> | null };
  /* Partial<Navigator> keeps the real `window` assignable — a bare
     `{ devicePosture? }` shares no property with `Navigator`, so the
     weak-type check rejects it — while fakes with only devicePosture
     still satisfy the missing optionals. */
  navigator?: Partial<Navigator> & { devicePosture?: { type?: string } };
};

function validSegment(value: Segment): boolean {
  return (
    [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
    value.width > 0 &&
    value.height > 0
  );
}

/** Snapshot with a conservative fallback for unsupported or malformed APIs. */
export function readFoldableViewport(source: WindowLike): FoldableViewport {
  const width = Math.max(0, source.innerWidth);
  const height = Math.max(0, source.innerHeight);
  const type = source.navigator?.devicePosture?.type;
  const posture: Posture =
    type === 'folded' || type === 'continuous' ? type : 'unknown';
  const raw = source.viewport?.segments;
  const segments = raw
    ? Array.from(raw)
        .filter(validSegment)
        .map(({ x, y, width, height }) => ({ x, y, width, height }))
    : [];
  return {
    posture,
    segments: segments.length ? segments : [{ x: 0, y: 0, width, height }],
    width,
    height,
  };
}

/**
 * Keyed on segments rather than posture, matching the `*-viewport-segments`
 * media queries the stylesheets use: only two segments give a layout two
 * places to put things.
 */
export function foldLayoutOf(segments: readonly Segment[]): FoldLayout {
  if (segments.length !== 2) return 'flat';
  const [first, second] = segments as readonly [Segment, Segment];
  if (first.y === second.y) return 'book';
  if (first.x === second.x) return 'laptop';
  return 'flat';
}

/** This window's fold layout right now; `flat` wherever there is no window. */
export function currentFoldLayout(): FoldLayout {
  if (typeof window === 'undefined') return 'flat';
  return foldLayoutOf(readFoldableViewport(window).segments);
}

type ScreenWindowLike = WindowLike & {
  screen?: { width: number; height: number };
};

/** Below this share of the screen's short side, the window is one of several. */
const SHARED_WINDOW_SHORT_SIDE = 0.85;

/**
 * Whether turning the device would give this window a wider stage. A window
 * sharing the screen stays narrow however the device is held, and a half-folded
 * device is posed on purpose, so neither should be told to rotate.
 */
export function rotatingWidensWindow(source: ScreenWindowLike): boolean {
  if (foldLayoutOf(readFoldableViewport(source).segments) !== 'flat') {
    return false;
  }
  const screen = source.screen;
  if (!screen) return true;
  const windowShortSide = Math.min(source.innerWidth, source.innerHeight);
  const screenShortSide = Math.min(screen.width, screen.height);
  return windowShortSide >= screenShortSide * SHARED_WINDOW_SHORT_SIDE;
}
