import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPictureInPictureController,
  isPictureInPictureSupported,
  type PictureInPictureController,
} from '../../core/services/picture-in-picture-service.ts';

/**
 * Gates the "Picture in picture" affordance on real browser support and
 * mirrors the stage canvas — inside `stageRef` — into a floating PiP window.
 * `supported` is a synchronous read (unlike WebXR's async device probe), so
 * it's correct on first render.
 */
export function usePictureInPicture(
  stageRef: React.RefObject<HTMLDivElement | null>,
) {
  const [supported] = useState(() => isPictureInPictureSupported());
  const [active, setActive] = useState(false);
  const controllerRef = useRef<PictureInPictureController | null>(null);

  useEffect(() => {
    if (!supported) return;
    const controller = createPictureInPictureController({
      getCanvas: () => stageRef.current?.querySelector('canvas') ?? null,
    });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe((state) =>
      setActive(state.active),
    );
    return () => {
      unsubscribe();
      controllerRef.current = null;
      controller.dispose();
    };
  }, [supported, stageRef]);

  // The renderer can swap the canvas element out from under an open PiP
  // window (backend switch, renderer recreation) — resync() is a no-op
  // unless PiP is actually active and the canvas reference changed.
  useEffect(() => {
    const stage = stageRef.current;
    const controller = controllerRef.current;
    if (
      !active ||
      !stage ||
      !controller ||
      typeof MutationObserver !== 'function'
    ) {
      return;
    }
    const observer = new MutationObserver(() => controller.resync());
    observer.observe(stage, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, [active, stageRef]);

  // Called straight from the click handler: PiP requires transient user
  // activation, so this must not be deferred behind an effect or an await
  // the caller performs first.
  const toggle = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (controller.isActive()) {
      void controller.exit();
      return;
    }
    void controller.enter().then((result) => {
      if (!result.ok) {
        console.warn(
          `Could not enter picture-in-picture (${result.reason}).`,
          'error' in result ? result.error : undefined,
        );
      }
    });
  }, []);

  return { supported, active, toggle };
}
