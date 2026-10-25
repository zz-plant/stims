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

type WindowLike = {
  innerWidth: number;
  innerHeight: number;
  viewport?: { segments?: ArrayLike<Segment> };
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

/** Subscribe to physical and window changes without replacing application state.
 * Applications should observe their own content with ResizeObserver as needed.
 */
export function observeFoldableViewport(
  source: Window & typeof globalThis,
  listener: (state: FoldableViewport) => void,
): () => void {
  const notify = () => listener(readFoldableViewport(source));
  const posture = (
    source.navigator as Navigator & {
      devicePosture?: EventTarget;
    }
  ).devicePosture;
  source.addEventListener('resize', notify);
  posture?.addEventListener('change', notify);
  notify();
  return () => {
    source.removeEventListener('resize', notify);
    posture?.removeEventListener('change', notify);
  };
}
