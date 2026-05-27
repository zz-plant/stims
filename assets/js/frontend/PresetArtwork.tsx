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
      {preview?.imageUrl ? (
        <img
          className="stims-shell__preset-preview-image"
          src={preview.imageUrl}
          alt=""
          loading="lazy"
        />
      ) : null}
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
              : 'Preview queued'}
      </span>
    </div>
  );
}
