import {
  getActiveQualityPreset,
  getStoredQualityPreset,
  QUALITY_STORAGE_KEY,
  type QualityPreset,
} from './settings-panel';

type QualityHandler = (preset: QualityPreset) => void;

function isQualityPreset(value: unknown): value is QualityPreset {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.maxPixelRatio === 'number'
  );
}

export function setupIframeQualitySync(applyQuality: QualityHandler) {
  let activePreset = getActiveQualityPreset();

  const apply = (preset: QualityPreset) => {
    activePreset = preset;
    applyQuality(preset);
  };

  apply(activePreset);

  window.addEventListener('message', (event) => {
    const preset = (event.data as { type?: string; preset?: unknown })?.preset;
    if ((event.data as { type?: string }).type !== 'apply-quality-preset') return;

    if (isQualityPreset(preset)) {
      apply(preset);
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== QUALITY_STORAGE_KEY) return;
    apply(getStoredQualityPreset());
  });

  window.parent?.postMessage({ type: 'quality-sync-ready' }, '*');

  return {
    getActivePreset: () => activePreset,
  };
}
