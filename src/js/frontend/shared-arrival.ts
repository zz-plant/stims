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
  'This link was shared with a local audio file, which a link cannot carry. Playing demo audio: pick your own file from the audio control.';

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

/**
 * An arrival that is Stims's own reload into WebGL, not a shared link.
 *
 * Its `?audio=` is the visitor's own source, which the reload stopped. It is
 * offered back as Resume on the same preset — never as "Shared with you",
 * and never by auto-starting the demo over it — and the notice says why the
 * page reloaded, which nothing on screen did before.
 */
export type RendererFallbackArrival = {
  presetId: string;
  /** Null when no source can be offered: a file must be picked again, and there may have been no audio at all. */
  resumeSource: ResumableAudioSource | null;
  notice: string;
};

const RENDERER_FALLBACK_NOTICE =
  'This preset needs the WebGL renderer, so Stims reloaded the page.';

export function resolveRendererFallbackArrival(
  presetId: string,
  audio: string | null,
): RendererFallbackArrival {
  switch (audio) {
    case 'demo':
    case 'microphone':
    case 'tab':
    case 'youtube':
      return {
        presetId,
        resumeSource: audio,
        notice: `${RENDERER_FALLBACK_NOTICE} Press Resume to bring your audio back.`,
      };
    case 'file':
      return {
        presetId,
        resumeSource: null,
        notice: `${RENDERER_FALLBACK_NOTICE} Pick your audio file again to bring your audio back.`,
      };
    default:
      return { presetId, resumeSource: null, notice: RENDERER_FALLBACK_NOTICE };
  }
}
