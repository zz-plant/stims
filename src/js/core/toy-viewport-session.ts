export type ToyViewportState = {
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
};

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
  };

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

    const cssChanged =
      viewportWidth !== state.cssWidth || viewportHeight !== state.cssHeight;
    if (cssChanged) {
      applyViewportVariables(viewportWidth, viewportHeight);
    }

    if (
      width === state.width &&
      height === state.height &&
      viewportWidth === state.cssWidth &&
      viewportHeight === state.cssHeight
    ) {
      return;
    }

    state = {
      width,
      height,
      cssWidth: viewportWidth,
      cssHeight: viewportHeight,
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

  // Track devicePixelRatio changes (e.g., moving between displays)
  let currentDpr = window.devicePixelRatio || 1;
  const dprQuery = window.matchMedia(`(resolution: ${currentDpr}dppx)`);
  const handleDprChange = () => {
    const newDpr = window.devicePixelRatio || 1;
    if (newDpr !== currentDpr) {
      currentDpr = newDpr;
      scheduleResize();
    }
  };
  if (typeof dprQuery.addEventListener === 'function') {
    dprQuery.addEventListener('change', handleDprChange);
  } else {
    dprQuery.addListener?.(handleDprChange);
  }

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

      if (typeof dprQuery.removeEventListener === 'function') {
        dprQuery.removeEventListener('change', handleDprChange);
      } else {
        dprQuery.removeListener?.(handleDprChange);
      }

      window.removeEventListener('orientationchange', handleOrientationChange);

      if (resizeFrameId !== null) {
        window.cancelAnimationFrame(resizeFrameId);
        resizeFrameId = null;
      }
      if (resizeTimeoutId !== null) {
        window.clearTimeout(resizeTimeoutId);
        resizeTimeoutId = null;
      }
    },
  };
}
