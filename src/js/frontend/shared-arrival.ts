import type { ResumableAudioSource } from '../core/state/last-session-store.ts';

/**
 * What a `?preset=` arrival should do about the `audio=` its link carried.
 *
 * A copied link carries the sender's source, and every arrival used to start
 * demo audio regardless — so a link shared from a mic session played a
 * synthetic arpeggio at the recipient with nothing saying so. The sources
 * that need a gesture or a permission (mic, tab, YouTube) cannot be started
 * for them, but they can be the one button on the launch page, the same way
 * a returning visitor gets "Resume with your mic". A file cannot travel in a
 * link at all, so that arrival still starts the demo and says why.
 */
export type SharedArrival =
  | { kind: 'offer'; source: Exclude<ResumableAudioSource, 'demo'> }
  | { kind: 'demo'; notice: string | null };

export const SHARED_FILE_NOTICE =
  'This link was shared with a local audio file, which a link cannot carry. Playing demo audio — pick your own file from the audio control.';

export function resolveSharedArrival(audio: string | null): SharedArrival {
  switch (audio) {
    case 'microphone':
    case 'tab':
    case 'youtube':
      return { kind: 'offer', source: audio };
    case 'file':
      return { kind: 'demo', notice: SHARED_FILE_NOTICE };
    default:
      return { kind: 'demo', notice: null };
  }
}
