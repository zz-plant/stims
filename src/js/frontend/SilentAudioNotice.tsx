import { useSyncExternalStore } from 'react';
import styles from '../../css/SilentAudioNotice.module.css';
import {
  isAudioAwaitingGesture,
  subscribeAudioGestureGate,
} from '../core/audio-gesture-gate.ts';
import { isMobileDevice } from '../utils/browser/device-detect.ts';

/**
 * Says out loud that the visuals are running and the sound is not.
 *
 * A `?preset=` arrival starts demo audio without waiting for a click, because
 * the visitor followed a link to that specific preset. Autoplay policy leaves
 * the AudioContext suspended when audio starts outside a gesture, so the page
 * plays a silent session that looks, from every other signal, like a working
 * one: `audioActive` is true, the stage animates, the analyser reads zero.
 * The fix (resume on the first pointerdown/touchstart/keydown) has always
 * been in `audio-handler.ts` — what was missing was telling the visitor which
 * click to make.
 *
 * Self-clearing: `audio-gesture-gate.ts` tracks the contexts' `statechange`,
 * so this disappears on the same interaction that starts the sound. There is
 * no dismiss control on purpose — a dismiss would leave the silence and take
 * away the explanation.
 */
export function useAudioAwaitingGesture(): boolean {
  return useSyncExternalStore(
    subscribeAudioGestureGate,
    isAudioAwaitingGesture,
    // Server/prerender: nothing has started audio yet, so nothing is waiting.
    () => false,
  );
}

export function SilentAudioNotice({ active }: { active: boolean }) {
  const awaitingGesture = useAudioAwaitingGesture();

  if (!active || !awaitingGesture) {
    return null;
  }

  return (
    <div className={styles.notice} role="status" aria-live="polite">
      <span>
        {isMobileDevice()
          ? 'Tap anywhere to turn the sound on — your browser holds audio until you do.'
          : 'Click anywhere to turn the sound on — your browser holds audio until you do.'}
      </span>
    </div>
  );
}
