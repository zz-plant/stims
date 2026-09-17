/**
 * Makes "saved presets still work offline" true rather than incidental.
 *
 * The shell tells the user, in as many words, that offline party mode keeps
 * saved presets working. What actually backed that was the service worker's
 * stale-while-revalidate over `/milkdrop-presets/`, which only ever caches
 * what has already been fetched — so a preset saved from a browse tile and
 * never played was not offline at all. Saving it from one device's grid and
 * opening the app on a plane found nothing.
 *
 * Saving a preset is the signal, so saving one fetches it. Both requests go
 * through the same prefix the worker already caches, which is why there is no
 * worker change here: warming is nothing more than making the request early.
 *
 * Bytes are small — a `.milk` is a few KB and a preview thumbnail is tens —
 * so this is per-save rather than a bulk "download my favourites" action that
 * would need its own UI, progress and cancellation.
 */

/** Matches `PresetArtwork` and the runtime's thumbnail convention. */
const previewUrlFor = (presetId: string) =>
  `/milkdrop-presets/previews/${presetId}.png`;

/**
 * Runs `task` off the click's own frame.
 *
 * Saving is a button press and must stay instant; fetching and compiling a
 * preset behind it must not be what the press feels like. But a live stage
 * never actually goes idle — the render loop sees to that — so on the page
 * this matters for, the deadline below is what fires, not idleness. It is
 * short on purpose: the first version used the API's usual couple of
 * seconds and the cache landed around eight seconds after the save, which
 * is long enough to miss someone who saves a preset and closes the tab.
 */
const WARM_DEADLINE_MS = 250;

function whenIdle(task: () => void) {
  const idle = (
    globalThis as unknown as {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => void;
    }
  ).requestIdleCallback;
  if (typeof idle === 'function') {
    idle(task, { timeout: WARM_DEADLINE_MS });
    return;
  }
  setTimeout(task, 0);
}

/**
 * Pulls a saved preset's source and thumbnail into the offline cache.
 *
 * `getPresetSource` is the app's ordinary read path: for a bundled preset it
 * fetches the `.milk` (which is what warms the worker's cache, and compiles
 * it into the analysis cache on the way past), and for an imported one it
 * reads IndexedDB and touches the network not at all — already offline by
 * construction, so this costs nothing there.
 *
 * Never rejects. Saving a preset while offline, or saving one whose
 * thumbnail was never generated, is not a failure the user needs told about;
 * the save itself has already succeeded.
 */
export function warmFavoriteForOffline(
  presetId: string,
  getPresetSource: (id: string) => Promise<unknown>,
): void {
  const id = presetId.trim();
  if (!id) return;

  whenIdle(() => {
    void getPresetSource(id).catch(() => {
      // Offline, or a preset the catalog no longer knows.
    });
    void fetch(previewUrlFor(id)).catch(() => {
      // Plenty of presets have no generated thumbnail.
    });
  });
}
