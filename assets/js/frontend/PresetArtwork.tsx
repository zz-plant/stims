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

  return (
    <div
      className="stims-shell__preset-art"
      data-tone={getPresetArtworkTone(entry)}
      data-compact={String(compact)}
      data-preview-status={preview?.status ?? 'queued'}
      aria-hidden="true"
    >
      {preview === null ? (
        <div className="preset-artwork-ghost" role="status">
          <div className="preset-artwork-ghost__shimmer" />
          <div className="preset-artwork-ghost__meta">
            <div className="preset-artwork-ghost__title" />
            <div className="preset-artwork-ghost__author" />
          </div>
        </div>
      ) : preview?.imageUrl ? (
        <img
          className="stims-shell__preset-preview-image"
          src={preview.imageUrl}
          alt=""
          loading="lazy"
        />
      ) : null}
      {entry.lineage && entry.lineage.length > 0 && (
        <div
          className="preset-artwork-lineage"
          title={`Blend of ${entry.lineage.map((l) => l.title).join(' + ')}`}
        >
          <svg
            className="preset-artwork-lineage__icon"
            viewBox="0 0 16 16"
            width="12"
            height="12"
            aria-hidden="true"
          >
            <title>Lineage</title>
            <path
              d="M8 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM4.5 8L7 5.5l1 1L4.5 8z"
              fill="currentColor"
            />
          </svg>
          <span className="preset-artwork-lineage__label">
            {entry.lineage.map((l) => l.title).join(' + ')}
          </span>
        </div>
      )}
      <span className="stims-shell__preset-art-grid" />
      <span className="stims-shell__preset-art-orbit" />
      <span className="stims-shell__preset-art-core" />
      <span className="stims-shell__preset-art-caption">{mood}</span>
      <span className="stims-shell__preset-art-status">
        {preview?.status === 'ready'
          ? preview.actualBackend === 'webgpu'
            ? 'WebGPU preview'
            : preview.actualBackend === 'webgl'
              ? 'WebGL preview'
              : 'Runtime preview'
          : preview?.status === 'capturing'
            ? 'Capturing'
            : preview?.status === 'failed'
              ? 'Preview failed'
              : ''}
      </span>
    </div>
  );
}
