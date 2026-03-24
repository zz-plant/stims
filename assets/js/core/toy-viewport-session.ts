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

  const scheduleResize = () => {
    if (resizeFrameId !== null) {
      return;
    }
    resizeFrameId = window.requestAnimationFrame(() => {
      resizeFrameId = null;
      handleResize();
    });
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

      if (resizeFrameId !== null) {
        window.cancelAnimationFrame(resizeFrameId);
        resizeFrameId = null;
      }
    },
  };
}
