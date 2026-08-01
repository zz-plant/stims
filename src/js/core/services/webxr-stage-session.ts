/**
 * WebXR Spatial Audio Stage Session Launcher & Manager
 * Provides immersive VR/AR session support for spatial 3D audio visualizer stages.
 */

export interface WebXrStageCapabilities {
  supported: boolean;
  vrSupported: boolean;
  arSupported: boolean;
}

type WebXrSessionLike = {
  addEventListener: (type: 'end', listener: () => void) => void;
  end: () => Promise<void> | void;
};

type WebXrSystemLike = {
  isSessionSupported: (
    mode: 'immersive-vr' | 'immersive-ar',
  ) => Promise<boolean>;
  requestSession: (
    mode: 'immersive-vr' | 'immersive-ar',
    options?: { optionalFeatures?: string[] },
  ) => Promise<WebXrSessionLike>;
};

type WebXrNavigatorLike = {
  xr?: WebXrSystemLike;
};

export type WebXrRendererLike = {
  xr?: {
    enabled: boolean;
    setSession: (session: WebXrSessionLike | null) => Promise<void> | void;
  };
};

export class WebXrStageSessionService {
  private activeSession: WebXrSessionLike | null = null;
  private listeners: Set<(active: boolean) => void> = new Set();

  constructor(
    private readonly navigatorRef:
      | WebXrNavigatorLike
      | undefined = typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as WebXrNavigatorLike),
  ) {}

  public async checkCapabilities(): Promise<WebXrStageCapabilities> {
    if (!this.navigatorRef?.xr) {
      return { supported: false, vrSupported: false, arSupported: false };
    }

    try {
      const vrSupported =
        await this.navigatorRef.xr.isSessionSupported('immersive-vr');
      const arSupported = await this.navigatorRef.xr
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
  ): Promise<WebXrSessionLike | null> {
    if (!this.navigatorRef?.xr) {
      return null;
    }

    try {
      const session = await this.navigatorRef.xr.requestSession(mode, {
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

  public async startStage(
    renderer: WebXrRendererLike,
    mode: 'immersive-vr' | 'immersive-ar' = 'immersive-vr',
  ): Promise<WebXrSessionLike | null> {
    const xr = renderer.xr;
    if (!xr) return null;

    const session = await this.requestSession(mode);
    if (!session) return null;

    try {
      xr.enabled = true;
      await xr.setSession(session);
      session.addEventListener('end', () => {
        xr.enabled = false;
        void Promise.resolve(xr.setSession(null)).catch(() => {});
      });
      return session;
    } catch {
      xr.enabled = false;
      this.activeSession = null;
      await Promise.resolve(session.end()).catch(() => {});
      this.notifyListeners(false);
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
