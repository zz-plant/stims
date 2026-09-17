import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createDocumentPictureInPictureController,
  type DocumentPictureInPictureController,
  isDocumentPictureInPictureSupported,
} from '../../core/services/document-picture-in-picture-service.ts';
import {
  createPictureInPictureController,
  isPictureInPictureSupported,
  type PictureInPictureController,
} from '../../core/services/picture-in-picture-service.ts';

/**
 * Transport the popout window can offer. Supplying these opts into the
 * document-based popout where the browser has it; without them there is
 * nothing to put in that window's control row that the video popout does
 * not already do, so it stays on the video path.
 */
export type PopoutTransport = {
  paused: boolean;
  previousPreset: () => void;
  nextPreset: () => void;
  togglePlayback: () => void;
};

/**
 * Gates the "Picture in picture" affordance on real browser support and
 * mirrors the stage canvas — inside `stageRef` — into a floating PiP window.
 * `supported` is a synchronous read, so it's correct on first render.
 *
 * Two popouts sit behind one control. Document PiP is preferred wherever the
 * browser has it, because the video one floats the pixels and nothing else:
 * the browser's own transport means nothing over a canvas stream, so the
 * only way to change preset was to go back to the tab the popout existed to
 * get away from. Everywhere else, the video popout is still better than no
 * popout.
 */
export function usePictureInPicture(
  stageRef: React.RefObject<HTMLDivElement | null>,
  transport?: PopoutTransport,
) {
  const [useDocumentPopout] = useState(
    () => transport !== undefined && isDocumentPictureInPictureSupported(),
  );
  const [supported] = useState(
    () =>
      isPictureInPictureSupported() || isDocumentPictureInPictureSupported(),
  );
  const [active, setActive] = useState(false);
  const controllerRef = useRef<
    PictureInPictureController | DocumentPictureInPictureController | null
  >(null);
  // The popout's buttons live in another document and are wired once, so they
  // must read the current handlers rather than the ones captured at open.
  const transportRef = useRef(transport);
  transportRef.current = transport;

  useEffect(() => {
    if (!supported) return;
    const getCanvas = () => stageRef.current?.querySelector('canvas') ?? null;
    const controller = useDocumentPopout
      ? createDocumentPictureInPictureController({
          getCanvas,
          actions: {
            previousPreset: () => transportRef.current?.previousPreset(),
            nextPreset: () => transportRef.current?.nextPreset(),
            togglePlayback: () => transportRef.current?.togglePlayback(),
            isPaused: () => transportRef.current?.paused ?? false,
          },
        })
      : createPictureInPictureController({ getCanvas });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe((state) =>
      setActive(state.active),
    );
    return () => {
      unsubscribe();
      controllerRef.current = null;
      controller.dispose();
    };
  }, [supported, stageRef, useDocumentPopout]);

  // Pausing from the main window has to reach the popout's own button: it is
  // in a document React does not render, so nothing re-draws it on its own.
  const paused = transport?.paused;
  useEffect(() => {
    if (!active || paused === undefined) return;
    const controller = controllerRef.current;
    if (controller && 'syncPlaybackState' in controller) {
      controller.syncPlaybackState();
    }
  }, [active, paused]);

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
