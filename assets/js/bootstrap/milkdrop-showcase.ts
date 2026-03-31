import { requestMilkdropPresetSelection } from '../milkdrop/public/launch-intents.ts';

type MilkdropCatalogEntry = {
  id: string;
  title: string;
  author?: string;
  tags?: string[];
  order?: number;
  preview?: boolean;
};

type MilkdropCatalogDocument =
  | MilkdropCatalogEntry[]
  | {
      presets?: MilkdropCatalogEntry[];
    };

function resolveEntries(document: MilkdropCatalogDocument) {
  const entries = Array.isArray(document) ? document : (document.presets ?? []);
  return [...entries].sort(
    (left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) -
      (right.order ?? Number.MAX_SAFE_INTEGER),
  );
}

function createPresetPill(
  documentRef: Document,
  entry: MilkdropCatalogEntry,
  index: number,
) {
  const pill = documentRef.createElement('span');
  const accentClass =
    index === 0
      ? 'pill--accent'
      : index % 3 === 0
        ? 'pill--contrast'
        : 'pill--soft';
  pill.className = `pill ${accentClass}`;
  pill.textContent = entry.title;
  if (entry.author) {
    pill.title = `${entry.title} by ${entry.author}`;
  }
  return pill;
}

function formatTagLabel(tag: string) {
  return tag
    .split('-')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

const COLLECTION_LABELS: Record<string, string> = {
  'collection:classic-milkdrop': 'Classic MilkDrop',
  'collection:cream-of-the-crop': 'Cream of the Crop',
  'collection:feedback-lab': 'Feedback Lab',
  'collection:low-motion': 'Low Motion',
  'collection:touch-friendly': 'Touch Friendly',
};

function formatCollectionLabel(tag: string) {
  return (
    COLLECTION_LABELS[tag] ??
    tag
      .replace(/^collection:/u, '')
      .split('-')
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' ')
  );
}

function getCollectionTags(entries: MilkdropCatalogEntry[]) {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        (entry.tags ?? []).filter((tag) => tag.startsWith('collection:')),
      ),
    ),
  ];
}

function buildPresetDescription(entry: MilkdropCatalogEntry) {
  const tags = (entry.tags ?? []).filter(
    (tag) => !tag.startsWith('collection:') && tag !== 'preset',
  );
  if (!tags.length) {
    return 'Launch this preset directly into the live Stims workspace.';
  }
  return `${tags
    .slice(0, 3)
    .map((tag) => tag.replace(/-/gu, ' '))
    .join(' · ')} energy. Opens directly in live playback.`;
}

function createCollectionButton(
  documentRef: Document,
  {
    tag,
    label,
    count,
    active,
    onSelect,
  }: {
    tag: string;
    label: string;
    count: number;
    active: boolean;
    onSelect: (tag: string) => void;
  },
) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'milkdrop-showcase__filter';
  button.dataset.active = String(active);
  button.innerHTML = `${label}<span>${count}</span>`;
  button.addEventListener('click', () => onSelect(tag));
  return button;
}

function createPresetCard(
  documentRef: Document,
  entry: MilkdropCatalogEntry,
  collectionLabel: string,
) {
  const card = documentRef.createElement('article');
  card.className = 'milkdrop-showcase__card';

  const eyebrow = documentRef.createElement('p');
  eyebrow.className = 'milkdrop-showcase__card-eyebrow';
  eyebrow.textContent = collectionLabel;

  const title = documentRef.createElement('h3');
  title.className = 'milkdrop-showcase__card-title';
  title.textContent = entry.title;

  const meta = documentRef.createElement('p');
  meta.className = 'milkdrop-showcase__card-meta';
  meta.textContent = entry.author
    ? `By ${entry.author}`
    : 'Bundled Stims preset';

  const description = documentRef.createElement('p');
  description.className = 'milkdrop-showcase__card-copy';
  description.textContent = buildPresetDescription(entry);

  const tagRow = documentRef.createElement('div');
  tagRow.className = 'milkdrop-showcase__tag-row';
  (entry.tags ?? [])
    .filter((tag) => !tag.startsWith('collection:') && tag !== 'preset')
    .slice(0, 3)
    .forEach((tag, index) => {
      tagRow.appendChild(
        createPresetPill(
          documentRef,
          { ...entry, title: formatTagLabel(tag) },
          index,
        ),
      );
    });

  const actions = documentRef.createElement('div');
  actions.className = 'milkdrop-showcase__card-actions';

  const launch = documentRef.createElement('a');
  launch.href =
    '/milkdrop/?audio=demo&panel=browse&collection=cream-of-the-crop';
  launch.className = 'cta-button primary';
  launch.textContent = 'Start with this preset';
  launch.addEventListener('click', () => {
    requestMilkdropPresetSelection(entry.id);
  });

  actions.append(launch);
  card.append(eyebrow, title, meta, description, tagRow, actions);
  return card;
}

export async function initMilkdropShowcase() {
  const presetList = document.querySelector('[data-milkdrop-preset-list]');
  const presetCount = document.querySelector('[data-milkdrop-preset-count]');
  const presetFilters = document.querySelector(
    '[data-milkdrop-preset-filters]',
  );

  if (
    !(presetList instanceof HTMLElement) ||
    !(presetCount instanceof HTMLElement) ||
    !(presetFilters instanceof HTMLElement)
  ) {
    return;
  }

  try {
    const response = await fetch('/milkdrop-presets/catalog.json', {
      cache: 'no-store',
    });
    if (!response.ok) {
      return;
    }

    const catalog = (await response.json()) as MilkdropCatalogDocument;
    const entries = resolveEntries(catalog);
    if (!entries.length) {
      return;
    }

    const collectionTags = getCollectionTags(entries);
    const initialCollection =
      collectionTags.find((tag) => tag === 'collection:cream-of-the-crop') ??
      collectionTags.find((tag) => tag === 'collection:classic-milkdrop') ??
      collectionTags[0] ??
      '';

    const renderCollection = (collectionTag: string) => {
      const filteredByCollection = collectionTag
        ? entries.filter((entry) => (entry.tags ?? []).includes(collectionTag))
        : entries;
      const previewEntries = filteredByCollection.filter(
        (entry) => entry.preview !== false,
      );
      const featuredEntries = (
        previewEntries.length ? previewEntries : filteredByCollection
      ).slice(0, 6);
      const collectionLabel = collectionTag
        ? formatCollectionLabel(collectionTag)
        : 'All presets';

      presetList.replaceChildren(
        ...featuredEntries.map((entry) =>
          createPresetCard(document, entry, collectionLabel),
        ),
      );

      presetCount.textContent = `${entries.length} bundled presets across ${collectionTags.length} quick collections. Showing ${featuredEntries.length} featured picks from ${collectionLabel}.`;

      presetFilters.replaceChildren(
        createCollectionButton(document, {
          tag: '',
          label: 'All presets',
          count: entries.length,
          active: collectionTag === '',
          onSelect: renderCollection,
        }),
        ...collectionTags.map((tag) =>
          createCollectionButton(document, {
            tag,
            label: formatCollectionLabel(tag),
            count: entries.filter((entry) => (entry.tags ?? []).includes(tag))
              .length,
            active: tag === collectionTag,
            onSelect: renderCollection,
          }),
        ),
      );
    };

    renderCollection(initialCollection);
  } catch {
    // Keep the inline fallback copy when the catalog cannot be fetched.
  }
}
