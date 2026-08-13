import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { RendererHandle } from '../../src/js/core/services/render-service.ts';
import {
  createWebXrSessionController,
  isImmersiveVrSupported,
  type XrSessionLike,
} from '../../src/js/core/services/webxr-service.ts';

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value,
  });
}

function createFakeSession() {
  const listeners = new Set<() => void>();
  const session = {
    ended: false,
    addEventListener: (_type: 'end', listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'end', listener: () => void) => {
      listeners.delete(listener);
    },
    end: mock(async () => {
      session.ended = true;
      listeners.forEach((listener) => listener());
    }),
  };
  return session;
}

function createFakeHandle(backend: 'webgl' | 'webgpu' = 'webgl') {
  const xr = {
    enabled: false,
    setSession: mock(async (_session: XrSessionLike | null) => {}),
  };
  const animationLoops: Array<(() => void) | null> = [];
  const handle = {
    backend,
    renderer: {
      xr,
      setAnimationLoop: (callback: (() => void) | null) => {
        animationLoops.push(callback);
      },
    },
    applySettings: mock(() => {}),
  } as unknown as RendererHandle;
  return { handle, xr, animationLoops };
}

describe('isImmersiveVrSupported', () => {
  test('returns false when navigator is absent entirely', async () => {
    setNavigator(undefined);
    await expect(isImmersiveVrSupported()).resolves.toBe(false);
  });

  test('returns false when navigator.xr is absent', async () => {
    setNavigator({});
    await expect(isImmersiveVrSupported()).resolves.toBe(false);
  });

  test('returns false when the device reports no immersive-vr support', async () => {
    setNavigator({ xr: { isSessionSupported: async () => false } });
    await expect(isImmersiveVrSupported()).resolves.toBe(false);
  });

  test('returns false without throwing when isSessionSupported rejects', async () => {
    setNavigator({
      xr: {
        isSessionSupported: async () => {
          throw new Error('insecure context');
        },
      },
    });
    await expect(isImmersiveVrSupported()).resolves.toBe(false);
  });

  test('returns true when immersive-vr is supported', async () => {
    const isSessionSupported = mock(async () => true);
    setNavigator({ xr: { isSessionSupported } });
    await expect(isImmersiveVrSupported()).resolves.toBe(true);
    expect(isSessionSupported).toHaveBeenCalledWith('immersive-vr');
  });
});

describe('WebXR session controller', () => {
  test('reports unsupported when navigator.xr is missing', async () => {
    setNavigator({});
    const { handle } = createFakeHandle();
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: () => () => true,
    });
    await expect(controller.enter()).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(controller.isActive()).toBe(false);
  });

  test('reports no-renderer when nothing is mounted', async () => {
    setNavigator({ xr: { requestSession: async () => createFakeSession() } });
    const controller = createWebXrSessionController({
      getHandle: () => null,
      subscribeToLifecycle: () => () => true,
    });
    await expect(controller.enter()).resolves.toEqual({
      ok: false,
      reason: 'no-renderer',
    });
  });

  test('refuses to enter on the WebGPU backend, which drives its own loop', async () => {
    const requestSession = mock(async () => createFakeSession());
    setNavigator({ xr: { requestSession } });
    const { handle } = createFakeHandle('webgpu');
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: () => () => true,
    });
    await expect(controller.enter()).resolves.toEqual({
      ok: false,
      reason: 'unsupported-backend',
    });
    expect(requestSession).not.toHaveBeenCalled();
  });

  test('surfaces a rejected requestSession without leaving state behind', async () => {
    const error = new Error('user gesture required');
    setNavigator({
      xr: {
        requestSession: async () => {
          throw error;
        },
      },
    });
    const { handle, xr } = createFakeHandle();
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: () => () => true,
    });
    const result = await controller.enter();
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'request-failed', error });
    expect(xr.enabled).toBe(false);
    expect(controller.isActive()).toBe(false);
  });

  test('attaches a granted session to the live renderer', async () => {
    const session = createFakeSession();
    const requestSession = mock(async () => session);
    setNavigator({ xr: { requestSession } });
    const { handle, xr } = createFakeHandle();
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: () => () => true,
    });

    await expect(controller.enter()).resolves.toEqual({ ok: true });
    expect(requestSession).toHaveBeenCalledWith('immersive-vr', {
      optionalFeatures: ['local-floor'],
    });
    expect(xr.enabled).toBe(true);
    expect(xr.setSession).toHaveBeenCalledWith(session);
    expect(controller.isActive()).toBe(true);
  });

  test('a second enter while active is a no-op', async () => {
    const requestSession = mock(async () => createFakeSession());
    setNavigator({ xr: { requestSession } });
    const { handle } = createFakeHandle();
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: () => () => true,
    });
    await controller.enter();
    await expect(controller.enter()).resolves.toEqual({
      ok: false,
      reason: 'already-active',
    });
    expect(requestSession).toHaveBeenCalledTimes(1);
  });

  test('sessionend restores the pre-XR renderer state', async () => {
    const session = createFakeSession();
    setNavigator({ xr: { requestSession: async () => session } });
    const { handle, xr } = createFakeHandle();
    const applySettings = handle.applySettings as unknown as ReturnType<
      typeof mock
    >;
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: () => () => true,
    });

    await controller.enter();
    applySettings.mockClear();

    await controller.exit();

    expect(session.ended).toBe(true);
    expect(xr.enabled).toBe(false);
    expect(xr.setSession).toHaveBeenLastCalledWith(null);
    // Pixel ratio / render scale / viewport are re-applied so the flat
    // canvas is not left at the headset's framebuffer size.
    expect(applySettings).toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  test('a browser-initiated sessionend tears down exactly once', async () => {
    const session = createFakeSession();
    setNavigator({ xr: { requestSession: async () => session } });
    const { handle, xr } = createFakeHandle();
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: () => () => true,
    });
    await controller.enter();

    // The headset was taken off: the browser ends the session for us.
    await session.end();
    expect(controller.isActive()).toBe(false);

    // Exiting again must not re-run teardown or throw.
    await controller.exit();
    expect(session.end).toHaveBeenCalledTimes(1);
    expect(xr.enabled).toBe(false);
  });

  test('a renderer swap mid-session ends the session', async () => {
    const session = createFakeSession();
    setNavigator({ xr: { requestSession: async () => session } });
    const { handle, xr } = createFakeHandle();
    const listeners: Array<(event: unknown) => void> = [];
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: ((listener: (event: unknown) => void) => {
        listeners.push(listener);
        return () => true;
      }) as never,
    });

    await controller.enter();
    expect(controller.isActive()).toBe(true);

    listeners.forEach((listener) => listener({ type: 'recreated', handle }));
    await Promise.resolve();
    await Promise.resolve();

    expect(session.ended).toBe(true);
    expect(controller.isActive()).toBe(false);
    expect(xr.enabled).toBe(false);
  });

  test('ignores lifecycle events for other renderers', async () => {
    const session = createFakeSession();
    setNavigator({ xr: { requestSession: async () => session } });
    const { handle } = createFakeHandle();
    const other = createFakeHandle().handle;
    const listeners: Array<(event: unknown) => void> = [];
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: ((listener: (event: unknown) => void) => {
        listeners.push(listener);
        return () => true;
      }) as never,
    });

    await controller.enter();
    listeners.forEach((listener) =>
      listener({ type: 'disposed', handle: other }),
    );
    await Promise.resolve();

    expect(controller.isActive()).toBe(true);
  });

  test('abandons a session granted after the renderer was swapped', async () => {
    const session = createFakeSession();
    setNavigator({ xr: { requestSession: async () => session } });
    const { handle, xr } = createFakeHandle();
    let current: RendererHandle | null = handle;
    const controller = createWebXrSessionController({
      getHandle: () => current,
      subscribeToLifecycle: () => () => true,
    });

    const entering = controller.enter();
    current = createFakeHandle().handle;

    await expect(entering).resolves.toEqual({
      ok: false,
      reason: 'renderer-changed',
    });
    expect(session.ended).toBe(true);
    expect(xr.setSession).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  test('dispose unsubscribes and ends any live session', async () => {
    const session = createFakeSession();
    setNavigator({ xr: { requestSession: async () => session } });
    const { handle } = createFakeHandle();
    const unsubscribe = mock(() => true);
    const controller = createWebXrSessionController({
      getHandle: () => handle,
      subscribeToLifecycle: () => unsubscribe,
    });

    await controller.enter();
    controller.dispose();
    await Promise.resolve();
    await Promise.resolve();

    expect(unsubscribe).toHaveBeenCalled();
    expect(session.ended).toBe(true);
  });
});
