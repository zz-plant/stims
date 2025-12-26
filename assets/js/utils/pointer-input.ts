export type PointerPosition = {
  id: number;
  clientX: number;
  clientY: number;
  normalizedX: number;
  normalizedY: number;
};

export type PointerSummary = {
  pointers: PointerPosition[];
  centroid: { x: number; y: number };
  normalizedCentroid: { x: number; y: number };
};

export type GestureUpdate = {
  pointerCount: number;
  scale: number;
  rotation: number;
  translation: { x: number; y: number };
};

export type PointerInputOptions = {
  target?: HTMLElement | Window;
  boundsElement?: HTMLElement | null;
  onChange?: (summary: PointerSummary) => void;
  onGesture?: (gesture: GestureUpdate) => void;
  preventGestures?: boolean;
};

function normalizePoint(
  clientX: number,
  clientY: number,
  bounds: DOMRect
): { normalizedX: number; normalizedY: number } {
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const x = (clientX - bounds.left) / width;
  const y = (clientY - bounds.top) / height;

  return {
    normalizedX: x * 2 - 1,
    normalizedY: -(y * 2 - 1),
  };
}

export function createPointerInput({
  target = window,
  boundsElement = null,
  onChange,
  onGesture,
  preventGestures = true,
}: PointerInputOptions) {
  const activePointers = new Map<number, PointerPosition>();
  const listenerTarget: HTMLElement | Window = target;
  const boundsSource =
    boundsElement ??
    (target instanceof Window
      ? document.documentElement
      : (target as HTMLElement));

  let gestureAnchor: {
    centroid: { x: number; y: number };
    normalizedCentroid: { x: number; y: number };
    distance: number;
    angle: number;
  } | null = null;

  if (preventGestures && boundsSource instanceof HTMLElement) {
    boundsSource.style.touchAction = 'none';
  }

  function getBounds() {
    return boundsSource.getBoundingClientRect();
  }

  function summarizePointers(): PointerSummary {
    const pointers = Array.from(activePointers.values());
    if (!pointers.length) {
      return {
        pointers,
        centroid: { x: 0, y: 0 },
        normalizedCentroid: { x: 0, y: 0 },
      };
    }

    const total = pointers.reduce(
      (acc, pointer) => {
        acc.x += pointer.clientX;
        acc.y += pointer.clientY;
        acc.normalizedX += pointer.normalizedX;
        acc.normalizedY += pointer.normalizedY;
        return acc;
      },
      { x: 0, y: 0, normalizedX: 0, normalizedY: 0 }
    );

    const divisor = pointers.length || 1;
    return {
      pointers,
      centroid: { x: total.x / divisor, y: total.y / divisor },
      normalizedCentroid: {
        x: total.normalizedX / divisor,
        y: total.normalizedY / divisor,
      },
    };
  }

  function updateGesture(summary: PointerSummary) {
    if (activePointers.size < 2) {
      gestureAnchor = null;
      return;
    }

    const pointers = summary.pointers.slice(0, 2);
    const [p1, p2] = pointers;
    const dx = p2.clientX - p1.clientX;
    const dy = p2.clientY - p1.clientY;
    const distance = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);

    if (!gestureAnchor) {
      gestureAnchor = {
        centroid: summary.centroid,
        normalizedCentroid: summary.normalizedCentroid,
        distance,
        angle,
      };
      return;
    }

    const scale = distance / gestureAnchor.distance;
    const rotation = angle - gestureAnchor.angle;
    const translation = {
      x: summary.normalizedCentroid.x - gestureAnchor.normalizedCentroid.x,
      y: summary.normalizedCentroid.y - gestureAnchor.normalizedCentroid.y,
    };

    onGesture?.({
      pointerCount: activePointers.size,
      scale,
      rotation,
      translation,
    });
  }

  function upsertPointer(event: PointerEvent) {
    const bounds = getBounds();
    const normalized = normalizePoint(event.clientX, event.clientY, bounds);
    activePointers.set(event.pointerId, {
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      ...normalized,
    });
  }

  function handlePointerMove(event: PointerEvent) {
    upsertPointer(event);
    const summary = summarizePointers();
    onChange?.(summary);
    updateGesture(summary);
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.target instanceof Element && event.target.hasPointerCapture) {
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch {
        // Some elements cannot capture pointers; fail silently.
      }
    }
    upsertPointer(event);
    const summary = summarizePointers();
    onChange?.(summary);
    updateGesture(summary);
  }

  function handlePointerEnd(event: PointerEvent) {
    activePointers.delete(event.pointerId);
    const summary = summarizePointers();
    onChange?.(summary);
    updateGesture(summary);
  }

  listenerTarget.addEventListener('pointermove', handlePointerMove);
  listenerTarget.addEventListener('pointerdown', handlePointerDown);
  listenerTarget.addEventListener('pointerup', handlePointerEnd);
  listenerTarget.addEventListener('pointercancel', handlePointerEnd);
  listenerTarget.addEventListener('pointerout', handlePointerEnd);
  listenerTarget.addEventListener('pointerleave', handlePointerEnd);

  function dispose() {
    listenerTarget.removeEventListener('pointermove', handlePointerMove);
    listenerTarget.removeEventListener('pointerdown', handlePointerDown);
    listenerTarget.removeEventListener('pointerup', handlePointerEnd);
    listenerTarget.removeEventListener('pointercancel', handlePointerEnd);
    listenerTarget.removeEventListener('pointerout', handlePointerEnd);
    listenerTarget.removeEventListener('pointerleave', handlePointerEnd);
    activePointers.clear();
    gestureAnchor = null;
  }

  return { dispose };
}
