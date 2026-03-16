type MilkdropCatalogEntry = {
  title: string;
  author?: string;
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

export async function initMilkdropShowcase() {
  const presetList = document.querySelector('[data-milkdrop-preset-list]');
  const presetCount = document.querySelector('[data-milkdrop-preset-count]');

  if (
    !(presetList instanceof HTMLElement) ||
    !(presetCount instanceof HTMLElement)
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

    const previewEntries = entries.filter((entry) => entry.preview !== false);
    const featuredEntries = (
      previewEntries.length ? previewEntries : entries
    ).slice(0, 4);
    const fragment = document.createDocumentFragment();
    featuredEntries.forEach((entry, index) => {
      fragment.appendChild(createPresetPill(document, entry, index));
    });

    presetList.replaceChildren(fragment);
    presetCount.textContent = `${entries.length} curated presets ship with Stims today.`;
  } catch {
    // Keep the inline fallback copy when the catalog cannot be fetched.
  }
}
