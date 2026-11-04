/**
 * Says so on the stage while Reduce flashing is dimming it.
 *
 * The governor darkens the picture the moment content strobes. Without a
 * word on screen that reads as the renderer fading out, and a protection
 * nobody can see is one nobody can trust or switch off when it is wrong.
 * Rendered beside the stage canvas, not inside it, so it is not dimmed
 * along with what it describes.
 *
 * It opens the setting rather than switching protection off: a stray tap on
 * a small target that appears on its own should not disable a safety feature.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import styles from '../../css/FlashProtectionNotice.module.css';
import {
  isFlashGovernorDimming,
  subscribeToFlashGovernorDimming,
} from '../core/services/stage-luminance.ts';
import { UiIcon } from './UiIcon.tsx';

/** A clamp shorter than this would make the notice blink, so it lingers. */
const LINGER_MS = 1500;

export function FlashProtectionNotice({
  onOpenSetting,
}: {
  onOpenSetting?: () => void;
}) {
  const dimming = useSyncExternalStore(
    subscribeToFlashGovernorDimming,
    isFlashGovernorDimming,
    () => false,
  );
  const [shown, setShown] = useState(dimming);
  // A button must not vanish under the pointer or the keyboard reaching it.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = dimming || hovered || focused;
  useEffect(() => {
    if (held) {
      setShown(true);
      return;
    }
    const timer = window.setTimeout(() => setShown(false), LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [held]);

  if (!shown) return null;
  return (
    <div className={styles.notice} role="status">
      <button
        type="button"
        className={styles.button}
        data-action="flash-notice-settings"
        onClick={onOpenSetting}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <UiIcon
          name="sun"
          className={`stims-icon-slot stims-icon-slot--sm ${styles.icon}`}
        />
        Dimming flashes
        <span className={styles.link}>Settings</span>
      </button>
    </div>
  );
}
