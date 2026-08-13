/**
 * Minimal `immersive-vr` support: probe, enter on a user gesture, attach the
 * session to the live three.js renderer, and get back to exactly the
 * pre-session state on exit.
 *
 * Deliberately narrow: no controller input, no hand tracking, no
 * `immersive-ar`, no stereo-specific preset tuning. Frames are driven by the
 * renderer's own `setAnimationLoop` — three.js's `WebXRManager` swaps the
 * frame source to `XRSession.requestAnimationFrame` behind that call — so
 * there is no bespoke XR render loop here.
 *
 * WebXR types are not in TypeScript's DOM lib, so the shapes this module
 * touches are declared structurally below rather than pulled from
 * `@types/webxr`.
 */
import {
  getActiveRendererHandle,
  type RendererHandle,
  subscribeToRendererLifecycle,
} from './render-service.ts';

export type XrSessionLike = {
  addEventListener: (type: 'end', listener: () => void) => void;
  removeEventListener?: (type: 'end', listener: () => void) => void;
  end: () => Promise<void> | void;
};

type XrSystemLike = {
  isSessionSupported?: (mode: string) => Promise<boolean>;
  requestSession?: (mode: string, init?: unknown) => Promise<XrSessionLike>;
};

type RendererXrManagerLike = {
  enabled: boolean;
  setSession: (session: XrSessionLike | null) => Promise<void> | void;
};

export const IMMERSIVE_VR_MODE = 'immersive-vr';

/**
 * Read `navigator.xr` lazily. `navigator` itself may be undefined (SSR,
 * worker, some test DOMs) and `xr` is absent on every browser without
 * WebXR, so nothing here may be resolved at module load.
 */
function getXrSystem(navigatorLike?: unknown): XrSystemLike | null {
  const nav =
    navigatorLike ??
    (typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as { xr?: XrSystemLike }));
  if (!nav || typeof nav !== 'object') {
    return null;
  }
  const xr = (nav as { xr?: XrSystemLike }).xr;
  return xr && typeof xr === 'object' ? xr : null;
}

/**
 * True only when the browser exposes WebXR *and* it reports an
 * `immersive-vr` device. Never throws: a rejected or throwing
 * `isSessionSupported` (some browsers reject in insecure contexts) is
 * treated as "not supported".
 */
export async function isImmersiveVrSupported(
  navigatorLike?: unknown,
): Promise<boolean> {
  const xr = getXrSystem(navigatorLike);
  if (!xr || typeof xr.isSessionSupported !== 'function') {
    return false;
  }
  try {
    return (await xr.isSessionSupported(IMMERSIVE_VR_MODE)) === true;
  } catch {
    return false;
  }
}

export type WebXrEnterResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'already-active'
        | 'unsupported'
        | 'no-renderer'
        | 'unsupported-backend'
        | 'renderer-changed'
        | 'request-failed';
      error?: unknown;
    };

export type WebXrState = {
  active: boolean;
  pending: boolean;
};

function getXrManager(handle: RendererHandle): RendererXrManagerLike | null {
  const xr = (handle.renderer as unknown as { xr?: RendererXrManagerLike }).xr;
  return xr && typeof xr.setSession === 'function' ? xr : null;
}

export function createWebXrSessionController({
  getHandle = getActiveRendererHandle,
  subscribeToLifecycle = subscribeToRendererLifecycle,
  navigatorLike,
}: {
  getHandle?: () => RendererHandle | null;
  subscribeToLifecycle?: typeof subscribeToRendererLifecycle;
  navigatorLike?: unknown;
} = {}) {
  let session: XrSessionLike | null = null;
  let boundHandle: RendererHandle | null = null;
  let pending = false;
  let disposed = false;
  const subscribers = new Set<(state: WebXrState) => void>();

  const state = (): WebXrState => ({ active: session !== null, pending });

  const emit = () => {
    const snapshot = state();
    subscribers.forEach((subscriber) => subscriber(snapshot));
  };

  const handleSessionEnd = () => {
    const endedSession = session;
    const handle = boundHandle;
    session = null;
    boundHandle = null;
    if (endedSession) {
      endedSession.removeEventListener?.('end', handleSessionEnd);
    }
    if (handle) {
      const xr = getXrManager(handle);
      if (xr) {
        // three.js restores the flat animation loop and the pre-session
        // drawing buffer size from inside its own `end` handler; clearing
        // `enabled` and the session reference afterwards puts the renderer
        // back in exactly the state it had before `enter()`. Without this
        // the next flat frame still renders through the XR path and the
        // canvas stays black.
        xr.enabled = false;
        try {
          void xr.setSession(null);
        } catch (error) {
          console.warn('Clearing the WebXR session failed.', error);
        }
      }
      // Re-apply pixel ratio / render scale / viewport, which the XR
      // session overrode for the headset's framebuffer.
      handle.applySettings();
    }
    emit();
  };

  const endSession = async () => {
    const current = session;
    if (!current) {
      return;
    }
    try {
      await current.end();
    } catch (error) {
      console.warn('Ending the WebXR session failed.', error);
    }
    // Browsers fire `end` asynchronously; drive the teardown ourselves if
    // the session object never delivered it (mocked or already-dead
    // sessions), and rely on `session` being nulled to keep it idempotent.
    if (session === current) {
      handleSessionEnd();
    }
  };

  const unsubscribeLifecycle = subscribeToLifecycle((event) => {
    if (!session || event.handle !== boundHandle) {
      return;
    }
    // Design decision: tear the session down rather than block the swap.
    // A swap only happens on WebGL context loss, WebGPU device loss, or
    // teardown — states where the GPU resources the session is presenting
    // from are already gone, so there is nothing to block *for*. Blocking
    // would strand the user inside a frozen headset view with no way back;
    // ending the session drops them to the flat canvas, which the recreate
    // path then repairs on its own.
    console.warn(
      `Ending the WebXR session: the renderer was ${event.type} underneath it.`,
    );
    void endSession();
  });

  /**
   * Must be called directly from a user gesture handler: WebXR rejects
   * `requestSession('immersive-vr')` without transient user activation.
   */
  const enter = async (): Promise<WebXrEnterResult> => {
    if (disposed) {
      return { ok: false, reason: 'unsupported' };
    }
    if (session || pending) {
      return { ok: false, reason: 'already-active' };
    }

    const xrSystem = getXrSystem(navigatorLike);
    if (!xrSystem || typeof xrSystem.requestSession !== 'function') {
      return { ok: false, reason: 'unsupported' };
    }

    const handle = getHandle();
    if (!handle) {
      return { ok: false, reason: 'no-renderer' };
    }
    if (handle.backend !== 'webgl') {
      // The render service drives its own requestAnimationFrame loop for
      // WebGPU (see `driveAnimationLoop` in render-service) and never hands
      // the callback to the renderer, so `renderer.xr` would never be asked
      // for an XR frame. WebGL uses the pass-through path, where three.js's
      // WebXRManager owns scheduling — the only mode this can work in today.
      return { ok: false, reason: 'unsupported-backend' };
    }
    const xr = getXrManager(handle);
    if (!xr) {
      return { ok: false, reason: 'unsupported-backend' };
    }

    pending = true;
    emit();
    let requested: XrSessionLike;
    try {
      requested = await xrSystem.requestSession(IMMERSIVE_VR_MODE, {
        optionalFeatures: ['local-floor'],
      });
    } catch (error) {
      pending = false;
      emit();
      return { ok: false, reason: 'request-failed', error };
    }

    // The renderer can be swapped or released during the await above.
    if (disposed || getHandle() !== handle) {
      pending = false;
      void requested.end();
      emit();
      return { ok: false, reason: 'renderer-changed' };
    }

    try {
      xr.enabled = true;
      await xr.setSession(requested);
    } catch (error) {
      xr.enabled = false;
      pending = false;
      void requested.end();
      emit();
      return { ok: false, reason: 'request-failed', error };
    }

    session = requested;
    boundHandle = handle;
    pending = false;
    requested.addEventListener('end', handleSessionEnd);
    emit();
    return { ok: true };
  };

  return {
    enter,
    exit: endSession,
    getState: state,
    isActive: () => session !== null,
    subscribe: (subscriber: (state: WebXrState) => void) => {
      subscribers.add(subscriber);
      subscriber(state());
      return () => subscribers.delete(subscriber);
    },
    dispose: () => {
      disposed = true;
      unsubscribeLifecycle();
      void endSession();
      subscribers.clear();
    },
  };
}

export type WebXrSessionController = ReturnType<
  typeof createWebXrSessionController
>;
