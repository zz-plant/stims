/**
 * Shared behavior bodies for workspace actions.
 *
 * Three surfaces expose the same verbs — the stage dock's ☰ menu, the ⌘K
 * command palette, and window.__stims_agent.run — and while they shared ids
 * (guarded by scripts/check-agent-action-ids.ts) they did not share
 * implementations. That drifted in practice: the menu's "Record video"
 * auto-started recording with the remembered format while the palette's
 * "Record video" only opened the form. Each behavior here exists once;
 * surfaces keep their own presentation (labels, icons, focus handling) and
 * call in.
 */

import type { AudioSource, PanelState } from './contracts.ts';
import {
  leaveSyncSession,
  setSyncUrlParam,
  startOrCopyWatchParty,
} from './sync-session.ts';

export interface PanelSurface {
  updatePanel: (panel: PanelState) => void;
  routePanel: () => PanelState;
}

/** Toggle semantics shared by every panel verb: same panel closes, any
 * other opens. The palette used plain-open while the menu toggled — now
 * both toggle. */
export function togglePanel(surface: PanelSurface, panel: PanelState): void {
  surface.updatePanel(surface.routePanel() === panel ? null : panel);
}

/**
 * Record video: repeat use starts recording immediately with the
 * remembered format (CapturePanel's mount effect consumes the flag);
 * first-ever use (no stored format) just opens the form.
 */
export function openRecordPanel(surface: PanelSurface): void {
  if (surface.routePanel() === 'capture') {
    surface.updatePanel(null);
    return;
  }
  try {
    if (localStorage.getItem('stims:capture-format')) {
      sessionStorage.setItem('stims:capture-autostart', '1');
    }
  } catch {
    // Storage is unavailable (private mode, quota): the capture panel still
    // opens, it just will not auto-start with the remembered format.
  }
  surface.updatePanel('capture');
}

export interface TransitionEngine {
  setTransitionMode: (mode: 'blend' | 'cut') => void;
  setBlendDuration: (seconds: number) => void;
}

export function describeTransition(
  mode: 'blend' | 'cut',
  seconds: number,
): string {
  return mode === 'cut' ? 'Instant cut' : `Blend ${seconds}s`;
}

export function setTransition(
  engine: TransitionEngine,
  announce: (message: string) => void,
  mode: 'blend' | 'cut',
  seconds: number,
): void {
  engine.setTransitionMode(mode);
  if (mode === 'blend') {
    engine.setBlendDuration(seconds);
  }
  announce(`Transition: ${describeTransition(mode, seconds)}`);
}

export function startAudioSource(
  engine: {
    handleAudioStart: (source: AudioSource) => Promise<void> | void;
  },
  source: 'demo' | 'microphone' | 'tab',
): void {
  void engine.handleAudioStart(source);
}

export function toggleAutoplay(
  engine: { setAutoplay: (enabled: boolean) => void },
  announce: (message: string) => void,
  currentlyEnabled: boolean,
): void {
  const next = !currentlyEnabled;
  engine.setAutoplay(next);
  announce(next ? 'Autoplay on.' : 'Autoplay off.');
}

/** One action: create the room (unless already hosting) and put the invite
 * link on the clipboard. Re-exported so both surfaces import from here. */
export function startOrCopyWatchPartyAction(
  announce: (message: string) => void,
): void {
  void startOrCopyWatchParty(announce);
}

export function endWatchParty(announce: (message: string) => void): void {
  leaveSyncSession();
  setSyncUrlParam(null);
  announce('Watch party ended — viewers keep local control.');
}

/** Point a camera at the preset's video sampler, or turn it back off. */
export function toggleCameraAction(announce: (message: string) => void): void {
  void (async () => {
    const {
      toggleCameraVideoSource,
      isCameraVideoSupported,
      CameraVideoError,
    } = await import('../core/services/camera-video-source.ts');
    if (!isCameraVideoSupported()) {
      announce('This browser cannot open a camera.');
      return;
    }
    try {
      const on = await toggleCameraVideoSource();
      announce(
        on
          ? 'Camera on — presets that sample video now see it.'
          : 'Camera off.',
      );
    } catch (error) {
      announce(
        error instanceof CameraVideoError
          ? error.message
          : 'Could not start the camera.',
      );
    }
  })();
}

/**
 * Put the show on a projector, second monitor, or Chromecast. The external
 * display loads this tab's watch-party link, so it renders the show itself
 * and follows every preset change — no video is streamed to it.
 */
export function presentToExternalDisplayAction(
  announce: (message: string) => void,
): void {
  void (async () => {
    const [display, { ensureHostRoom }] = await Promise.all([
      import('../core/services/external-display-service.ts'),
      import('./sync-session.ts'),
    ]);
    if (display.getExternalDisplayState().mode !== null) {
      display.stopExternalDisplay();
      announce('External display disconnected.');
      return;
    }
    if (!display.isCastSupported() && !display.isSecondScreenSupported()) {
      announce('This browser cannot drive a second screen or cast.');
      return;
    }
    const hosted = await ensureHostRoom();
    if (!hosted) {
      announce('Could not prepare the link for the external display.');
      return;
    }
    try {
      await display.presentToExternalDisplay(hosted.url);
      const state = display.getExternalDisplayState();
      if (state.mode === null) return; // Picker dismissed.
      announce(
        state.mode === 'window'
          ? `Showing on ${state.target ?? 'the second screen'}.`
          : 'Casting — the receiver follows every preset you play.',
      );
    } catch {
      announce(
        display.getExternalDisplayState().error ??
          'Could not reach an external display.',
      );
    }
  })();
}
