export const FLOW_WARMUP_INTERVAL_MS = 60000;
export const FLOW_ENGAGED_INTERVAL_MS = 90000;
export const FLOW_IDLE_INTERVAL_MS = 120000;
export const FLOW_ENGAGEMENT_WINDOW_MS = 2 * 60 * 1000;

export function getFlowIntervalMs({
  cycleCount,
  lastInteractionAt,
  now = Date.now(),
}: {
  cycleCount: number;
  lastInteractionAt: number;
  now?: number;
}) {
  if (cycleCount < 1) {
    return FLOW_WARMUP_INTERVAL_MS;
  }

  if (now - lastInteractionAt <= FLOW_ENGAGEMENT_WINDOW_MS) {
    return FLOW_ENGAGED_INTERVAL_MS;
  }

  return FLOW_IDLE_INTERVAL_MS;
}

export function createFlowTimer({
  windowRef = () => (typeof window !== 'undefined' ? window : null),
  getDelay,
  onTick,
}: {
  windowRef?: () => Window | null;
  getDelay: () => number;
  onTick: () => void;
}) {
  let timer: number | null = null;

  const clear = () => {
    if (timer === null) return;
    const win = windowRef();
    win?.clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    const win = windowRef();
    if (!win) return;
    timer = win.setTimeout(() => {
      onTick();
    }, getDelay());
  };

  return { clear, schedule };
}
