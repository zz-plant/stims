/**
 * Paints the live stage utilities: the D blackout and the Y white flash.
 *
 * Reads the mode from core/services/stage-utilities.ts (the keyboard
 * listener writes it) and turns it into the two visual effects. The
 * blackout goes through the stage luminance service as its own channel —
 * the same owner that composes the flash governor and the visitor's
 * brightness ceiling — so the three can never fight over one style
 * property, and the cut composes with (rather than replacing) whatever
 * clamping is already in force. The flash is an overlay above the canvas:
 * no filter can make a picture brighter than its brightest pixel.
 *
 * The blackout notice is rendered beside the canvas, not inside the
 * filtered element, so it stays readable while the stage it describes is
 * black — the same reason FlashProtectionNotice sits outside the filter.
 */
import { type RefObject, useEffect, useSyncExternalStore } from 'react';
import styles from '../../css/StageUtilities.module.css';
import { setStageLuminanceChannel } from '../core/services/stage-luminance.ts';
import {
  releaseStageUtilities,
  stageUtilityMode,
  subscribeToStageUtilityMode,
} from '../core/services/stage-utilities.ts';
import {
  formatShortcutForDisplay,
  getShortcutKeys,
  readShortcutOverrides,
} from './shortcut-registry.ts';
import { UiIcon } from './UiIcon.tsx';

export function StageUtilitiesOverlay({
  stageRef,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const mode = useSyncExternalStore(
    subscribeToStageUtilityMode,
    stageUtilityMode,
    () => 'normal' as const,
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setStageLuminanceChannel(
      stage,
      'presentation',
      mode === 'blackout' ? 0 : 1,
    );
    // Mode changes and unmount both restore the channel: the luminance
    // service must never be left holding a blackout nobody asked for.
    return () => setStageLuminanceChannel(stage, 'presentation', 1);
  }, [mode, stageRef]);

  // Leaving the live session (this overlay unmounts with it) releases a
  // latched cut — the next visitor on this tab must not inherit a black
  // stage. The keyboard listener also releases on window blur; this covers
  // the path where the session ends while a key is held.
  useEffect(() => () => releaseStageUtilities(), []);

  if (mode === 'flash') {
    return (
      <div
        className={styles.overlay}
        data-stage-utility="flash"
        aria-hidden="true"
      />
    );
  }
  if (mode === 'blackout') {
    return (
      <p className={styles.notice} data-stage-utility="blackout" role="status">
        <UiIcon name="moon" className="stims-icon-slot stims-icon-slot--sm" />
        Blackout on
        <BlackoutReleaseHint />
      </p>
    );
  }
  return null;
}

function BlackoutReleaseHint() {
  const [key] = getShortcutKeys('blackout', readShortcutOverrides());
  if (!key) return null;
  return (
    <>
      {' — press '}
      <kbd>{formatShortcutForDisplay(key)}</kbd>
      {' to restore'}
    </>
  );
}
