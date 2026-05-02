import type { MilkdropPresetRenderPreview } from '../preset-preview.ts';
import type {
  MilkdropCatalogEntry,
  MilkdropCompatibilityIssueCategory,
  MilkdropCompiledPreset,
  MilkdropFidelityClass,
  MilkdropSupportStatus,
} from '../types';

const COLLECTION_TAG_PREFIX = 'collection:';
const PRESET_META_TAG_LABELS: Record<string, string> = {
  'collection:cream-of-the-crop': 'Cream of the Crop',
  'collection:classic-milkdrop': 'Classic MilkDrop',
  'collection:feedback-lab': 'Feedback Lab',
  'collection:low-motion': 'Low Motion',
  'collection:rovastar-and-collaborators': 'Rovastar and collaborators',
  'collection:touch-friendly': 'Touch Friendly',
  'original-pack': 'Original pack',
};
const PRESET_META_TAG_PRIORITY = [
  'collection:cream-of-the-crop',
  'collection:rovastar-and-collaborators',
  'collection:classic-milkdrop',
  'original-pack',
  'collection:feedback-lab',
  'collection:low-motion',
  'collection:touch-friendly',
] as const;

export type PresetRowCallbacks = {
  onSelectPreset: (id: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onSetRating: (id: string, rating: number) => void;
};

export function supportLabel(status: MilkdropSupportStatus) {
  if (status === 'supported') {
    return 'Supported';
  }
  if (status === 'partial') {
    return 'Partial';
  }
  return 'Unsupported';
}

export function fidelityLabel(fidelity: MilkdropFidelityClass) {
  switch (fidelity) {
    case 'exact':
      return 'Exact';
    case 'near-exact':
      return 'Near exact';
    case 'partial':
      return 'Partial';
    default:
      return 'Fallback';
  }
}

export function getPresetMetaQualifier(preset: MilkdropCatalogEntry) {
  if (preset.historyIndex !== undefined) {
    return 'Recent';
  }
  if (preset.rating > 0) {
    return `${preset.rating}★`;
  }
  if (preset.origin !== 'bundled') {
    return 'Imported';
  }
  const highlightedTag = PRESET_META_TAG_PRIORITY.find((tag) =>
    preset.tags.includes(tag),
  );
  if (highlightedTag) {
    return PRESET_META_TAG_LABELS[highlightedTag];
  }
  const firstTag = preset.tags.find(
    (tag) => !tag.startsWith(COLLECTION_TAG_PREFIX),
  );
  if (firstTag) {
    return firstTag.replace(/[-_]/gu, ' ');
  }
  return null;
}

export function compatibilityCategoryLabel(
  category: MilkdropCompatibilityIssueCategory,
) {
  switch (category) {
    case 'unsupported-syntax':
      return 'Unsupported syntax';
    case 'unsupported-shader':
      return 'Unsupported shader';
    case 'runtime-divergence':
      return 'Runtime divergence';
    case 'backend-degradation':
      return 'Backend degradation';
    default:
      return 'Approximation';
  }
}

export function compatibilityCategoryPriority(
  category: MilkdropCompatibilityIssueCategory,
) {
  switch (category) {
    case 'unsupported-syntax':
      return 0;
    case 'unsupported-shader':
      return 1;
    case 'backend-degradation':
      return 2;
    case 'runtime-divergence':
      return 3;
    default:
      return 4;
  }
}

export function getPrimaryDegradationReason(
  compiled: MilkdropCompiledPreset | null,
) {
  if (!compiled) {
    return null;
  }
  return [...compiled.ir.compatibility.parity.degradationReasons].sort(
    (left, right) => {
      if (left.blocking !== right.blocking) {
        return left.blocking ? -1 : 1;
      }
      return (
        compatibilityCategoryPriority(left.category) -
        compatibilityCategoryPriority(right.category)
      );
    },
  )[0];
}

export function formatPrimaryCompatibilityMessage({
  primaryReason,
  support,
}: {
  primaryReason:
    | ReturnType<typeof getPrimaryDegradationReason>
    | undefined
    | null;
  support: { status: MilkdropSupportStatus; reasons: string[] };
}) {
  if (primaryReason) {
    if (primaryReason.blocking && support.status === 'unsupported') {
      return `This preset needs a feature Stims cannot render yet. ${primaryReason.message}`;
    }
    return `Showing a simpler version. ${primaryReason.message}`;
  }

  if (support.status === 'unsupported') {
    return support.reasons[0]
      ? `This preset needs a feature Stims cannot render yet. ${support.reasons[0]}`
      : 'This preset needs a feature Stims cannot render yet.';
  }

  return support.reasons[0]
    ? `Showing a simpler version. ${support.reasons[0]}`
    : 'Showing a simpler version.';
}

function formatBackendName(backend: 'webgl' | 'webgpu') {
  return backend === 'webgpu' ? 'WebGPU' : 'WebGL';
}

/**
 * Format a measured pixel-mismatch ratio (e.g. 0.07) as a short percent
 * string suitable for inline UI use. Returns `null` when no measurement is
 * available so callers can omit the value gracefully.
 */
export function formatMeasuredMismatchPercent(
  ratio: number | null | undefined,
): string | null {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  if (clamped === 0) {
    return '0%';
  }
  if (clamped < 0.01) {
    return '<1%';
  }
  return `${Math.round(clamped * 100)}%`;
}

/**
 * Classify a preset's Stims certification badge status. The result is the
 * single-source-of-truth for whether a preset has been measured and certified
 * by the Stims reference suite, has been measured but is uncertified, or has
 * no measurement yet.
 *
 * Returning `null` means we should not show a certification badge at all
 * (e.g. for presets without a measured visual certification slot).
 */
export function getPresetCertificationBadgeStatus(
  preset: MilkdropCatalogEntry,
): 'certified' | 'uncertified' | null {
  const visualCertification = preset.visualCertification;
  if (!visualCertification?.measured) {
    return null;
  }
  if (visualCertification.status === 'certified') {
    return 'certified';
  }
  return 'uncertified';
}

function formatVisualCertificationNotice({
  preset,
  activeBackend,
}: {
  preset: MilkdropCatalogEntry;
  activeBackend: 'webgl' | 'webgpu';
}) {
  const visualCertification = preset.visualCertification;
  if (
    !visualCertification ||
    visualCertification.requiredBackend !== 'webgpu'
  ) {
    return null;
  }

  if (visualCertification.status !== 'certified') {
    if (visualCertification.measured) {
      return (
        visualCertification.reasons[0] ??
        'Measured WebGPU parity did not pass. Showing the runtime output.'
      );
    }

    return activeBackend === 'webgpu'
      ? 'Runs on WebGPU, but measured parity is still pending.'
      : 'Current session is using WebGL fallback while measured WebGPU parity is still pending.';
  }

  if (
    visualCertification.measured &&
    visualCertification.requiredBackend !== null &&
    activeBackend !== visualCertification.requiredBackend
  ) {
    return `Measured ${formatBackendName(visualCertification.requiredBackend)} parity exists; current session is using ${formatBackendName(activeBackend)}.`;
  }

  return null;
}

function buildPresetRowSignature({
  preset,
  activePresetId,
  activeBackend,
  preview,
}: {
  preset: MilkdropCatalogEntry;
  activePresetId: string | null;
  activeBackend: 'webgl' | 'webgpu';
  preview: MilkdropPresetRenderPreview | null;
}) {
  const support = preset.supports[activeBackend];
  const primaryReason = [...preset.parity.degradationReasons].sort(
    (left, right) => {
      if (left.blocking !== right.blocking) {
        return left.blocking ? -1 : 1;
      }
      return (
        compatibilityCategoryPriority(left.category) -
        compatibilityCategoryPriority(right.category)
      );
    },
  )[0];
  return [
    preset.id,
    preset.title,
    preset.author ?? '',
    preset.origin,
    preset.certification,
    preset.rating,
    preset.isFavorite ? 1 : 0,
    preset.historyIndex ?? -1,
    preset.tags.join(','),
    activePresetId === preset.id ? 1 : 0,
    activeBackend,
    support.status,
    support.reasons[0] ?? '',
    primaryReason?.category ?? '',
    primaryReason?.message ?? '',
    preset.visualCertification?.status ?? '',
    preset.visualCertification?.measured ? 1 : 0,
    preset.visualCertification?.requiredBackend ?? '',
    preset.visualCertification?.actualBackend ?? '',
    preset.visualCertification?.reasons[0] ?? '',
    preset.visualCertification?.mismatchRatio ?? '',
    getPresetCertificationBadgeStatus(preset) ?? '',
    preview?.status ?? '',
    preview?.actualBackend ?? '',
    preview?.updatedAt ?? 0,
    preview?.error ?? '',
  ].join('|');
}

function previewStatusLabel(
  preview: MilkdropPresetRenderPreview | null,
): string | null {
  if (!preview) {
    return 'Preview queued';
  }

  switch (preview.status) {
    case 'queued':
      return 'Preview queued';
    case 'capturing':
      return 'Capturing';
    case 'failed':
      return 'Preview failed';
    default:
      return preview.actualBackend === 'webgpu'
        ? 'WebGPU preview'
        : preview.actualBackend === 'webgl'
          ? 'WebGL preview'
          : 'Runtime preview';
  }
}

function buildPresetRow({
  preset,
  activePresetId,
  activeBackend,
  preview,
  callbacks,
}: {
  preset: MilkdropCatalogEntry;
  activePresetId: string | null;
  activeBackend: 'webgl' | 'webgpu';
  preview: MilkdropPresetRenderPreview | null;
  callbacks: PresetRowCallbacks;
}) {
  const row = document.createElement('div');
  row.className = 'milkdrop-overlay__preset';
  row.dataset.active = String(preset.id === activePresetId);
  row.dataset.previewStatus = preview?.status ?? 'queued';

  const launch = document.createElement('button');
  launch.type = 'button';
  launch.className = 'milkdrop-overlay__preset-launch';
  launch.addEventListener('click', () => callbacks.onSelectPreset(preset.id));

  const previewFrame = document.createElement('div');
  previewFrame.className = 'milkdrop-overlay__preset-preview';

  if (preview?.imageUrl) {
    const previewImage = document.createElement('img');
    previewImage.className = 'milkdrop-overlay__preset-preview-image';
    previewImage.alt = `${preset.title} runtime preview`;
    previewImage.src = preview.imageUrl;
    previewFrame.appendChild(previewImage);
  } else {
    const previewFallback = document.createElement('div');
    previewFallback.className = 'milkdrop-overlay__preset-preview-fallback';
    previewFallback.textContent = preset.title
      .split(/\s+/u)
      .slice(0, 2)
      .join(' ');
    previewFrame.appendChild(previewFallback);
  }

  const previewStatus = document.createElement('div');
  previewStatus.className = 'milkdrop-overlay__preset-preview-status';
  previewStatus.textContent = previewStatusLabel(preview) ?? 'Runtime preview';
  previewFrame.appendChild(previewStatus);

  const titleRow = document.createElement('div');
  titleRow.className = 'milkdrop-overlay__preset-header';

  const title = document.createElement('div');
  title.className = 'milkdrop-overlay__preset-title';
  title.textContent = preset.title;

  const support = preset.supports[activeBackend];
  const badges = document.createElement('div');
  badges.className = 'milkdrop-overlay__preset-badges';

  if (preset.id === activePresetId) {
    const activeBadge = document.createElement('span');
    activeBadge.className =
      'milkdrop-overlay__preset-tag milkdrop-overlay__preset-tag--active';
    activeBadge.textContent = 'Live';
    badges.appendChild(activeBadge);
  }

  const certificationBadgeStatus = getPresetCertificationBadgeStatus(preset);
  if (certificationBadgeStatus === 'certified') {
    const certifiedBadge = document.createElement('span');
    certifiedBadge.className =
      'milkdrop-overlay__preset-tag milkdrop-overlay__preset-tag--verified';
    certifiedBadge.textContent = 'Stims certified';
    certifiedBadge.title =
      preset.visualCertification?.reasons[0] ??
      'Stims reference capture recorded. Certified against the bundled reference corpus.';
    badges.appendChild(certifiedBadge);
  } else if (preset.visualCertification?.measured) {
    const uncertifiedBadge = document.createElement('span');
    uncertifiedBadge.className =
      'milkdrop-overlay__preset-tag milkdrop-overlay__preset-tag--drift';
    uncertifiedBadge.textContent = 'Uncertified';
    uncertifiedBadge.title =
      preset.visualCertification?.reasons[0] ??
      'Measured against Stims reference but did not pass certification.';
    badges.appendChild(uncertifiedBadge);
  }

  titleRow.append(title, badges);

  const meta = document.createElement('div');
  meta.className = 'milkdrop-overlay__preset-meta';
  const metaQualifier = getPresetMetaQualifier(preset);
  meta.textContent = [preset.author, metaQualifier].filter(Boolean).join(' · ');

  launch.append(previewFrame, titleRow, meta);

  const actions = document.createElement('div');
  actions.className = 'milkdrop-overlay__preset-actions';

  const favorite = document.createElement('button');
  favorite.type = 'button';
  favorite.className = 'milkdrop-overlay__favorite';
  favorite.textContent = preset.isFavorite ? '★' : '☆';
  favorite.setAttribute(
    'aria-label',
    preset.isFavorite ? 'Remove saved preset' : 'Save preset',
  );
  favorite.title = preset.isFavorite ? 'Remove saved preset' : 'Save preset';
  favorite.addEventListener('click', (event) => {
    event.stopPropagation();
    callbacks.onToggleFavorite(preset.id, !preset.isFavorite);
  });

  actions.appendChild(favorite);

  row.append(launch, actions);

  const visualCertificationNotice = formatVisualCertificationNotice({
    preset,
    activeBackend,
  });
  const hasCompatibilityWarning =
    support.status !== 'supported' ||
    preset.parity.degradationReasons.length > 0 ||
    visualCertificationNotice !== null;
  if (hasCompatibilityWarning) {
    const reasons = document.createElement('div');
    reasons.className = 'milkdrop-overlay__preset-warning';
    const primaryReason = [...preset.parity.degradationReasons].sort(
      (left, right) => {
        if (left.blocking !== right.blocking) {
          return left.blocking ? -1 : 1;
        }
        return (
          compatibilityCategoryPriority(left.category) -
          compatibilityCategoryPriority(right.category)
        );
      },
    )[0];
    reasons.textContent =
      primaryReason || support.status !== 'supported'
        ? formatPrimaryCompatibilityMessage({
            primaryReason,
            support,
          })
        : (visualCertificationNotice ?? 'Showing a simpler version.');
    row.appendChild(reasons);
  }

  return row;
}

export class PresetRowRenderer {
  private readonly callbacks: PresetRowCallbacks;
  private readonly cache = new Map<
    string,
    { row: HTMLElement; signature: string }
  >();

  constructor(callbacks: PresetRowCallbacks) {
    this.callbacks = callbacks;
  }

  render({
    preset,
    activePresetId,
    activeBackend,
    preview,
  }: {
    preset: MilkdropCatalogEntry;
    activePresetId: string | null;
    activeBackend: 'webgl' | 'webgpu';
    preview: MilkdropPresetRenderPreview | null;
  }) {
    const signature = buildPresetRowSignature({
      preset,
      activePresetId,
      activeBackend,
      preview,
    });
    const cached = this.cache.get(preset.id);
    if (cached && cached.signature === signature) {
      return cached.row;
    }
    const row = buildPresetRow({
      preset,
      activePresetId,
      activeBackend,
      preview,
      callbacks: this.callbacks,
    });
    this.cache.set(preset.id, { row, signature });
    return row;
  }

  syncValidIds(validIds: Set<string>) {
    Array.from(this.cache.keys()).forEach((id) => {
      if (!validIds.has(id)) {
        this.cache.delete(id);
      }
    });
  }
}
