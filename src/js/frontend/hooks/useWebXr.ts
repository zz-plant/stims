import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createWebXrSessionController,
  isImmersiveVrSupported,
  type WebXrSessionController,
} from '../../core/services/webxr-service.ts';

/**
 * Gates the "Enter VR" affordance on a real `immersive-vr` device and owns
 * the session controller's lifetime. `supported` starts false and only ever
 * flips true after `navigator.xr.isSessionSupported` resolves true, so the
 * button never renders on hardware that cannot use it.
 */
export function useWebXr() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const controllerRef = useRef<WebXrSessionController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isImmersiveVrSupported().then((isSupported) => {
      if (!cancelled) {
        setSupported(isSupported);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!supported) {
      return;
    }
    const controller = createWebXrSessionController();
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe((state) =>
      setActive(state.active),
    );
    return () => {
      unsubscribe();
      controllerRef.current = null;
      controller.dispose();
    };
  }, [supported]);

  // Called straight from the click handler: WebXR requires transient user
  // activation, so this must not be deferred behind an effect or a promise
  // the caller awaits first.
  const toggle = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    if (controller.isActive()) {
      void controller.exit();
      return;
    }
    void controller.enter().then((result) => {
      if (!result.ok && result.reason !== 'already-active') {
        console.warn(`Could not enter VR (${result.reason}).`, result.error);
      }
    });
  }, []);

  return { supported, active, toggle };
}
