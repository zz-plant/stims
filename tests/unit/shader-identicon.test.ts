import { afterEach, describe, expect, mock, test } from 'bun:test';
import { importFresh } from '../test-helpers.ts';

/**
 * Browsers cap concurrent WebGL contexts per page (~8-16) and evict the
 * oldest, so identicons must never hold one context each — an identicon-heavy
 * panel would evict the main visualizer's context. All instances draw through
 * one shared WebGL context and blit into their own 2D canvas.
 */

type FakeCanvas = {
  width: number;
  height: number;
  getContext: (type: string) => unknown;
};

function makeFakeGl() {
  return {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    COLOR_BUFFER_BIT: 16384,
    TRIANGLES: 4,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    useProgram: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    getUniformLocation: () => ({}),
    viewport: mock(),
    clearColor: () => {},
    clear: () => {},
    uniform1f: () => {},
    uniform2f: () => {},
    drawArrays: mock(),
    isContextLost: () => false,
  };
}

describe('ShaderIdenticonRenderer shared context', () => {
  const originalCreateElement = document.createElement.bind(document);

  afterEach(() => {
    mock.restore();
    document.createElement = originalCreateElement;
  });

  test('many renderer instances acquire at most one WebGL context', async () => {
    const fakeGl = makeFakeGl();
    let webglAcquisitions = 0;

    const makeInstanceCanvas = (): {
      canvas: FakeCanvas;
      ctx2d: {
        clearRect: ReturnType<typeof mock>;
        drawImage: ReturnType<typeof mock>;
      };
    } => {
      const ctx2d = { clearRect: mock(), drawImage: mock() };
      const canvas: FakeCanvas = {
        width: 96,
        height: 96,
        getContext: (type: string) => {
          if (type === 'webgl') {
            webglAcquisitions += 1;
            return fakeGl;
          }
          if (type === '2d') return ctx2d;
          return null;
        },
      };
      return { canvas, ctx2d };
    };

    // The shared renderer builds its offscreen canvas via createElement.
    const sharedCanvas = makeInstanceCanvas().canvas;
    document.createElement = ((tag: string) => {
      if (tag === 'canvas') return sharedCanvas as unknown as HTMLCanvasElement;
      return originalCreateElement(tag);
    }) as typeof document.createElement;

    const { ShaderIdenticonRenderer } = await importFresh<
      typeof import('../../src/js/ui/shader-identicon.ts')
    >('../../src/js/ui/shader-identicon.ts');

    const instances = Array.from({ length: 8 }, () => makeInstanceCanvas());
    const renderers = instances.map(
      ({ canvas }) =>
        new ShaderIdenticonRenderer(canvas as unknown as HTMLCanvasElement),
    );

    for (const [i, renderer] of renderers.entries()) {
      renderer.render({
        seed: `seed-${i}`,
        audioPeak: 0,
        mode: i % 2 ? '3d-polyhedron' : '2d-sdf',
        timeSec: 1.5,
      });
    }

    // One shared context total — not one per identicon.
    expect(webglAcquisitions).toBe(1);
    // Every instance drew: a GL draw call each, blitted into its own 2D canvas.
    expect(fakeGl.drawArrays.mock.calls.length).toBe(8);
    for (const { ctx2d } of instances) {
      expect(ctx2d.drawImage.mock.calls.length).toBe(1);
    }
  });

  test('render is a safe no-op when WebGL is unavailable', async () => {
    document.createElement = ((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => null,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    }) as typeof document.createElement;

    const { ShaderIdenticonRenderer } = await importFresh<
      typeof import('../../src/js/ui/shader-identicon.ts')
    >('../../src/js/ui/shader-identicon.ts');

    const ctx2d = { clearRect: mock(), drawImage: mock() };
    const canvas = {
      width: 96,
      height: 96,
      getContext: (type: string) => (type === '2d' ? ctx2d : null),
    };

    const renderer = new ShaderIdenticonRenderer(
      canvas as unknown as HTMLCanvasElement,
    );
    // Must not throw, must not blit garbage.
    renderer.render({ seed: 'x', audioPeak: 0, timeSec: 0 });
    expect(ctx2d.drawImage.mock.calls.length).toBe(0);
  });
});
