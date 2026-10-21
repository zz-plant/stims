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
    return 'You shared a whole screen without audio. Re-share and check "Also share system audio", or pick a browser tab.';
  }
  if (surface === 'window') {
    return 'You shared an application window. Window shares carry no audio: re-share and pick a browser tab or share system audio.';
  }
  return fallbackMessage;
}

/**
 * Why the share picker was refused. `NotAllowedError` covers three causes
 * that need different answers: the visitor closed the picker, the page is
 * not allowed to capture at all (a Permissions Policy, e.g. an embed without
 * `allow="display-capture"`), or the OS refused (macOS screen-recording
 * permission; Chrome says "Permission denied by system"). Retrying fixes
 * only the first, so the other two are named when they can be detected and
 * the remaining case says what happened without guessing why.
 */
export function describeDisplayCaptureRefusal(error: unknown): string | null {
  if ((error as { name?: string } | null)?.name !== 'NotAllowedError') {
    return null;
  }
  type FeaturePolicy = { allowsFeature(feature: string): boolean };
  const doc = document as Document & {
    permissionsPolicy?: FeaturePolicy;
    featurePolicy?: FeaturePolicy;
  };
  const policy = doc.permissionsPolicy ?? doc.featurePolicy;
  if (policy && !policy.allowsFeature('display-capture')) {
    return 'Screen sharing is blocked on this page, which may be embedded in another site. Open Stims in its own tab, or use the microphone or a file.';
  }
  if (/\bsystem\b/i.test((error as Error).message ?? '')) {
    return 'Screen sharing is blocked by your system. On macOS, allow your browser under Privacy & Security → Screen & System Audio Recording, then try again.';
  }
  return 'No tab was shared, so nothing was captured. Pick a source to try again.';
}

/**
 * Chromium-only hints. `preferCurrentTab` collapses the share picker to a
 * single pre-selected entry for this tab, which is the difference between a
 * three-choice dialog and one click. Chrome rejects `selfBrowserSurface`
 * alongside it, so the two are mutually exclusive.
 *
 * For external/tab capture, `systemAudio: 'include'` allows Chromium browsers
 * on supported platforms (Windows, macOS, Linux) to offer system-wide audio
 * capture (e.g. Spotify desktop, media players) alongside tab audio.
 */
function buildDisplayConstraints(preferCurrentTab: boolean) {
  const base = { video: true, audio: true };
  if (preferCurrentTab) {
    return { ...base, preferCurrentTab: true, systemAudio: 'exclude' };
  }
  return { ...base, selfBrowserSurface: 'include', systemAudio: 'include' };
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
      const refusal = describeDisplayCaptureRefusal(error);
      throw refusal ? new Error(refusal) : error;
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
