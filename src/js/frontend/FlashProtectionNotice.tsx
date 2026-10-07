/**
 * Says so on the stage while Reduce flashing is dimming it.
 *
 * The governor darkens the picture the moment content strobes. Without a
 * word on screen that reads as the renderer fading out, and a protection
 * nobody can see is one nobody can trust or switch off when it is wrong.
 * Rendered beside the stage canvas, not inside it, so it is not dimmed
 * along with what it describes.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  isFlashGovernorDimming,
  subscribeToFlashGovernorDimming,
} from '../core/services/stage-luminance.ts';
import { UiIcon } from './UiIcon.tsx';

/** A clamp shorter than this would make the notice blink, so it lingers. */
const LINGER_MS = 1500;

export function FlashProtectionNotice() {
  const dimming = useSyncExternalStore(
    subscribeToFlashGovernorDimming,
    isFlashGovernorDimming,
    () => false,
  );
  const [shown, setShown] = useState(dimming);
  useEffect(() => {
    if (dimming) {
      setShown(true);
      return;
    }
    const timer = window.setTimeout(() => setShown(false), LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [dimming]);

  if (!shown) return null;
  return (
    <p className="stims-shell__flash-notice" role="status">
      <UiIcon name="sun" className="stims-icon-slot stims-icon-slot--sm" />
      Dimming flashes
    </p>
  );
}
