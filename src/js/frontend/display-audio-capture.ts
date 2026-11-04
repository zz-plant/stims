/**
 * Whether this browser can capture a tab, the system or YouTube with sound.
 */
import {
  getDeviceEnvironmentProfile,
  isMobileDevice,
} from '../utils/browser/device-detect.ts';

export function displayAudioCapture() {
  const hasDisplayCapture =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    !isMobileDevice();
  // Firefox and Safari open the share picker but never hand back an audio
  // track, so the visitor picked a tab, saw nothing react, and was told to
  // tick a "Share tab audio" box their browser does not have. Tab and
  // YouTube capture are offered only where a share can carry sound.
  const displayCaptureDropsAudio =
    hasDisplayCapture &&
    ['firefox', 'safari'].includes(getDeviceEnvironmentProfile().browserFamily);
  return {
    displayCaptureDropsAudio,
    canCaptureDisplayAudio: hasDisplayCapture && !displayCaptureDropsAudio,
  };
}
