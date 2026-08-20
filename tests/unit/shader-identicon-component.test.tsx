import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ShaderIdenticonRenderState } from '../../src/js/ui/shader-identicon.ts';
import { createToyContainer } from '../toy-test-helpers.ts';

class RendererMock {
  static instances: RendererMock[] = [];
  renders: ShaderIdenticonRenderState[] = [];
  destroyed = false;

  constructor(_canvas: HTMLCanvasElement) {
    RendererMock.instances.push(this);
  }

  render(state: ShaderIdenticonRenderState) {
    this.renders.push(state);
  }

  destroy() {
    this.destroyed = true;
  }
}

mock.module('../../src/js/ui/shader-identicon.ts', () => ({
  ShaderIdenticonRenderer: RendererMock,
}));

const { ShaderIdenticon } = await import(
  '../../src/js/frontend/ShaderIdenticon.tsx'
);

type ObserverCallback = IntersectionObserverCallback;
let observerCallback: ObserverCallback;
let observedCanvas: Element;
let callbacks: Map<number, FrameRequestCallback>;
let nextFrameId: number;
let reducedMotion = false;
let root: Root;
let disposeContainer: () => void;
let container: HTMLElement;

const setDocumentHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden,
  });
};

const intersect = (isIntersecting: boolean) => {
  act(() => {
    observerCallback(
      [{ target: observedCanvas, isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
};

const runFrame = (now = 100) => {
  const [id, callback] = callbacks.entries().next().value ?? [];
  if (id === undefined || !callback) throw new Error('No frame scheduled');
  callbacks.delete(id);
  act(() => callback(now));
};

describe('ShaderIdenticon component animation lifecycle', () => {
  beforeEach(() => {
    RendererMock.instances = [];
    callbacks = new Map();
    nextFrameId = 1;
    reducedMotion = false;
    setDocumentHidden(false);
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      callbacks.delete(id);
    }) as typeof cancelAnimationFrame;
    window.matchMedia = (() => ({
      matches: reducedMotion,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    })) as typeof window.matchMedia;
    globalThis.IntersectionObserver = class {
      constructor(callback: ObserverCallback) {
        observerCallback = callback;
      }
      observe(target: Element) {
        observedCanvas = target;
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = '';
      scrollMargin = '';
      thresholds = [];
    } as typeof IntersectionObserver;

    const toy = createToyContainer('shader-identicon-component');
    container = toy.container;
    disposeContainer = toy.dispose;
    root = createRoot(container);
    flushSync(() => {
      root.render(createElement(ShaderIdenticon, { seed: 'first' }));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    disposeContainer();
  });

  test('animates only while intersecting and leaves a static offscreen frame', () => {
    const renderer = RendererMock.instances[0];
    expect(callbacks.size).toBe(0);
    expect(renderer.renders.length).toBeGreaterThan(0);

    intersect(true);
    expect(callbacks.size).toBe(1);
    runFrame();
    expect(callbacks.size).toBe(1);

    intersect(false);
    expect(callbacks.size).toBe(0);
    expect(renderer.renders.at(-1)?.seed).toBe('first');
  });

  test('pauses while the document is hidden and resumes when shown', () => {
    intersect(true);
    setDocumentHidden(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(callbacks.size).toBe(0);

    setDocumentHidden(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(callbacks.size).toBe(1);
  });

  test('uses updated render props without replacing the renderer', () => {
    intersect(true);
    flushSync(() => {
      root.render(
        createElement(ShaderIdenticon, {
          seed: 'updated',
          mode: '3d-polyhedron',
          audioPeak: 0.8,
          multiBand: { bass: 0.1, mid: 0.2, treble: 0.3 },
        }),
      );
    });
    runFrame();

    expect(RendererMock.instances).toHaveLength(1);
    expect(RendererMock.instances[0].renders.at(-1)).toMatchObject({
      seed: 'updated',
      mode: '3d-polyhedron',
      audioPeak: 0.8,
      multiBand: { bass: 0.1, mid: 0.2, treble: 0.3 },
    });
  });

  test('renders statically when reduced motion is preferred', () => {
    act(() => root.unmount());
    reducedMotion = true;
    root = createRoot(container);
    flushSync(() => {
      root.render(createElement(ShaderIdenticon, { seed: 'reduced' }));
    });
    intersect(true);

    expect(callbacks.size).toBe(0);
    expect(RendererMock.instances.at(-1)?.renders.at(-1)?.seed).toBe('reduced');
  });

  test('cancels its frame and destroys its renderer on unmount', () => {
    intersect(true);
    const renderer = RendererMock.instances[0];
    act(() => root.unmount());

    expect(callbacks.size).toBe(0);
    expect(renderer.destroyed).toBe(true);
  });
});
