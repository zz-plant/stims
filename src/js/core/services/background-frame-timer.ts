/**
 * Drives frame ticks in background tabs using a Web Worker timer,
 * falling back to setInterval if Web Workers are unavailable.
 *
 * Browsers throttle requestAnimationFrame and window.setInterval to 0-1 Hz
 * in inactive tabs (document.hidden). A Web Worker's setInterval is exempt
 * from this throttling, allowing active recordings to maintain consistent
 * frame rates without freezing while audio continues.
 */

export interface BackgroundFrameTimer {
  start(): void;
  stop(): void;
  dispose(): void;
}

export function createBackgroundFrameTimer(
  onTick: () => void,
  intervalMs = 16,
): BackgroundFrameTimer {
  let worker: Worker | null = null;
  let objectUrl: string | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let running = false;

  try {
    if (
      typeof Worker !== 'undefined' &&
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      const script = `
        var timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (!timer) {
              timer = setInterval(function() {
                self.postMessage('tick');
              }, ${Math.max(1, Math.round(intervalMs))});
            }
          } else if (e.data === 'stop') {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        };
      `;
      const blob = new Blob([script], { type: 'application/javascript' });
      objectUrl = URL.createObjectURL(blob);
      worker = new Worker(objectUrl);
      worker.onmessage = (event: MessageEvent) => {
        if (event.data === 'tick' && running) {
          onTick();
        }
      };
    }
  } catch {
    worker = null;
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignored
      }
      objectUrl = null;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      if (worker) {
        worker.postMessage('start');
      } else {
        intervalId = setInterval(onTick, Math.max(1, Math.round(intervalMs)));
      }
    },
    stop() {
      if (!running) return;
      running = false;
      if (worker) {
        worker.postMessage('stop');
      }
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    dispose() {
      this.stop();
      if (worker) {
        try {
          worker.terminate();
        } catch {
          // Ignored
        }
        worker = null;
      }
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // Ignored
        }
        objectUrl = null;
      }
    },
  };
}
