import { describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import { PresetArtwork } from '../../src/js/frontend/PresetArtwork.tsx';
import type { MilkdropPresetRenderPreview } from '../../src/js/milkdrop/preset-preview.ts';
import { createToyContainer } from '../toy-test-helpers.ts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const entry: PresetCatalogEntry = {
  id: 'glow',
  title: 'Glow Preset',
  author: 'Tester',
  tags: ['glow'],
};

const STATIC_THUMB_PATTERN = /\/milkdrop-presets\/previews\/glow\.png$/;

function staticPreview(
  status: MilkdropPresetRenderPreview['status'],
): MilkdropPresetRenderPreview {
  return {
    presetId: entry.id,
    status,
    imageUrl: null,
    actualBackend: null,
    updatedAt: Date.now(),
    error: null,
    source: 'runtime-snapshot',
  };
}

function previewImageSrc(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLImageElement>(
    '.stims-shell__preset-preview-image',
  )?.src;
}

async function renderArtwork(
  container: HTMLElement,
  props: {
    entry: PresetCatalogEntry;
    preview?: MilkdropPresetRenderPreview | null;
  },
): Promise<{ dispose: () => void; root: ReturnType<typeof createRoot> }> {
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PresetArtwork, props));
    // Drain any image load/error dispatch the environment queues so React
    // never sees an unwrapped update after the act scope ends.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return {
    root,
    dispose: () => {
      act(() => root.unmount());
    },
  };
}

describe('PresetArtwork', () => {
  test.each(['queued', 'capturing'] as const)(
    'keeps the %s preview state on the static thumbnail',
    async (status) => {
      const { container, dispose } = createToyContainer(
        `preset-artwork-${status}`,
      );
      const rendered = await renderArtwork(container, {
        entry,
        preview: staticPreview(status),
      });

      expect(previewImageSrc(container)).toMatch(STATIC_THUMB_PATTERN);

      rendered.dispose();
      dispose();
    },
  );

  test('renders the static thumbnail while no preview result exists', async () => {
    const { container, dispose } = createToyContainer('preset-artwork-loading');
    const rendered = await renderArtwork(container, { entry, preview: null });

    expect(previewImageSrc(container)).toMatch(STATIC_THUMB_PATTERN);
    expect(container.querySelector('.preset-artwork-ghost')).toBeNull();

    rendered.dispose();
    dispose();
  });

  test('keeps the static thumbnail when runtime preview capture is unavailable', async () => {
    const { container, dispose } = createToyContainer('preset-artwork-root');
    const rendered = await renderArtwork(container, {
      entry,
      preview: {
        ...staticPreview('failed'),
        error: 'Preview canvas was not available.',
      },
    });

    expect(previewImageSrc(container)).toMatch(STATIC_THUMB_PATTERN);
    expect(container.textContent).not.toContain('Preview failed');

    rendered.dispose();
    dispose();
  });

  test('shows the mood fallback only when the artwork image itself fails', async () => {
    const { container, dispose } = createToyContainer(
      'preset-artwork-image-error',
    );
    const rendered = await renderArtwork(container, { entry, preview: null });

    // Fail the image deterministically: the environment's own load/error
    // dispatch is not reliable under full-suite load.
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    await act(async () => {
      img!.dispatchEvent(new Event('error'));
    });

    expect(container.textContent).toContain('Bright pulse');

    rendered.dispose();
    dispose();
  });

  test('renders a ready preview image without fallback copy', async () => {
    const { container, dispose } = createToyContainer('preset-artwork-ready');
    const rendered = await renderArtwork(container, {
      entry,
      preview: {
        presetId: entry.id,
        status: 'ready',
        imageUrl: 'data:image/png;base64,preview',
        actualBackend: 'webgl',
        updatedAt: Date.now(),
        error: null,
        source: 'runtime-snapshot',
      },
    });

    expect(container.textContent).toBe('');
    expect(previewImageSrc(container)).toBe('data:image/png;base64,preview');
    expect(
      container.querySelector('.stims-shell__preset-art-fallback'),
    ).toBeNull();

    rendered.dispose();
    dispose();
  });
});