import { useEffect, useRef } from 'react';
import {
  getActiveAccessibilityPreference,
  subscribeToAccessibilityPreference,
} from '../../core/accessibility-preferences.ts';
import type { PresetSensoryProfile } from '../../core/sensory-profile.ts';
import { primingHoldForProfile } from '../../core/services/flash-governor.ts';
import {
  createFlashSafetyController,
  createStageLuminanceApplier,
} from '../../core/services/flash-safety.ts';
import { setStageLuminanceChannel } from '../../core/services/stage-luminance.ts';

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
 *
 * `activeProfile` is the catalog's offline measurement for the preset now on
 * screen. It is what lets the governor start clamped on content already
 * known to flash, instead of rediscovering it a flash at a time — the
 * reactive path's one structural weakness.
 */
export function useFlashSafety(
  stageRef: { current: HTMLDivElement | null },
  activeProfile?: PresetSensoryProfile,
) {
  const controllerRef = useRef<ReturnType<
    typeof createFlashSafetyController
  > | null>(null);

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
      controllerRef.current = controller;
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
      controllerRef.current = null;
    };
  }, [stageRef]);

  // Separate effect: the preset changes far more often than the canvas does,
  // and rebuilding the controller on every switch would throw away the
  // window the governor is mid-way through measuring.
  useEffect(() => {
    if (!activeProfile) return;
    const hold = primingHoldForProfile(activeProfile);
    if (hold > 0) {
      controllerRef.current?.prime(hold);
    }
  }, [activeProfile]);
}

/**
 * Holds the visitor's brightness ceiling on the stage.
 *
 * Separate from the governor's own effect and deliberately not gated on
 * `reduceFlashing`: this one is a comfort preference someone set on purpose,
 * and it applies whether or not they also asked for flash mitigation. Both
 * write through `stage-luminance.ts`, which composes them.
 */
export function useStageBrightness(stageRef: {
  current: HTMLDivElement | null;
}) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const apply = (scale: number) =>
      setStageLuminanceChannel(stage, 'ceiling', scale);

    apply(getActiveAccessibilityPreference().stageBrightness);
    const unsubscribe = subscribeToAccessibilityPreference((preference) =>
      apply(preference.stageBrightness),
    );

    return () => {
      unsubscribe();
      // Leaving the ceiling engaged on a stage this hook no longer owns
      // would dim a canvas nothing is watching.
      apply(1);
    };
  }, [stageRef]);
}
