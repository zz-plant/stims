const REQUESTED_COLLECTION_KEY = 'stims:milkdrop:requested-collection';
export const MILKDROP_COLLECTION_SELECTION_EVENT =
  'stims:milkdrop:select-collection';

export const CREAM_OF_THE_CROP_COLLECTION_TAG = 'collection:cream-of-the-crop';

type CollectionSelectionEventDetail = {
  collectionTag: string;
};

function normalizeCollectionTag(collectionTag: string | null | undefined) {
  const normalized = collectionTag?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('collection:')) {
    return normalized;
  }
  return `collection:${normalized}`;
}

export function requestMilkdropCollectionSelection(collectionTag: string) {
  const normalizedCollectionTag = normalizeCollectionTag(collectionTag);
  if (!normalizedCollectionTag) {
    return;
  }

  try {
    window.sessionStorage.setItem(
      REQUESTED_COLLECTION_KEY,
      normalizedCollectionTag,
    );
  } catch {
    // Ignore storage failures and rely on the live event when possible.
  }

  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<CollectionSelectionEventDetail>(
      MILKDROP_COLLECTION_SELECTION_EVENT,
      {
        detail: {
          collectionTag: normalizedCollectionTag,
        },
      },
    ),
  );
}

export function consumeRequestedMilkdropCollectionSelection() {
  try {
    const collectionTag = normalizeCollectionTag(
      window.sessionStorage.getItem(REQUESTED_COLLECTION_KEY),
    );
    if (!collectionTag) {
      return null;
    }
    window.sessionStorage.removeItem(REQUESTED_COLLECTION_KEY);
    return collectionTag;
  } catch {
    return null;
  }
}
