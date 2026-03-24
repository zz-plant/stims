import { requestMilkdropCollectionSelection } from '../milkdrop/collection-intent.ts';
import {
  type MilkdropOverlayTab,
  requestMilkdropOverlayTab,
} from '../milkdrop/overlay-intent.ts';

export function parseRequestedOverlayTab(searchParams: URLSearchParams) {
  const value = searchParams.get('panel')?.trim().toLowerCase();
  if (value === 'browse' || value === 'editor' || value === 'inspector') {
    return value as MilkdropOverlayTab;
  }
  return null;
}

export function applyMilkdropLaunchIntents({
  toySlug,
  requestedOverlayTab,
  requestedCollectionTag,
}: {
  toySlug: string | null;
  requestedOverlayTab: MilkdropOverlayTab | null;
  requestedCollectionTag: string | null;
}) {
  if (toySlug !== 'milkdrop') {
    return;
  }

  if (requestedOverlayTab) {
    requestMilkdropOverlayTab(requestedOverlayTab);
  }

  if (requestedCollectionTag) {
    requestMilkdropCollectionSelection(requestedCollectionTag);
  }
}
