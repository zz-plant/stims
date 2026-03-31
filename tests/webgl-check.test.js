import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const freshImport = async () =>
  import(`../assets/js/core/webgl-check.ts?ts=${Date.now()}-${Math.random()}`);

const originalGpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');

describe('ensureWebGL overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mock.restore();
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    mock.restore();
    if (originalGpu) {
      Object.defineProperty(navigator, 'gpu', originalGpu);
    } else {
      delete navigator.gpu;
    }
  });

  test('shows capability overlay when neither WebGL nor WebGPU are available', async () => {
    const { ensureWebGL, setRenderingSupportResolverForTests } =
      await freshImport();
    try {
      setRenderingSupportResolverForTests(() => ({
        hasWebGPU: false,
        hasWebGL: false,
      }));

      const supported = ensureWebGL({ previewLabel: 'Static check' });

      expect(supported).toBe(false);
      const overlay = document.getElementById('rendering-capability-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay?.textContent).toContain('WebGL');
      expect(
        overlay?.querySelector('.rendering-overlay__preview-pane'),
      ).not.toBeNull();
    } finally {
      setRenderingSupportResolverForTests(null);
    }
  });
});
