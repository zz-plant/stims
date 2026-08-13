/**
 * Picture-in-picture for the stage canvas. The Picture-in-Picture API only
 * accepts a `<video>` element, so a canvas is mirrored into one via
 * `canvas.captureStream()` and never shown on screen itself.
 *
 * Two lessons carried over from an earlier version of this feature (lost in
 * an unrelated 2026-07 refactor, rebuilt here):
 *   - `requestPictureInPicture()` needs to run inside the same user-gesture
 *     call stack that started it. Unconditionally `await`ing `video.play()`
 *     first can push the request past that window on some browsers — only
 *     await when the video genuinely has no frame yet.
 *   - The stage canvas element gets replaced (backend switch, renderer
 *     recreation), which would otherwise leave an active PiP window frozen
 *     on a detached canvas. `resync()` re-captures from the current canvas
 *     and swaps the stream in place; the caller is responsible for invoking
 *     it when the stage DOM changes (see `usePictureInPicture`).
 */

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
  doc = document,
}: {
  getCanvas: () => HTMLCanvasElement | null;
  doc?: Document;
}) {
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let sourceCanvas: HTMLCanvasElement | null = null;
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
    el.addEventListener('leavepictureinpicture', emit);
    doc.body.appendChild(el);
    video = el;
    return el;
  }

  function captureFrom(canvas: HTMLCanvasElement): MediaStream {
    stream?.getTracks().forEach((track) => track.stop());
    stream = canvas.captureStream();
    sourceCanvas = canvas;
    return stream;
  }

  /** Must be called directly from a click handler — see file header. */
  async function enter(): Promise<PictureInPictureEnterResult> {
    if (disposed) {
      return { ok: false, reason: 'unsupported' };
    }
    if (!isPictureInPictureSupported(doc)) {
      return { ok: false, reason: 'unsupported' };
    }
    const canvas = getCanvas();
    if (!canvas) {
      return { ok: false, reason: 'no-canvas' };
    }

    const el = ensureVideo();
    el.srcObject = captureFrom(canvas);

    const playPromise = el.play();
    if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        await playPromise;
      } catch (error) {
        return { ok: false, reason: 'play-failed', error };
      }
    } else {
      void playPromise.catch(() => undefined);
    }

    try {
      await el.requestPictureInPicture();
      return { ok: true };
    } catch (error) {
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

  /** Re-point the stream at whatever canvas `getCanvas()` returns now. */
  function resync() {
    if (!video || doc.pictureInPictureElement !== video) return;
    const canvas = getCanvas();
    if (!canvas || canvas === sourceCanvas) return;
    video.srcObject = captureFrom(canvas);
    void video.play().catch(() => undefined);
  }

  return {
    enter,
    exit,
    resync,
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
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      sourceCanvas = null;
      video?.remove();
      video = null;
      subscribers.clear();
    },
  };
}

export type PictureInPictureController = ReturnType<
  typeof createPictureInPictureController
>;
