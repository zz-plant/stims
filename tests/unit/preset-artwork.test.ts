import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import { PresetArtwork } from '../../src/js/frontend/PresetArtwork.tsx';
import type { MilkdropPresetRenderPreview } from '../../src/js/milkdrop/preset-preview.ts';
import { createToyContainer } from '../toy-test-helpers.ts';

const entry: PresetCatalogEntry = {
  id: 'glow',
  title: 'Glow Preset',
  author: 'Tester',
  tags: ['glow'],
};

describe('PresetArtwork', () => {
  test.each([
    'queued',
    'capturing',
  ] as const)('keeps the %s preview state free of fallback copy while loading', (status) => {
    const { container, dispose } = createToyContainer(
      `preset-artwork-${status}`,
    );
    const root = createRoot(container);
    const preview: MilkdropPresetRenderPreview = {
      presetId: entry.id,
      status,
      imageUrl: null,
      actualBackend: null,
      updatedAt: Date.now(),
      error: null,
      source: 'runtime-snapshot',
    };

    flushSync(() => {
      root.render(createElement(PresetArtwork, { entry, preview }));
    });

    expect(container.textContent).toBe('');
    expect(
      container.querySelector('.stims-shell__preset-art-fallback'),
    ).toBeNull();

    root.unmount();
    dispose();
  });

  test('renders the loading ghost while no preview result exists', () => {
    const { container, dispose } = createToyContainer('preset-artwork-loading');
    const root = createRoot(container);

    flushSync(() => {
      root.render(createElement(PresetArtwork, { entry, preview: null }));
    });

    expect(container.textContent).toBe('');
    expect(container.querySelector('.preset-artwork-ghost')).not.toBeNull();

    root.unmount();
    dispose();
  });

  test('keeps fallback artwork quiet when runtime preview capture is unavailable', () => {
    const { container, dispose } = createToyContainer('preset-artwork-root');
    const root = createRoot(container);
    const failedPreview: MilkdropPresetRenderPreview = {
      presetId: entry.id,
      status: 'failed',
      imageUrl: null,
      actualBackend: null,
      updatedAt: Date.now(),
      error: 'Preview canvas was not available.',
      source: 'runtime-snapshot',
    };

    flushSync(() => {
      root.render(
        createElement(PresetArtwork, { entry, preview: failedPreview }),
      );
    });

    expect(container.textContent).toContain('Bright pulse');
    expect(container.textContent).not.toContain('Preview failed');

    root.unmount();
    dispose();
  });

  test('renders a ready preview image without fallback copy', () => {
    const { container, dispose } = createToyContainer('preset-artwork-ready');
    const root = createRoot(container);
    const preview: MilkdropPresetRenderPreview = {
      presetId: entry.id,
      status: 'ready',
      imageUrl: 'data:image/png;base64,preview',
      actualBackend: 'webgl',
      updatedAt: Date.now(),
      error: null,
      source: 'runtime-snapshot',
    };

    flushSync(() => {
      root.render(createElement(PresetArtwork, { entry, preview }));
    });

    expect(container.textContent).toBe('');
    expect(
      container.querySelector<HTMLImageElement>(
        '.stims-shell__preset-preview-image',
      )?.src,
    ).toBe('data:image/png;base64,preview');
    expect(
      container.querySelector('.stims-shell__preset-art-fallback'),
    ).toBeNull();

    root.unmount();
    dispose();
  });
});
