import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { describePresetMood } from './workspace-helpers.ts';

type PresetArtworkTone =
  | 'bright'
  | 'geometry'
  | 'space'
  | 'moody'
  | 'psychedelic'
  | 'classic'
  | 'instant';

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
}: {
  entry: PresetCatalogEntry;
  compact?: boolean;
  preview?: MilkdropPresetRenderPreview | null;
}) {
  const mood = describePresetMood(entry);
  const staticThumbUrl = entry.preview
    ? `/thumbnails/${entry.id}.thumb.png`
    : null;
  const imageUrl = preview?.imageUrl ?? staticThumbUrl;
  const previewStatus = preview?.imageUrl
    ? 'ready'
    : staticThumbUrl
      ? 'static'
      : (preview?.status ?? 'queued');

  return (
    <div
      className="stims-shell__preset-art"
      data-tone={getPresetArtworkTone(entry)}
      data-compact={String(compact)}
      data-preview-status={previewStatus}
      aria-hidden="true"
    >
      {imageUrl ? (
        <img
          className="stims-shell__preset-preview-image"
          src={imageUrl}
          alt=""
          loading="lazy"
          width={220}
          height={180}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : preview === null ? (
        <div className="preset-artwork-ghost" role="status">
          <div className="preset-artwork-ghost__shimmer" />
          <div className="preset-artwork-ghost__meta">
            <div className="preset-artwork-ghost__title" />
            <div className="preset-artwork-ghost__author" />
          </div>
        </div>
      ) : preview?.status === 'failed' ? (
        <span className="stims-shell__preset-art-fallback">{mood}</span>
      ) : null}
    </div>
  );
}
