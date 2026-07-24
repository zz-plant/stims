import { useEffect } from 'react';

function syncStageCanvasStyle(stage: HTMLDivElement | null) {
  const canvas = stage?.querySelector('canvas');
  if (
    !canvas ||
    typeof canvas !== 'object' ||
    !('style' in canvas) ||
    !('tagName' in canvas) ||
    canvas.tagName !== 'CANVAS'
  ) {
    return;
  }

  if (canvas.style.display !== 'block') {
    canvas.style.display = 'block';
  }
  if (canvas.style.width !== '100%') {
    canvas.style.width = '100%';
  }
  if (canvas.style.height !== '100%') {
    canvas.style.height = '100%';
  }
  if (canvas.style.maxWidth !== 'none') {
    canvas.style.maxWidth = 'none';
  }
  if (canvas.style.maxHeight !== 'none') {
    canvas.style.maxHeight = 'none';
  }
}

export function useStageCanvasSync(stageRef: {
  current: HTMLDivElement | null;
}) {
  useEffect(() => {
    const stage = stageRef.current;
    syncStageCanvasStyle(stage);
    if (!stage || typeof MutationObserver !== 'function') {
      return;
    }

    const observer = new MutationObserver(() => {
      syncStageCanvasStyle(stage);
    });

    observer.observe(stage, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });

    return () => {
      observer.disconnect();
    };
  }, [stageRef]);
}
