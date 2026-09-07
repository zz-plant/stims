export type ToyViewportState = {
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  /**
   * devicePixelRatio at measurement time. Part of the state so a display
   * move that changes DPR without changing CSS dimensions still reaches
   * onResize — the renderer derives its buffer size from this.
   */
  dpr: number;
};

/**
 * Minimum gap between onResize deliveries during a resize burst. Chosen to
 * sit well above one frame (so per-frame viewport animation coalesces) and
 * well below human "the window looks wrong" latency.
 */
const RESIZE_SETTLE_MS = 250;

export function createToyViewportSession({
  container,
  onResize,
}: {
  container: HTMLElement | null;
  onResize: (state: ToyViewportState) => void;
}) {
  let resizeObserver: ResizeObserver | null = null;
  let resizeHandler: (() => void) | null = null;
  let viewportResizeHandler: (() => void) | null = null;
  let resizeFrameId: number | null = null;
  let resizeTimeoutId: number | null = null;
  let state: ToyViewportState = {
    width: window.innerWidth,
    height: window.innerHeight,
    cssWidth: window.innerWidth,
    cssHeight: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  };
  // Burst deferral (see handleResize): timestamp of the last state actually
  // delivered to onResize, and the pending re-measure timer for a burst.
  let lastResizeAppliedAt = Number.NEGATIVE_INFINITY;
  let settleTimeoutId: number | null = null;

  const applyViewportVariables = (cssWidth: number, cssHeight: number) => {
    document.documentElement.style.setProperty(
      '--app-height',
      `${cssHeight}px`,
    );
    document.documentElement.style.setProperty('--app-width', `${cssWidth}px`);
  };

  const handleResize = () => {
    const visualViewport = window.visualViewport;
    const viewportWidth = Math.max(
      1,
      Math.round(visualViewport?.width ?? window.innerWidth),
    );
    const viewportHeight = Math.max(
      1,
      Math.round(visualViewport?.height ?? window.innerHeight),
    );
    let width = viewportWidth;
    let height = viewportHeight;

    if (container && container !== document.body) {
      width = Math.max(1, container.clientWidth);
      height = Math.max(1, container.clientHeight);
    }

    const dpr = window.devicePixelRatio || 1;

    const cssChanged =
      viewportWidth !== state.cssWidth || viewportHeight !== state.cssHeight;
    if (cssChanged) {
      applyViewportVariables(viewportWidth, viewportHeight);
    }

    if (
      width === state.width &&
      height === state.height &&
      viewportWidth === state.cssWidth &&
      viewportHeight === state.cssHeight &&
      dpr === state.dpr
    ) {
      return;
    }

    // Rate-limit the expensive path. onResize ends in a drawing-buffer
    // resize, and WebGPU rebuilds its color/depth attachments on every one —
    // the iOS URL-bar animation and desktop window drags emit a resize per
    // frame, which meant a rebuild per frame for the whole gesture. The CSS
    // variables above still track every tick (layout must follow the
    // viewport live); the buffer applies at most once per settle window,
    // with a timer re-measuring after the burst so the final size always
    // lands. The canvas is CSS-sized, so mid-burst frames render slightly
    // stretched rather than wrong.
    const now = performance.now();
    if (now - lastResizeAppliedAt < RESIZE_SETTLE_MS) {
      if (settleTimeoutId === null) {
        settleTimeoutId = window.setTimeout(() => {
          settleTimeoutId = null;
          handleResize();
        }, RESIZE_SETTLE_MS);
      }
      return;
    }
    lastResizeAppliedAt = now;

    state = {
      width,
      height,
      cssWidth: viewportWidth,
      cssHeight: viewportHeight,
      dpr,
    };
    onResize(state);
  };

  // Coalesce bursts of resize events into one measurement, but not through rAF
  // alone: a hidden document runs no animation frames, so the callback sits
  // queued and the drawing buffer keeps its old size indefinitely. That is
  // reachable in normal use — `orientationchange`, `visualViewport`
  // resize/scroll and the devicePixelRatio media query are ordinary events that
  // still fire while hidden — and it is routine in agent mode, which renders
  // deliberately while `document.hidden` is true.
  //
  // Timeouts do run in hidden documents (throttled to about a second, which is
  // fine for a coalescing window), so they are the fallback whenever frames are
  // not being serviced. Verified in a hidden tab: an orientationchange took
  // --app-width from 1265px to 900px and resized the buffer from 3042x1900 to
  // 2212x1500, where before the change nothing happened at all.
  //
  // This does NOT make container resizes work while hidden: ResizeObserver
  // delivers its notifications as part of the rendering steps, which a hidden
  // document skips, so `scheduleResize` is never called on that path in the
  // first place. Detection there resumes when the document becomes visible.
  const runScheduledResize = () => {
    resizeFrameId = null;
    resizeTimeoutId = null;
    handleResize();
  };

  const scheduleResize = () => {
    if (resizeFrameId !== null || resizeTimeoutId !== null) {
      return;
    }
    if (document.hidden) {
      resizeTimeoutId = window.setTimeout(runScheduledResize, 0);
      return;
    }
    resizeFrameId = window.requestAnimationFrame(runScheduledResize);
  };

  if (typeof ResizeObserver !== 'undefined' && container) {
    resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(container);
  } else {
    resizeHandler = scheduleResize;
    window.addEventListener('resize', resizeHandler);
  }

  if (window.visualViewport) {
    viewportResizeHandler = scheduleResize;
    window.visualViewport.addEventListener('resize', viewportResizeHandler);
    window.visualViewport.addEventListener('scroll', viewportResizeHandler);
  }

  // Explicit orientationchange handler — visualViewport + ResizeObserver
  // fire on orientation change but with inconsistent timing across browsers.
  // A direct listener ensures immediate, reliable response.
  const handleOrientationChange = () => scheduleResize();
  window.addEventListener('orientationchange', handleOrientationChange, {
    passive: true,
  });

  // Track devicePixelRatio changes (e.g., moving between displays). The
  // query only matches the CURRENT ratio, so it must be re-created after
  // every change — a listener left on the old query fires once and then
  // never again for moves between two further displays.
  let currentDpr = window.devicePixelRatio || 1;
  let dprQuery: MediaQueryList | null = null;
  const handleDprChange = () => {
    const newDpr = window.devicePixelRatio || 1;
    if (newDpr !== currentDpr) {
      currentDpr = newDpr;
      bindDprQuery();
      scheduleResize();
    }
  };
  const unbindDprQuery = () => {
    if (!dprQuery) return;
    if (typeof dprQuery.removeEventListener === 'function') {
      dprQuery.removeEventListener('change', handleDprChange);
    } else {
      dprQuery.removeListener?.(handleDprChange);
    }
    dprQuery = null;
  };
  const bindDprQuery = () => {
    unbindDprQuery();
    dprQuery = window.matchMedia(`(resolution: ${currentDpr}dppx)`);
    if (typeof dprQuery.addEventListener === 'function') {
      dprQuery.addEventListener('change', handleDprChange);
    } else {
      dprQuery.addListener?.(handleDprChange);
    }
  };
  bindDprQuery();

  handleResize();

  return {
    getState: () => state,
    scheduleResize,
    dispose: () => {
      resizeObserver?.disconnect();
      resizeObserver = null;

      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }

      if (viewportResizeHandler && window.visualViewport) {
        window.visualViewport.removeEventListener(
          'resize',
          viewportResizeHandler,
        );
        window.visualViewport.removeEventListener(
          'scroll',
          viewportResizeHandler,
        );
        viewportResizeHandler = null;
      }

      unbindDprQuery();

      window.removeEventListener('orientationchange', handleOrientationChange);

      if (resizeFrameId !== null) {
        window.cancelAnimationFrame(resizeFrameId);
        resizeFrameId = null;
      }
      if (resizeTimeoutId !== null) {
        window.clearTimeout(resizeTimeoutId);
        resizeTimeoutId = null;
      }
      if (settleTimeoutId !== null) {
        window.clearTimeout(settleTimeoutId);
        settleTimeoutId = null;
      }
    },
  };
}
