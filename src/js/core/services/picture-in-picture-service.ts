/**
 * Picture-in-picture for the stage canvas. The Picture-in-Picture API only
 * accepts a `<video>` element, so the stage is mirrored into one via
 * `canvas.captureStream()` and never shown on screen itself.
 *
 * The captured canvas is not the stage canvas but a presented copy of it
 * (`createPresentedStageCanvas`, stage-presentation.ts) with the flash
 * governor's dimming, the brightness ceiling, the D blackout and the Y white
 * flash painted in. The browser draws this window itself, so CSS on the
 * video, which is how the projector and the document popout carry those,
 * would do nothing here. The copy reads whichever canvas the stage holds on
 * every frame, so a backend switch or renderer rebuild that replaces the
 * canvas no longer freezes the window on the detached one.
 *
 * One lesson carried over from an earlier version of this feature (lost in
 * an unrelated 2026-07 refactor, rebuilt here): `requestPictureInPicture()`
 * needs to run inside the same user-gesture call stack that started it.
 * Unconditionally `await`ing `video.play()` first can push the request past
 * that window on some browsers — only await when the video genuinely has no
 * frame yet.
 */

import {
  createPresentedStageCanvas,
  type PresentedStageCanvas,
  readLiveStagePresentation,
} from './stage-presentation.ts';

export type PictureInPictureState = {
  active: boolean;
};

export type PictureInPictureEnterResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'unsupported' | 'no-canvas' | 'play-failed' | 'request-failed';
      error?: unknown;
    };

export function isPictureInPictureSupported(doc: Document = document): boolean {
  const hasVideoApi =
    typeof HTMLVideoElement !== 'undefined' &&
    'requestPictureInPicture' in HTMLVideoElement.prototype;
  const hasCanvasStream =
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';
  return Boolean(doc.pictureInPictureEnabled && hasVideoApi && hasCanvasStream);
}

export function createPictureInPictureController({
  getCanvas,
  getStage,
  doc = document,
  createCanvas,
}: {
  getCanvas: () => HTMLCanvasElement | null;
  /** The element the stage's luminance filter is written on. */
  getStage: () => HTMLElement | null;
  doc?: Document;
  /** Test seam for the presented copy's canvases. */
  createCanvas?: () => HTMLCanvasElement;
}) {
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let presented: PresentedStageCanvas | null = null;
  let disposed = false;
  const subscribers = new Set<(state: PictureInPictureState) => void>();

  const state = (): PictureInPictureState => ({
    active: video !== null && doc.pictureInPictureElement === video,
  });

  const emit = () => {
    const snapshot = state();
    subscribers.forEach((subscriber) => subscriber(snapshot));
  };

  function ensureVideo(): HTMLVideoElement {
    if (video) return video;
    const el = doc.createElement('video');
    el.className = 'pip-video-helper';
    el.muted = true;
    el.playsInline = true;
    el.setAttribute('aria-hidden', 'true');
    el.tabIndex = -1;
    // Off-screen, not display:none — some browsers refuse PiP on a video
    // with no layout box.
    el.style.position = 'fixed';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.addEventListener('enterpictureinpicture', emit);
    el.addEventListener('leavepictureinpicture', () => {
      // The presented copy repaints on every stage frame; left running after
      // the window closes, it would cost two blits a frame for nothing.
      releaseStream();
      emit();
    });
    doc.body.appendChild(el);
    video = el;
    return el;
  }

  function releaseStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    presented?.dispose();
    presented = null;
    if (video) video.srcObject = null;
  }

  /** Must be called directly from a click handler — see file header. */
  async function enter(): Promise<PictureInPictureEnterResult> {
    if (disposed) {
      return { ok: false, reason: 'unsupported' };
    }
    if (!isPictureInPictureSupported(doc)) {
      return { ok: false, reason: 'unsupported' };
    }
    if (!getCanvas()) {
      return { ok: false, reason: 'no-canvas' };
    }

    releaseStream();
    presented = createPresentedStageCanvas({
      getCanvas,
      presentation: () => readLiveStagePresentation(getStage()),
      createCanvas,
    });
    // Without a 2D context there is no way to carry the dimming, and a
    // window that strobes at full brightness with Reduce flashing on is the
    // failure this copy exists to prevent.
    if (!presented) {
      return { ok: false, reason: 'unsupported' };
    }
    const el = ensureVideo();
    stream = presented.canvas.captureStream();
    el.srcObject = stream;

    const playPromise = el.play();
    if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        await playPromise;
      } catch (error) {
        releaseStream();
        return { ok: false, reason: 'play-failed', error };
      }
    } else {
      void playPromise.catch(() => undefined);
    }

    try {
      await el.requestPictureInPicture();
      return { ok: true };
    } catch (error) {
      releaseStream();
      return { ok: false, reason: 'request-failed', error };
    }
  }

  async function exit() {
    if (doc.pictureInPictureElement !== video) return;
    try {
      await doc.exitPictureInPicture();
    } catch {
      // The floating window has its own OS-level close control, so it can
      // already be gone by the time this runs — a stale `video` reference
      // racing a user-initiated close, not a bug to surface.
    }
  }

  return {
    enter,
    exit,
    isActive: () => state().active,
    getState: state,
    subscribe: (subscriber: (state: PictureInPictureState) => void) => {
      subscribers.add(subscriber);
      subscriber(state());
      return () => subscribers.delete(subscriber);
    },
    dispose: () => {
      disposed = true;
      void exit();
      releaseStream();
      video?.remove();
      video = null;
      subscribers.clear();
    },
  };
}

export type PictureInPictureController = ReturnType<
  typeof createPictureInPictureController
>;
