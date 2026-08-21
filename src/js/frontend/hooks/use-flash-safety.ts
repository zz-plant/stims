import { useEffect } from 'react';
import {
  createFlashSafetyController,
  createStageLuminanceApplier,
} from '../../core/services/flash-safety.ts';

/**
 * Runs the WCAG flash governor over whatever the stage is currently showing.
 *
 * The canvas is created by the renderer after mount and replaced whenever the
 * backend changes, so this watches the stage for it rather than taking it as
 * a prop — the same reason `use-stage-canvas-sync.ts` uses a MutationObserver.
 * Attaching to a stale canvas would silently protect nothing.
 *
 * Gated inside the controller on the `reduceFlashing` accessibility
 * preference, so this hook can stay mounted unconditionally.
 */
export function useFlashSafety(stageRef: { current: HTMLDivElement | null }) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof requestAnimationFrame !== 'function') {
      return;
    }

    let controller: ReturnType<typeof createFlashSafetyController> | null =
      null;
    let attachedCanvas: HTMLCanvasElement | null = null;

    const attach = () => {
      const canvas = stage.querySelector('canvas');
      if (canvas === attachedCanvas) return;

      controller?.stop();
      controller = null;
      attachedCanvas = null;

      if (!(canvas instanceof HTMLCanvasElement)) return;
      attachedCanvas = canvas;
      controller = createFlashSafetyController({
        canvas,
        applyLuminanceScale: createStageLuminanceApplier(stage),
      });
      controller.start();
    };

    attach();

    const observer =
      typeof MutationObserver === 'function'
        ? new MutationObserver(attach)
        : null;
    observer?.observe(stage, { subtree: true, childList: true });

    return () => {
      observer?.disconnect();
      controller?.stop();
    };
  }, [stageRef]);
}
