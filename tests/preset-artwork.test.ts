import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { PresetCatalogEntry } from '../assets/js/frontend/contracts.ts';
import { PresetArtwork } from '../assets/js/frontend/PresetArtwork.tsx';
import type { MilkdropPresetRenderPreview } from '../assets/js/milkdrop/preset-preview.ts';
import { createToyContainer } from './toy-test-helpers.ts';

const entry: PresetCatalogEntry = {
  id: 'glow',
  title: 'Glow Preset',
  author: 'Tester',
  tags: ['glow'],
};

describe('PresetArtwork', () => {
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
});
