import { afterEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import { PresetArtwork } from '../../src/js/frontend/PresetArtwork.tsx';
import {
  markPresetUnrenderable,
  rememberPresetStill,
  resetPresetStillCaptureState,
  setPresetStillEncoderForTests,
} from '../../src/js/frontend/preset-still-capture.ts';
import type { MilkdropPresetRenderPreview } from '../../src/js/milkdrop/preset-preview.ts';
import { createToyContainer } from '../toy-test-helpers.ts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every test uses its own preset id. PresetArtwork remembers 404'd thumbnail
 * URLs at module scope (deliberately — it outlives the virtualized grid's
 * unmounts), so sharing an id would let one test's miss seed the next.
 */
function makeEntry(id: string, file?: string): PresetCatalogEntry {
  return {
    id,
    title: 'Glow Preset',
    author: 'Tester',
    tags: ['glow'],
    ...(file === undefined ? {} : { file }),
  };
}

const PLACEHOLDER = '.stims-shell__preset-art-placeholder';

function previewImageSrc(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLImageElement>(
    '.stims-shell__preset-preview-image',
  )?.src;
}

function previewStatus(container: HTMLElement): string | null {
  return (
    container
      .querySelector('.stims-shell__preset-art')
      ?.getAttribute('data-preview-status') ?? null
  );
}

function readyPreview(
  presetId: string,
  imageUrl: string,
): MilkdropPresetRenderPreview {
  return {
    presetId,
    status: 'ready',
    imageUrl,
    actualBackend: 'webgl',
    updatedAt: Date.now(),
    error: null,
    source: 'runtime-snapshot',
  };
}

/**
 * Renders without draining. happy-dom cannot load the R2 thumbnail URL and
 * fires `error` on it asynchronously, so anything asserted about the
 * thumbnail-present state has to be asserted before that lands — and the
 * component no longer keeps a hidden `img` around to paper over the
 * difference, which is the point.
 */
async function renderArtwork(
  container: HTMLElement,
  props: {
    entry: PresetCatalogEntry;
    preview?: MilkdropPresetRenderPreview | null;
  },
): Promise<{ dispose: () => void }> {
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PresetArtwork, props));
  });
  return { dispose: () => act(() => root.unmount()) };
}

async function drain(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Puts the tile in the "no stored thumbnail" state it is in for most of the
 * catalog, whether or not the environment has already errored the image. */
async function failThumbnail(container: HTMLElement) {
  const img = container.querySelector('img');
  if (img) {
    await act(async () => {
      img.dispatchEvent(new Event('error'));
    });
  }
  await drain();
}

afterEach(() => {
  setPresetStillEncoderForTests(null);
  resetPresetStillCaptureState();
});

describe('PresetArtwork', () => {
  // Not covered here: the stored-thumbnail-displayed state. happy-dom cannot
  // load the R2 URL and errors it synchronously during the render flush, so
  // that state never exists in this environment, and it has no MutationObserver
  // to catch the img on its way through. The branch it would exercise — a real
  // image URL means "ready" — is the same one the runtime-snapshot test below
  // covers; a test that mocked the difference away would only be asserting the
  // mock.
  test('a ready runtime snapshot outranks the stored thumbnail', async () => {
    const { container, dispose } = createToyContainer('artwork-runtime');
    const rendered = await renderArtwork(container, {
      entry: makeEntry('runtime-snap'),
      preview: readyPreview('runtime-snap', 'data:image/png;base64,preview'),
    });

    expect(previewImageSrc(container)).toBe('data:image/png;base64,preview');
    expect(previewStatus(container)).toBe('ready');
    expect(container.querySelector(PLACEHOLDER)).toBeNull();

    rendered.dispose();
    dispose();
  });

  // The reason this component was rewritten. The art slot used to fill with a
  // picture generated from a hash of the preset id — a waveform over a bloom,
  // styled to sit in the slot "exactly as a real thumbnail would". Nothing in
  // it came from the preset, so a browse grid mixed real frames with invented
  // ones and gave the reader no way to tell which was which.
  test('never substitutes generated artwork for a missing preview', async () => {
    const { container, dispose } = createToyContainer('artwork-no-fake');
    const rendered = await renderArtwork(container, {
      entry: makeEntry('nothing-to-render'),
      preview: null,
    });
    await failThumbnail(container);

    // Nothing is displayed that the preset did not produce: no image at all,
    // and no drawn stand-in of any kind.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();

    // Instead the slot says so, and the DOM agrees.
    expect(container.querySelector(PLACEHOLDER)).not.toBeNull();
    expect(container.textContent).toContain('No preview');
    expect(previewStatus(container)).toBe('unavailable');

    rendered.dispose();
    dispose();
  });

  test('shows a frame the preset actually rendered once one exists', async () => {
    setPresetStillEncoderForTests(() => 'data:image/webp;base64,real');
    // Stands in for a live tile — hover audition, or the ?liveTiles flag —
    // having run this preset and left a true frame behind.
    rememberPresetStill('renders-fine', {} as HTMLCanvasElement);

    const { container, dispose } = createToyContainer('artwork-captured');
    const rendered = await renderArtwork(container, {
      entry: makeEntry('renders-fine', '/presets/renders-fine.milk'),
      preview: null,
    });
    await failThumbnail(container);

    expect(previewImageSrc(container)).toBe('data:image/webp;base64,real');
    expect(previewStatus(container)).toBe('ready');
    expect(container.querySelector(PLACEHOLDER)).toBeNull();

    rendered.dispose();
    dispose();
  });

  test('picks up a frame captured while the tile is already mounted', async () => {
    setPresetStillEncoderForTests(() => 'data:image/webp;base64,late');

    const { container, dispose } = createToyContainer('artwork-late');
    const rendered = await renderArtwork(container, {
      entry: makeEntry('late-frame', '/presets/late-frame.milk'),
      preview: null,
    });
    await failThumbnail(container);

    expect(container.textContent).toContain('No preview');

    // The audition engine reaches `live` and leaves a frame behind.
    await act(async () => {
      rememberPresetStill('late-frame', {} as HTMLCanvasElement);
    });
    await drain();

    expect(previewImageSrc(container)).toBe('data:image/webp;base64,late');
    expect(previewStatus(container)).toBe('ready');

    rendered.dispose();
    dispose();
  });

  test('a preset whose engine failed says so rather than showing anything', async () => {
    const { container, dispose } = createToyContainer('artwork-failed');
    const rendered = await renderArtwork(container, {
      entry: makeEntry('engine-failed', '/presets/engine-failed.milk'),
      preview: null,
    });
    await failThumbnail(container);

    await act(async () => {
      markPresetUnrenderable('engine-failed');
    });
    await drain();

    expect(previewStatus(container)).toBe('unavailable');
    expect(container.textContent).toContain('No preview');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();

    rendered.dispose();
    dispose();
  });
});
