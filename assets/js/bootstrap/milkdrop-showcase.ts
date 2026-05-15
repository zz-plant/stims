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

const SHOWCASE_LIBRARY_MANIFEST_URLS = [
  '/milkdrop-presets/libraries/projectm-cream-of-the-crop/catalog.json',
];

function resolveEntries(document: MilkdropCatalogDocument) {
  const entries = Array.isArray(document) ? document : (document.presets ?? []);
  return [...entries].sort(
    (left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) -
      (right.order ?? Number.MAX_SAFE_INTEGER),
  );
}

function mergeUniqueEntries(...catalogs: MilkdropCatalogEntry[][]) {
  const entriesById = new Map<string, MilkdropCatalogEntry>();

  catalogs.forEach((catalog) => {
    catalog.forEach((entry) => {
      if (!entriesById.has(entry.id)) {
        entriesById.set(entry.id, entry);
      }
    });
  });

  return resolveEntries([...entriesById.values()]);
}

const COLLECTION_LABELS: Record<string, string> = {
  'collection:classic-milkdrop': 'Classic MilkDrop',
  'collection:cream-of-the-crop': 'Cream of the Crop',
  'collection:feedback-lab': 'Feedback Lab',
  'collection:low-motion': 'Low Motion',
  'collection:rovastar-and-collaborators': 'Rovastar and collaborators',
  'collection:touch-friendly': 'Touch Friendly',
};
const HIDDEN_COLLECTION_FILTER_TAGS = new Set([
  'collection:feedback-lab',
  'collection:low-motion',
]);

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

function getVisibleCollectionTags(collectionTags: string[]) {
  return collectionTags.filter(
    (tag) => !HIDDEN_COLLECTION_FILTER_TAGS.has(tag),
  );
}

function getPreferredCollectionTag(entry: MilkdropCatalogEntry) {
  return (entry.tags ?? []).find((tag) => tag.startsWith('collection:')) ?? '';
}

function buildPresetLaunchHref(
  entry: MilkdropCatalogEntry,
  collectionTag: string,
) {
  const searchParams = new URLSearchParams({
    audio: 'demo',
    panel: 'browse',
    preset: entry.id,
  });
  const selectedCollectionTag =
    collectionTag || getPreferredCollectionTag(entry);
  if (selectedCollectionTag) {
    searchParams.set(
      'collection',
      selectedCollectionTag.replace(/^collection:/u, ''),
    );
  }
  return `/milkdrop/?${searchParams.toString()}`;
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
  collectionTag: string,
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
    : 'Bundled Stims favorite';

  const actions = documentRef.createElement('div');
  actions.className = 'milkdrop-showcase__card-actions';

  const launch = documentRef.createElement('a');
  launch.href = buildPresetLaunchHref(entry, collectionTag);
  launch.className = 'cta-button primary';
  launch.textContent = 'Open this pick';
  launch.addEventListener('click', () => {
    requestMilkdropPresetSelection(entry.id);
  });

  actions.append(launch);
  card.append(eyebrow, title, meta, actions);
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
    const [primaryResponse, ...libraryResponses] = await Promise.all([
      fetch('/milkdrop-presets/catalog.json', {
        cache: 'no-store',
      }),
      ...SHOWCASE_LIBRARY_MANIFEST_URLS.map((url) =>
        fetch(url, { cache: 'no-store' }).catch(() => null),
      ),
    ]);
    if (!primaryResponse.ok) {
      return;
    }

    const primaryCatalog = resolveEntries(
      (await primaryResponse.json()) as MilkdropCatalogDocument,
    );
    const libraryCatalogs = await Promise.all(
      libraryResponses.map(async (response) => {
        if (!response?.ok) {
          return [] as MilkdropCatalogEntry[];
        }
        return resolveEntries(
          (await response.json()) as MilkdropCatalogDocument,
        );
      }),
    );
    const entries = mergeUniqueEntries(primaryCatalog, ...libraryCatalogs);
    if (!entries.length) {
      return;
    }

    const collectionTags = getCollectionTags(entries);
    const visibleCollectionTags = getVisibleCollectionTags(collectionTags);
    const initialCollection =
      visibleCollectionTags.find(
        (tag) => tag === 'collection:cream-of-the-crop',
      ) ??
      visibleCollectionTags.find(
        (tag) => tag === 'collection:classic-milkdrop',
      ) ??
      visibleCollectionTags[0] ??
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
      ).slice(0, 2);
      const collectionLabel = collectionTag
        ? formatCollectionLabel(collectionTag)
        : 'All picks';

      presetList.replaceChildren(
        ...featuredEntries.map((entry) =>
          createPresetCard(document, entry, collectionTag, collectionLabel),
        ),
      );

      presetCount.textContent = `${entries.length} presets across ${visibleCollectionTags.length} collections. Showing ${featuredEntries.length} from ${collectionLabel}.`;

      presetFilters.replaceChildren(
        createCollectionButton(document, {
          tag: '',
          label: 'All picks',
          count: entries.length,
          active: collectionTag === '',
          onSelect: renderCollection,
        }),
        ...visibleCollectionTags.map((tag) =>
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
