import { useEffect, useRef, useState } from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { useLivePresetTile } from './hooks/use-live-preset-tile.ts';
import { describePresetMood } from './workspace-helpers.ts';

type PresetArtworkTone =
  | 'bright'
  | 'geometry'
  | 'space'
  | 'moody'
  | 'psychedelic'
  | 'classic'
  | 'instant';

/**
 * Static thumbnail URLs that already 404'd this session.
 *
 * Many presets legitimately have no preview PNG in R2, and `imageError` is
 * component-local: both browse views are virtualized now, so a tile scrolled
 * out of view unmounts and the next scroll back re-requests — and re-404s —
 * the same missing file. Module scope outlives those unmounts, so a known
 * miss renders the mood fallback immediately instead of re-fetching.
 * Only ever populated for the static R2 path; runtime snapshot blobs are
 * per-render and must not be cached here.
 */
const missingStaticThumbnails = new Set<string>();

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
  const mood = describePresetMood(entry);
  const liveTile = useLivePresetTile(entry, { audition });
  const staticThumbUrl = `/milkdrop-presets/previews/${entry.id}.png`;
  // The static R2 thumbnail is the default artwork; a ready runtime snapshot
  // only upgrades it. A failed capture must not hide the thumbnail.
  const runtimeImage =
    preview?.status === 'ready' && preview.imageUrl ? preview.imageUrl : null;
  const imageUrl = runtimeImage ?? staticThumbUrl;
  const [imageError, setImageError] = useState(() =>
    // Seed from the session-wide miss set so a preset known to have no
    // thumbnail never re-requests it on each scroll-back.
    runtimeImage ? false : missingStaticThumbnails.has(staticThumbUrl),
  );

  // Swapping to a new source (runtime snapshot, or another preset) clears
  // any error the previous thumbnail hit — unless the new source is itself
  // a known miss.
  const previousImageUrlRef = useRef(imageUrl);
  useEffect(() => {
    if (previousImageUrlRef.current !== imageUrl) {
      previousImageUrlRef.current = imageUrl;
      setImageError(missingStaticThumbnails.has(imageUrl));
    }
  }, [imageUrl]);

  const previewStatus = runtimeImage ? 'ready' : 'queued';

  return (
    <div
      className="stims-shell__preset-art"
      data-tone={getPresetArtworkTone(entry)}
      data-compact={String(compact)}
      data-preview-status={previewStatus}
      aria-hidden="true"
    >
      <img
        className="stims-shell__preset-preview-image"
        src={imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        width={220}
        height={180}
        onError={() => {
          // Only the static R2 path is worth remembering; runtime snapshot
          // object URLs are per-render and would leak entries forever.
          if (!runtimeImage) missingStaticThumbnails.add(staticThumbUrl);
          setImageError(true);
        }}
        style={imageError ? { display: 'none' } : undefined}
      />
      {imageError ? (
        <span className="stims-shell__preset-art-fallback">{mood}</span>
      ) : null}
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
