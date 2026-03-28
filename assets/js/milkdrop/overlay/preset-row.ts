import type {
  MilkdropCatalogEntry,
  MilkdropCompatibilityIssueCategory,
  MilkdropCompiledPreset,
  MilkdropFidelityClass,
  MilkdropSupportStatus,
} from '../types';

const COLLECTION_TAG_PREFIX = 'collection:';

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
    const prefix =
      primaryReason.blocking && support.status === 'unsupported'
        ? 'Unsupported feature'
        : compatibilityCategoryLabel(primaryReason.category);
    return `${prefix}: ${primaryReason.message}`;
  }

  if (support.status === 'unsupported') {
    return `Unsupported feature: ${support.reasons[0] ?? 'This preset requires MilkDrop features Stims cannot execute yet.'}`;
  }

  return support.reasons[0] ?? 'Preset has fidelity degradations.';
}

function buildPresetRowSignature({
  preset,
  activePresetId,
  activeBackend,
}: {
  preset: MilkdropCatalogEntry;
  activePresetId: string | null;
  activeBackend: 'webgl' | 'webgpu';
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
  ].join('|');
}

function buildPresetRow({
  preset,
  activePresetId,
  activeBackend,
  callbacks,
}: {
  preset: MilkdropCatalogEntry;
  activePresetId: string | null;
  activeBackend: 'webgl' | 'webgpu';
  callbacks: PresetRowCallbacks;
}) {
  const row = document.createElement('div');
  row.className = 'milkdrop-overlay__preset';
  row.dataset.active = String(preset.id === activePresetId);

  const launch = document.createElement('button');
  launch.type = 'button';
  launch.className = 'milkdrop-overlay__preset-launch';
  launch.addEventListener('click', () => callbacks.onSelectPreset(preset.id));

  const titleRow = document.createElement('div');
  titleRow.className = 'milkdrop-overlay__preset-header';

  const title = document.createElement('div');
  title.className = 'milkdrop-overlay__preset-title';
  title.textContent = preset.title;

  const badges = document.createElement('div');
  badges.className = 'milkdrop-overlay__preset-badges';

  if (preset.id === activePresetId) {
    const activeBadge = document.createElement('span');
    activeBadge.className =
      'milkdrop-overlay__preset-tag milkdrop-overlay__preset-tag--active';
    activeBadge.textContent = 'Live';
    badges.appendChild(activeBadge);
  }

  const supportBadge = document.createElement('span');
  supportBadge.className = `milkdrop-overlay__support milkdrop-overlay__support--${preset.fidelityClass}`;
  supportBadge.textContent = fidelityLabel(preset.fidelityClass);
  badges.appendChild(supportBadge);

  titleRow.append(title, badges);

  const meta = document.createElement('div');
  meta.className = 'milkdrop-overlay__preset-meta';
  const metaQualifier = getPresetMetaQualifier(preset);
  meta.textContent = [preset.author, metaQualifier].filter(Boolean).join(' · ');

  launch.append(titleRow, meta);

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

  const support = preset.supports[activeBackend];
  const hasCompatibilityWarning =
    support.status !== 'supported' ||
    preset.parity.degradationReasons.length > 0;
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
    reasons.textContent = formatPrimaryCompatibilityMessage({
      primaryReason,
      support,
    });
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
  }: {
    preset: MilkdropCatalogEntry;
    activePresetId: string | null;
    activeBackend: 'webgl' | 'webgpu';
  }) {
    const signature = buildPresetRowSignature({
      preset,
      activePresetId,
      activeBackend,
    });
    const cached = this.cache.get(preset.id);
    if (cached && cached.signature === signature) {
      return cached.row;
    }
    const row = buildPresetRow({
      preset,
      activePresetId,
      activeBackend,
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
