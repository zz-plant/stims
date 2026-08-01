import { describe, expect, it } from 'bun:test';
import { WebXrStageSessionService } from '../../src/js/core/services/webxr-stage-session.ts';

describe('WebXR Spatial Audio Stage Session Service', () => {
  it('detects capability status correctly in environments without navigator.xr', async () => {
    const service = new WebXrStageSessionService();
    const caps = await service.checkCapabilities();

    expect(caps.supported).toBe(false);
    expect(caps.vrSupported).toBe(false);
    expect(caps.arSupported).toBe(false);
  });

  it('tracks session active status and change listeners', () => {
    const service = new WebXrStageSessionService();
    let changeState: boolean | null = null;

    service.onSessionChange((active) => {
      changeState = active;
    });

    expect(service.isSessionActive()).toBe(false);
    expect(changeState).toBeNull();
  });

  it('attaches an immersive session to the active renderer and restores it on end', async () => {
    const onEnd: Array<() => void> = [];
    const session = {
      addEventListener: (name: string, listener: () => void) => {
        if (name === 'end') onEnd.push(listener);
      },
      end: async () => {},
    };
    const navigatorRef = {
      xr: {
        isSessionSupported: async () => true,
        requestSession: async () => session,
      },
    };
    const renderer = {
      xr: {
        enabled: false,
        session: null as typeof session | null,
        setSession(nextSession: typeof session | null) {
          this.session = nextSession;
        },
      },
    };
    const service = new WebXrStageSessionService(navigatorRef);

    const activeSession = await service.startStage(renderer, 'immersive-vr');

    expect(activeSession).toBe(session);
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.xr.session).toBe(session);
    expect(service.isSessionActive()).toBe(true);

    expect(onEnd).toHaveLength(2);
    for (const listener of onEnd) listener();
    expect(renderer.xr.enabled).toBe(false);
    expect(renderer.xr.session).toBeNull();
    expect(service.isSessionActive()).toBe(false);
  });
});
