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
});
