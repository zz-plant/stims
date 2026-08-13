import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { RendererLifecycleEvent } from '../../src/js/core/services/render-service.ts';
import { importFresh } from '../test-helpers.ts';

type RenderService =
  typeof import('../../src/js/core/services/render-service.ts');

function createFakeRenderer() {
  return {
    xr: { enabled: false, setSession: mock(async () => {}) },
    domElement: document.createElement('canvas'),
    setAnimationLoop: mock(() => {}),
    setPixelRatio: mock(() => {}),
    setSize: mock(() => {}),
    getPixelRatio: () => 1,
    getSize: (target: { width: number; height: number }) => {
      target.width = 640;
      target.height = 480;
      return target;
    },
    dispose: mock(() => {}),
  };
}

async function loadService(): Promise<RenderService> {
  return importFresh<RenderService>(
    '../../src/js/core/services/render-service.ts',
  );
}

describe('render-service renderer lifecycle seam (used by WebXR)', () => {
  afterEach(async () => {
    const service = await loadService();
    service.resetRendererPool({ dispose: true });
    mock.restore();
  });

  test('getActiveRendererHandle exposes the checked-out stage renderer', async () => {
    const service = await loadService();
    const renderer = createFakeRenderer();

    expect(service.getActiveRendererHandle()).toBeNull();

    const handle = await service.requestRenderer({
      canvas: document.createElement('canvas'),
      initRendererImpl: (async () => ({
        renderer,
        backend: 'webgl',
        device: null,
      })) as never,
    });

    expect(service.getActiveRendererHandle()).toBe(handle);

    handle.release();
    // A released renderer stays pooled but is no longer the active one, so
    // an XR session can never bind to a parked renderer.
    expect(service.getActiveRendererHandle()).toBeNull();
  });

  test('releasing a renderer notifies lifecycle subscribers', async () => {
    const service = await loadService();
    const events: RendererLifecycleEvent[] = [];
    const unsubscribe = service.subscribeToRendererLifecycle((event) =>
      events.push(event),
    );

    const handle = await service.requestRenderer({
      canvas: document.createElement('canvas'),
      initRendererImpl: (async () => ({
        renderer: createFakeRenderer(),
        backend: 'webgl',
        device: null,
      })) as never,
    });

    expect(events).toHaveLength(0);

    handle.release();

    expect(events.map((event) => event.type)).toEqual(['released']);
    expect(events[0]?.handle).toBe(handle);

    unsubscribe();
  });

  test('disposing a renderer notifies lifecycle subscribers', async () => {
    const service = await loadService();
    const events: RendererLifecycleEvent[] = [];
    const unsubscribe = service.subscribeToRendererLifecycle((event) =>
      events.push(event),
    );

    const handle = await service.requestRenderer({
      canvas: document.createElement('canvas'),
      initRendererImpl: (async () => ({
        renderer: createFakeRenderer(),
        backend: 'webgl',
        device: null,
      })) as never,
    });

    handle.renderer.dispose();

    expect(events.map((event) => event.type)).toContain('disposed');

    unsubscribe();
  });
});
