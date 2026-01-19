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
  bounds: DOMRect,
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
  const supportsPointerEvents =
    typeof window !== 'undefined' && 'PointerEvent' in window;
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

  if (boundsSource instanceof HTMLElement) {
    boundsSource.style.touchAction = preventGestures ? 'none' : 'manipulation';
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
      { x: 0, y: 0, normalizedX: 0, normalizedY: 0 },
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

  function upsertPointer(pointerId: number, clientX: number, clientY: number) {
    const bounds = getBounds();
    const normalized = normalizePoint(clientX, clientY, bounds);
    activePointers.set(pointerId, {
      id: pointerId,
      clientX,
      clientY,
      ...normalized,
    });
  }

  function updateAndNotify() {
    const summary = summarizePointers();
    onChange?.(summary);
    updateGesture(summary);
  }

  function handlePointerMove(event: PointerEvent) {
    upsertPointer(event.pointerId, event.clientX, event.clientY);
    updateAndNotify();
  }

  function handlePointerDown(event: PointerEvent) {
    if (
      event.target instanceof Element &&
      typeof event.target.hasPointerCapture === 'function'
    ) {
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch {
        // Some elements cannot capture pointers; fail silently.
      }
    }
    upsertPointer(event.pointerId, event.clientX, event.clientY);
    updateAndNotify();
  }

  function handlePointerEnd(event: PointerEvent) {
    activePointers.delete(event.pointerId);
    updateAndNotify();
  }

  const addPointerListener = (
    type: keyof GlobalEventHandlersEventMap,
    handler: (event: PointerEvent) => void,
  ) => {
    listenerTarget.addEventListener(type, handler as EventListener);
  };

  const removePointerListener = (
    type: keyof GlobalEventHandlersEventMap,
    handler: (event: PointerEvent) => void,
  ) => {
    listenerTarget.removeEventListener(type, handler as EventListener);
  };

  const touchListenerOptions: AddEventListenerOptions = {
    passive: !preventGestures,
  };

  const updateFromTouches = (touches: TouchList) => {
    const nextIds = new Set<number>();
    for (const touch of Array.from(touches)) {
      nextIds.add(touch.identifier);
      upsertPointer(touch.identifier, touch.clientX, touch.clientY);
    }

    for (const id of activePointers.keys()) {
      if (!nextIds.has(id)) {
        activePointers.delete(id);
      }
    }
  };

  const handleTouchEvent = (event: Event) => {
    const touchEvent = event as TouchEvent;
    if (preventGestures) {
      touchEvent.preventDefault();
    }
    updateFromTouches(touchEvent.touches);
    updateAndNotify();
  };

  const handleMouseMove = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    upsertPointer(1, mouseEvent.clientX, mouseEvent.clientY);
    updateAndNotify();
  };

  const handleMouseDown = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    upsertPointer(1, mouseEvent.clientX, mouseEvent.clientY);
    updateAndNotify();
  };

  const handleMouseEnd = () => {
    activePointers.delete(1);
    updateAndNotify();
  };

  if (supportsPointerEvents) {
    addPointerListener('pointermove', handlePointerMove);
    addPointerListener('pointerdown', handlePointerDown);
    addPointerListener('pointerup', handlePointerEnd);
    addPointerListener('pointercancel', handlePointerEnd);
    addPointerListener('pointerout', handlePointerEnd);
    addPointerListener('pointerleave', handlePointerEnd);
  } else {
    listenerTarget.addEventListener(
      'touchstart',
      handleTouchEvent,
      touchListenerOptions,
    );
    listenerTarget.addEventListener(
      'touchmove',
      handleTouchEvent,
      touchListenerOptions,
    );
    listenerTarget.addEventListener(
      'touchend',
      handleTouchEvent,
      touchListenerOptions,
    );
    listenerTarget.addEventListener(
      'touchcancel',
      handleTouchEvent,
      touchListenerOptions,
    );
    listenerTarget.addEventListener('mousemove', handleMouseMove);
    listenerTarget.addEventListener('mousedown', handleMouseDown);
    listenerTarget.addEventListener('mouseup', handleMouseEnd);
    listenerTarget.addEventListener('mouseleave', handleMouseEnd);
  }

  function dispose() {
    if (supportsPointerEvents) {
      removePointerListener('pointermove', handlePointerMove);
      removePointerListener('pointerdown', handlePointerDown);
      removePointerListener('pointerup', handlePointerEnd);
      removePointerListener('pointercancel', handlePointerEnd);
      removePointerListener('pointerout', handlePointerEnd);
      removePointerListener('pointerleave', handlePointerEnd);
    } else {
      listenerTarget.removeEventListener(
        'touchstart',
        handleTouchEvent,
        touchListenerOptions,
      );
      listenerTarget.removeEventListener(
        'touchmove',
        handleTouchEvent,
        touchListenerOptions,
      );
      listenerTarget.removeEventListener(
        'touchend',
        handleTouchEvent,
        touchListenerOptions,
      );
      listenerTarget.removeEventListener(
        'touchcancel',
        handleTouchEvent,
        touchListenerOptions,
      );
      listenerTarget.removeEventListener('mousemove', handleMouseMove);
      listenerTarget.removeEventListener('mousedown', handleMouseDown);
      listenerTarget.removeEventListener('mouseup', handleMouseEnd);
      listenerTarget.removeEventListener('mouseleave', handleMouseEnd);
    }
    activePointers.clear();
    gestureAnchor = null;
  }

  return { dispose };
}
