import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { importFresh, replaceProperty } from './test-helpers.ts';

let restoreGpu = () => {};

const setTestUrl = () => {
  window.happyDOM?.setURL?.('https://example.com/milkdrop/');
};

describe('ensureWebGL overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mock.restore();
    restoreGpu = replaceProperty(navigator, 'gpu', undefined);
    setTestUrl();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    mock.restore();
    restoreGpu();
    restoreGpu = () => {};
    setTestUrl();
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

  test('syncs the modal query state and restores focus when support returns', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Retry visuals';
    document.body.appendChild(trigger);
    trigger.focus();

    const { ensureWebGL, setRenderingSupportResolverForTests } =
      await importFresh('../assets/js/core/webgl-check.ts');

    try {
      setRenderingSupportResolverForTests(() => ({
        hasWebGPU: false,
        hasWebGL: false,
      }));

      expect(ensureWebGL()).toBe(false);
      expect(new URL(window.location.href).searchParams.get('modal')).toBe(
        'rendering-capability',
      );

      setRenderingSupportResolverForTests(() => ({
        hasWebGPU: false,
        hasWebGL: true,
      }));

      expect(ensureWebGL()).toBe(true);
      expect(
        new URL(window.location.href).searchParams.get('modal'),
      ).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      setRenderingSupportResolverForTests(null);
    }
  });
});
