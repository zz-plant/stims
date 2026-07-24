import type { MilkdropRenderBackend } from './common-types.ts';

export const PRESET_PREVIEW_REQUEST_LIMIT = 8;

export type MilkdropPresetRenderPreviewStatus =
  | 'queued'
  | 'capturing'
  | 'ready'
  | 'failed';

export type MilkdropPresetRenderPreview = {
  presetId: string;
  status: MilkdropPresetRenderPreviewStatus;
  imageUrl: string | null;
  actualBackend: MilkdropRenderBackend | null;
  updatedAt: number | null;
  error: string | null;
  source: 'runtime-snapshot';
};

export function createQueuedPresetPreview(
  presetId: string,
): MilkdropPresetRenderPreview {
  return {
    presetId,
    status: 'queued',
    imageUrl: null,
    actualBackend: null,
    updatedAt: null,
    error: null,
    source: 'runtime-snapshot',
  };
}
