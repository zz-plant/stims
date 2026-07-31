/**
 * WebXR Spatial Audio Stage Session Launcher & Manager
 * Provides immersive VR/AR session support for spatial 3D audio visualizer stages.
 */

export interface WebXrStageCapabilities {
  supported: boolean;
  vrSupported: boolean;
  arSupported: boolean;
}

export class WebXrStageSessionService {
  private activeSession: XRSession | null = null;
  private listeners: Set<(active: boolean) => void> = new Set();

  public async checkCapabilities(): Promise<WebXrStageCapabilities> {
    if (
      typeof navigator === 'undefined' ||
      !('xr' in navigator) ||
      !navigator.xr
    ) {
      return { supported: false, vrSupported: false, arSupported: false };
    }

    try {
      const vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
      const arSupported = await navigator.xr
        .isSessionSupported('immersive-ar')
        .catch(() => false);

      return {
        supported: vrSupported || arSupported,
        vrSupported,
        arSupported,
      };
    } catch {
      return { supported: false, vrSupported: false, arSupported: false };
    }
  }

  public async requestSession(
    mode: 'immersive-vr' | 'immersive-ar' = 'immersive-vr',
  ): Promise<XRSession | null> {
    if (
      typeof navigator === 'undefined' ||
      !('xr' in navigator) ||
      !navigator.xr
    ) {
      return null;
    }

    try {
      const session = await navigator.xr.requestSession(mode, {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });

      this.activeSession = session;
      this.notifyListeners(true);

      session.addEventListener('end', () => {
        this.activeSession = null;
        this.notifyListeners(false);
      });

      return session;
    } catch {
      return null;
    }
  }

  public endSession(): Promise<void> | void {
    if (this.activeSession) {
      return this.activeSession.end();
    }
  }

  public isSessionActive(): boolean {
    return this.activeSession !== null;
  }

  public onSessionChange(callback: (active: boolean) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(active: boolean): void {
    for (const listener of this.listeners) {
      listener(active);
    }
  }
}

export const webXrStageService = new WebXrStageSessionService();
