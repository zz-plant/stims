/**
 * The tempo verbs: tap, hand the tempo back to the music, and nudge the beat
 * grid. Shared by the palette, the K / Shift+K keys and anything a MIDI pad is
 * learned to, so all three say the same thing about what a tap did.
 *
 * What a tapped tempo changes is narrow, and the messages say only that:
 * auto-advance waits for a bar line before it switches, and with a tempo set
 * the bar lines are the performer's. Presets themselves still react to the
 * audio; no preset reads a tempo.
 */
import {
  clearManualTempo,
  getManualTempo,
  nudgeManualTempo,
  type TapTempoResult,
  tapTempo,
} from '../core/manual-tempo.ts';

/** One nudge press: about a sixteenth of a beat at 120 BPM. */
export const TEMPO_NUDGE_MS = 20;

export function describeTap(result: TapTempoResult): string | null {
  switch (result.kind) {
    case 'counting':
      return 'Tap again on the next beat to set the tempo.';
    case 'tempo':
      return `${Math.round(result.bpm)} BPM from your taps. Auto-advance now switches on your downbeat.`;
    case 'resync':
      return `Downbeat moved to your tap, still ${Math.round(result.bpm)} BPM.`;
    case 'clock-locked':
      return `Following MIDI clock at ${Math.round(result.bpm)} BPM. Stop the clock to tap a tempo.`;
    case 'ignored':
      // A key repeat or a bounced pad. Saying anything would bury the
      // message the real tap just produced.
      return null;
  }
}

export function tapTempoAction(
  announce: (message: string) => void,
  at?: number,
): TapTempoResult {
  const result = tapTempo(at);
  const message = describeTap(result);
  if (message) announce(message);
  return result;
}

export function followMusicTempoAction(
  announce: (message: string) => void,
): void {
  if (getManualTempo()?.source === 'midi-clock') {
    announce('MIDI clock sets the tempo while it runs. Stop the clock first.');
    return;
  }
  announce(
    clearManualTempo()
      ? 'Tempo follows the music again.'
      : 'Tempo already follows the music.',
  );
}

export function nudgeTempoAction(
  direction: 1 | -1,
  announce: (message: string) => void,
): void {
  const tempo = getManualTempo();
  if (tempo === null || tempo.source !== 'tap') {
    announce(
      tempo === null
        ? 'Tap a tempo first. Nudging moves a tapped beat grid.'
        : 'MIDI clock sets the beat grid while it runs.',
    );
    return;
  }
  nudgeManualTempo(direction * TEMPO_NUDGE_MS);
  announce(
    `Beat grid ${TEMPO_NUDGE_MS} ms ${direction > 0 ? 'later' : 'earlier'}.`,
  );
}
