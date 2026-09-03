import { useEffect, useRef, useState } from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { useLivePresetTile } from './hooks/use-live-preset-tile.ts';
import {
  type PresetArtworkTone,
  PresetPreviewPlaceholder,
} from './PresetPreviewPlaceholder.tsx';
import {
  getCapturedPresetStill,
  isPresetUnrenderable,
  subscribePresetStills,
} from './preset-still-capture.ts';
import { describePresetMood } from './workspace-helpers.ts';

/**
 * Static thumbnail URLs that already 404'd this session.
 *
 * Many presets legitimately have no preview PNG in R2, and `imageError` is
 * component-local: both browse views are virtualized now, so a tile scrolled
 * out of view unmounts and the next scroll back re-requests — and re-404s —
 * the same missing file. Module scope outlives those unmounts, so a known
 * miss goes straight to the capture path instead of re-fetching.
 * Only ever populated for the static R2 path; runtime snapshot blobs are
 * per-render and must not be cached here.
 */
const missingStaticThumbnails = new Set<string>();

/**
 * Seeds capture state from the module caches, so a tile scrolled back into
 * view neither re-renders a preset that already has a still nor re-attempts
 * one already known not to paint.
 */
function readCaptureState(presetId: string): {
  still: string | null;
  settled: boolean;
} {
  const still = getCapturedPresetStill(presetId);
  return { still, settled: still !== null || isPresetUnrenderable(presetId) };
}

function getPresetArtworkTone(entry: PresetCatalogEntry): PresetArtworkTone {
  const mood = describePresetMood(entry);

  switch (mood) {
    case 'Bright pulse':
      return 'bright';
    case 'Sharp geometry':
      return 'geometry';
    case 'Space drift':
      return 'space';
    case 'Moody sweep':
      return 'moody';
    case 'Psychedelic spin':
      return 'psychedelic';
    case 'Classic rush':
      return 'classic';
    default:
      return 'instant';
  }
}

export function PresetArtwork({
  entry,
  compact = false,
  preview = null,
  audition = false,
}: {
  entry: PresetCatalogEntry;
  compact?: boolean;
  preview?: MilkdropPresetRenderPreview | null;
  /** Render a live engine tile while true (grid hover/focus audition). */
  audition?: boolean;
}) {
  const tone = getPresetArtworkTone(entry);
  const liveTile = useLivePresetTile(entry, { audition });
  const staticThumbUrl = `/milkdrop-presets/previews/${entry.id}.png`;
  // The static R2 thumbnail is the default artwork; a ready runtime snapshot
  // only upgrades it. A failed capture must not hide the thumbnail.
  const runtimeImage =
    preview?.status === 'ready' && preview.imageUrl ? preview.imageUrl : null;
  const [imageError, setImageError] = useState(() =>
    // Seed from the session-wide miss set so a preset known to have no
    // thumbnail never re-requests it on each scroll-back.
    runtimeImage ? false : missingStaticThumbnails.has(staticThumbUrl),
  );
  // A frame kept from a live tile that ran this preset, for the common case
  // of no thumbnail in R2. `settled` is tracked alongside the still because
  // the no-frame answer is a result too: without it a preset whose engine
  // failed would sit on "Rendering preview…" forever, its own small lie.
  const [capture, setCapture] = useState(() => readCaptureState(entry.id));

  const staticImageUsable = !imageError;
  const imageUrl = runtimeImage ?? (staticImageUsable ? staticThumbUrl : null);
  // Only ever a frame the preset itself produced: a runtime snapshot, the R2
  // thumbnail, or a still kept from a live tile. Nothing synthesised stands in
  // for one — that substitution is the bug this component was rewritten to
  // remove.
  const realImageUrl = imageUrl ?? capture.still;

  // A reused component instance must not show the previous preset's capture.
  const previousEntryIdRef = useRef(entry.id);
  useEffect(() => {
    if (previousEntryIdRef.current !== entry.id) {
      previousEntryIdRef.current = entry.id;
      setCapture(readCaptureState(entry.id));
    }
  }, [entry.id]);

  // Swapping to a new source (runtime snapshot, or another preset) clears
  // any error the previous thumbnail hit — unless the new source is itself
  // a known miss.
  const previousImageUrlRef = useRef(imageUrl);
  useEffect(() => {
    if (previousImageUrlRef.current !== imageUrl) {
      previousImageUrlRef.current = imageUrl;
      setImageError(imageUrl ? missingStaticThumbnails.has(imageUrl) : true);
    }
  }, [imageUrl]);

  // A live tile for this preset — hover audition, or the ?liveTiles flag —
  // keeps a real frame of it as it runs, so pick that up when it lands. This
  // component never starts an engine to make one: see preset-still-capture.ts
  // for why photographing every un-thumbnailed tile is the wrong trade.
  useEffect(
    () =>
      subscribePresetStills((presetId) => {
        if (presetId === entry.id) {
          setCapture(readCaptureState(entry.id));
        }
      }),
    [entry.id],
  );

  // "Rendering" is only true while a tile really is rendering this preset.
  // Anything else with no stored frame has no preview, and says so.
  const previewStatus = realImageUrl
    ? 'ready'
    : liveTile.enabled && !capture.settled
      ? 'capturing'
      : 'unavailable';

  return (
    <div
      className="stims-shell__preset-art"
      data-tone={tone}
      data-compact={String(compact)}
      data-preview-status={previewStatus}
      aria-hidden="true"
    >
      {realImageUrl ? (
        <img
          className="stims-shell__preset-preview-image"
          src={realImageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          width={220}
          height={180}
          onError={() => {
            // Only the static R2 path is worth remembering; runtime snapshot
            // and capture data URLs are per-render and would leak entries.
            if (realImageUrl === staticThumbUrl) {
              missingStaticThumbnails.add(staticThumbUrl);
            }
            setImageError(true);
          }}
        />
      ) : (
        <PresetPreviewPlaceholder
          state={previewStatus === 'unavailable' ? 'unavailable' : 'capturing'}
        />
      )}
      {liveTile.enabled ? (
        <div
          ref={liveTile.hostRef}
          data-live-tile={entry.id}
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            borderRadius: 'inherit',
          }}
        />
      ) : null}
    </div>
  );
}
