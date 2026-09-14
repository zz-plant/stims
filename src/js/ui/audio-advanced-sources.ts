/**
 * Display-capture audio acquisition — getDisplayMedia requests, share-surface
 * diagnosis, and audio-track handshakes for browser audio input.
 */

/**
 * What the user actually picked in the share dialog. Chrome reports this on
 * the video track; Firefox and Safari may omit it, in which case we cannot
 * tell a tab share from a screen share and fall back to generic guidance.
 */
type DisplaySurface = 'browser' | 'window' | 'monitor' | 'unknown';

function readDisplaySurface(stream: MediaStream): DisplaySurface {
  const settings = stream.getVideoTracks()[0]?.getSettings?.() as
    | { displaySurface?: string }
    | undefined;
  const surface = settings?.displaySurface;
  return surface === 'browser' || surface === 'window' || surface === 'monitor'
    ? surface
    : 'unknown';
}

/**
 * Explain the *specific* way the share went wrong. Silence after a successful
 * dialog is almost always one of two mistakes — sharing the wrong surface, or
 * missing the audio checkbox — and they need different fixes.
 */
function describeMissingAudio(
  surface: DisplaySurface,
  fallbackMessage: string,
): string {
  if (surface === 'monitor') {
    return 'You shared a whole screen, which carries no tab audio on most systems. Re-share and pick this browser tab instead.';
  }
  if (surface === 'window') {
    return 'You shared an application window. Window shares carry no audio — re-share and pick this browser tab instead.';
  }
  return fallbackMessage;
}

/**
 * Chromium-only hints. `preferCurrentTab` collapses the share picker to a
 * single pre-selected entry for this tab, which is the difference between a
 * three-choice dialog and one click. Chrome rejects `selfBrowserSurface`
 * alongside it, so the two are mutually exclusive.
 */
function buildDisplayConstraints(preferCurrentTab: boolean) {
  const base = { video: true, audio: true };
  if (preferCurrentTab) {
    return { ...base, preferCurrentTab: true, systemAudio: 'exclude' };
  }
  return { ...base, selfBrowserSurface: 'include', systemAudio: 'exclude' };
}

export async function captureDisplayAudioStream({
  unavailableMessage,
  missingAudioMessage = 'No audio track detected.',
  preferCurrentTab = false,
  onEnded,
}: {
  unavailableMessage: string;
  missingAudioMessage?: string;
  /** Pre-select this tab in the picker — only correct when we host the audio. */
  preferCurrentTab?: boolean;
  /** Fires when the user stops the share from the browser's own UI. */
  onEnded?: () => void;
}) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(unavailableMessage);
  }

  const request = (constraints: unknown) =>
    navigator.mediaDevices.getDisplayMedia(
      constraints as DisplayMediaStreamOptions,
    );

  let stream: MediaStream;
  try {
    stream = await request(buildDisplayConstraints(preferCurrentTab));
  } catch (error) {
    // A browser that rejects the hint dictionary still supports the plain
    // call. Only retry for shape errors — never for a denied permission,
    // which would reopen the dialog the user just dismissed.
    const name = error instanceof Error ? error.name : '';
    if (
      name !== 'TypeError' &&
      name !== 'InvalidStateError' &&
      name !== 'NotSupportedError'
    ) {
      throw error;
    }
    stream = await request({ video: true, audio: true });
  }

  const surface = readDisplaySurface(stream);
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(describeMissingAudio(surface, missingAudioMessage));
  }

  if (onEnded) {
    let notified = false;
    const notifyOnce = () => {
      if (notified) {
        return;
      }
      notified = true;
      onEnded();
    };
    // Either track can end first: the blue "stop sharing" pill ends both,
    // but switching the shared surface can end only the video track.
    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', notifyOnce);
    });
  }

  return stream;
}
