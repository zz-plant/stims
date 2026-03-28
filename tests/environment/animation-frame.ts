const DEFAULT_FRAME_MS = 16;

type AnimationFrameState = {
  autoAdvance: boolean;
  nextHandle: number;
  now: number;
  queue: Map<number, FrameRequestCallback>;
  timerId: ReturnType<typeof setTimeout> | null;
};

const state: AnimationFrameState = {
  autoAdvance: true,
  nextHandle: 1,
  now: 0,
  queue: new Map(),
  timerId: null,
};

function applyAnimationFrameGlobals() {
  const requestAnimationFrame = (callback: FrameRequestCallback) => {
    const handle = state.nextHandle;
    state.nextHandle += 1;
    state.queue.set(handle, callback);

    if (state.autoAdvance && state.timerId == null) {
      state.timerId = setTimeout(() => {
        state.timerId = null;
        if (state.queue.size > 0) {
          flushAnimationFrame();
        }
      }, DEFAULT_FRAME_MS);
    }

    return handle;
  };

  const cancelAnimationFrame = (handle: number) => {
    state.queue.delete(handle);
  };

  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: requestAnimationFrame,
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: cancelAnimationFrame,
  });

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: requestAnimationFrame,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: cancelAnimationFrame,
    });
  }
}

export function installAnimationFrameController(options?: {
  autoAdvance?: boolean;
}) {
  state.autoAdvance = options?.autoAdvance ?? true;
  resetAnimationFrameController();
  applyAnimationFrameGlobals();
}

export function flushAnimationFrame(frameMs = DEFAULT_FRAME_MS) {
  if (state.queue.size === 0) {
    state.now += frameMs;
    return;
  }

  const pending = [...state.queue.entries()];
  state.queue.clear();
  state.now += frameMs;

  for (const [, callback] of pending) {
    callback(state.now);
  }
}

export function advanceAnimationFrames(
  count: number,
  frameMs = DEFAULT_FRAME_MS,
) {
  for (let index = 0; index < count; index += 1) {
    flushAnimationFrame(frameMs);
  }
}

export function resetAnimationFrameController() {
  if (state.timerId != null) {
    clearTimeout(state.timerId);
  }
  state.nextHandle = 1;
  state.now = 0;
  state.queue.clear();
  state.timerId = null;
}
