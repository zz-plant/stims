import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { importFresh, replaceProperty } from './test-helpers.ts';

let restoreGpu = () => {};

describe('ensureWebGL overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mock.restore();
    restoreGpu = replaceProperty(navigator, 'gpu', undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    mock.restore();
    restoreGpu();
    restoreGpu = () => {};
  });

  test('shows capability overlay when neither WebGL nor WebGPU are available', async () => {
    const { ensureWebGL, setRenderingSupportResolverForTests } =
      await importFresh('../assets/js/core/webgl-check.ts');
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
