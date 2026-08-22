/**
 * Microphone capture constraints, shared by the engine and the shell.
 *
 * Deliberately free of any `three` import: the shell needs these while
 * deciding whether to start audio at all, and pulling the audio engine (and
 * with it three.js) into that path would drag the renderer into the initial
 * bundle. Three copies of the constraint set had drifted apart before this
 * module owned them — the shell's copy was missing `channelCount`, so the
 * multichannel cue-bus selection never had extra channels to select from.
 */

/** Ask for more than stereo so an audio interface's extra channels survive.
 * `ideal` (never `exact`) — the browser clamps to whatever the device
 * actually offers, and a hard constraint would fail outright on a laptop
 * mic. */
const MAX_REQUESTED_INPUT_CHANNELS = 8;

/**
 * The browser's voice-call DSP, all of which must be off for a line feed.
 * Automatic gain control is the damaging one: it normalises exactly the
 * dynamics the visuals are supposed to react to, so a mix flattens into a
 * constant-energy wash and every beat-driven preset stops moving with the
 * music. Noise suppression and echo cancellation eat the low end and duck
 * the signal against room sound.
 */
const INPUT_PROCESSING_CONSTRAINTS = [
  'echoCancellation',
  'noiseSuppression',
  'autoGainControl',
] as const;

export type InputProcessingFlag = (typeof INPUT_PROCESSING_CONSTRAINTS)[number];

export const DEFAULT_MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
    channelCount: { ideal: MAX_REQUESTED_INPUT_CHANNELS },
  },
};

/**
 * The same request, but as a hard constraint.
 *
 * `ideal: false` is a preference the browser is free to ignore, and Chrome
 * on some platforms does exactly that for the default communications
 * device. Asking with `exact` makes the browser either honour it or throw
 * `OverconstrainedError`, which is recoverable — silently-applied AGC is
 * not, because nothing downstream can tell a compressed mix from a quiet
 * one.
 */
export const EXACT_MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: { exact: false },
    noiseSuppression: { exact: false },
    autoGainControl: { exact: false },
    channelCount: { ideal: MAX_REQUESTED_INPUT_CHANNELS },
  },
};

/** Merges a device selection into either constraint set. */
export function buildMicrophoneConstraints(options: {
  deviceId?: string;
  exactProcessing?: boolean;
}): MediaStreamConstraints {
  const base = options.exactProcessing
    ? EXACT_MICROPHONE_CONSTRAINTS
    : DEFAULT_MICROPHONE_CONSTRAINTS;
  const audio = typeof base.audio === 'object' ? base.audio : {};
  return {
    audio: {
      ...audio,
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
    },
  };
}

/**
 * Which processors the browser actually left ON, read back from the granted
 * track rather than from what we asked for.
 */
export function describeInputProcessing(
  stream: MediaStream | null | undefined,
): InputProcessingFlag[] {
  const track = stream?.getAudioTracks?.()[0];
  const settings = track?.getSettings?.() as
    | Record<string, unknown>
    | undefined;
  if (!settings) return [];
  return INPUT_PROCESSING_CONSTRAINTS.filter((flag) => settings[flag] === true);
}

/** Human-readable warning when a feed is being processed, or null. */
export function describeInputProcessingWarning(
  stream: MediaStream | null | undefined,
): string | null {
  const active = describeInputProcessing(stream);
  if (active.length === 0) return null;
  const labels: Record<InputProcessingFlag, string> = {
    autoGainControl: 'automatic gain control',
    noiseSuppression: 'noise suppression',
    echoCancellation: 'echo cancellation',
  };
  const list = active.map((flag) => labels[flag]).join(' and ');
  return `This input still has ${list} on, which flattens the dynamics the visuals react to. Turn it off for the device in your OS sound settings, or use a line/loopback input.`;
}

/**
 * Opens a microphone stream with processing hard-off where the platform
 * allows it, falling back to the soft request rather than failing outright.
 */
export async function acquireMicrophoneStream(options: {
  deviceId?: string;
}): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) {
    throw new Error('Microphone capture is not available in this browser.');
  }
  try {
    return await media.getUserMedia(
      buildMicrophoneConstraints({ ...options, exactProcessing: true }),
    );
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    // Only an unsatisfiable constraint is worth retrying softer. A denial or
    // a missing device means the same thing on the second attempt, and
    // re-prompting for it is worse than reporting it.
    if (name !== 'OverconstrainedError' && name !== 'NotSupportedError') {
      throw error;
    }
    return media.getUserMedia(
      buildMicrophoneConstraints({ ...options, exactProcessing: false }),
    );
  }
}
