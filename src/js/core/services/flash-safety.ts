/**
 * Ties the flash governor (the `flash-guard` package) to the Stims stage.
 *
 * The package owns the WCAG decision, the sampler and the loop that connects
 * them; this module supplies the three things only the app knows:
 *
 * - When to sample. Frames come from the render loops' frame-drawn
 *   notification (`core/frame-drawn.ts`), in the same task as the draw. Read
 *   from a separate requestAnimationFrame callback, a WebGPU canvas came back
 *   fully transparent and a WebGL one (no preserveDrawingBuffer outside agent
 *   mode) at about a quarter of its on-screen brightness, so the governor
 *   never saw a flash in production.
 * - Whether to act. Gated on the `reduceFlashing` accessibility preference,
 *   which already means "do not hand me strobing content" for the catalog.
 *   Clamping live output is the runtime half of the same promise, and the
 *   preference defaults on under prefers-reduced-motion, so the people most
 *   likely to need it do not have to go looking for a switch.
 * - Where the mitigation goes. The stage's CSS brightness filter is shared
 *   with the visitor's comfort ceiling, so the governor writes its channel
 *   through `stage-luminance.ts` and reads the composed scale back for its
 *   feedback correction.
 */
import {
  createFlashController,
  type FlashController,
  type FlashControllerOptions,
} from 'flash-guard';
import {
  getActiveAccessibilityPreference,
  subscribeToAccessibilityPreference,
} from '../accessibility-preferences.ts';
import { subscribeToFrameDrawn } from '../frame-drawn.ts';
import {
  setStageLuminanceChannel,
  stageLuminanceScale,
} from './stage-luminance.ts';

/**
 * The package's controller options, with the app's frame source and
 * preference gate as defaults. Tests override them to run without a DOM.
 */
export type FlashSafetyOptions = FlashControllerOptions;

export function createFlashSafetyController(
  options: FlashSafetyOptions,
): FlashController {
  const isEnabled =
    options.isEnabled ??
    (() => getActiveAccessibilityPreference().reduceFlashing);
  const controller = createFlashController({
    subscribeToFrames: subscribeToFrameDrawn,
    ...options,
    isEnabled,
  });

  // A preference change should take effect now, not on the next strobe.
  const unsubscribe = subscribeToAccessibilityPreference(() => {
    if (!isEnabled()) controller.release();
  });

  return {
    ...controller,
    stop: () => {
      unsubscribe();
      controller.stop();
    },
  };
}

/**
 * Applies a luminance scale to a stage element as a CSS brightness filter.
 *
 * Writes through `stage-luminance.ts` rather than touching `style.filter`
 * directly: the visitor's comfort ceiling shares that one property, and the
 * governor would overwrite it every frame.
 */
export function createStageLuminanceApplier(stage: HTMLElement) {
  return (scale: number) => {
    setStageLuminanceChannel(stage, 'governor', scale);
  };
}

/**
 * The composed scale on that same stage, for the controller's feedback
 * correction. Paired with the applier above so a caller cannot wire one
 * without the other and leave the governor reading its own channel.
 */
export function createStageCompositedScale(stage: HTMLElement) {
  return () => stageLuminanceScale(stage);
}
