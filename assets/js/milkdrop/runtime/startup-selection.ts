import { consumeRequestedMilkdropCollectionSelection } from '../collection-intent.ts';
import { consumeRequestedMilkdropPresetSelection } from '../preset-selection.ts';
import type { createMilkdropCatalogCoordinator } from './catalog-coordinator.ts';
import type { createMilkdropPresetNavigationController } from './preset-navigation-controller.ts';
import { resolveStartupPresetId } from './startup.ts';

export async function selectMilkdropStartupPreset({
  catalogCoordinator,
  navigation,
  preferences,
  initialPresetId,
  activeBackend,
}: {
  catalogCoordinator: ReturnType<typeof createMilkdropCatalogCoordinator>;
  navigation: ReturnType<typeof createMilkdropPresetNavigationController>;
  preferences: {
    getStartupPresetId: (initialPresetId?: string) => string | null | undefined;
  };
  initialPresetId?: string;
  activeBackend: 'webgl' | 'webgpu';
}) {
  const requestedCollectionTag =
    typeof window === 'undefined'
      ? null
      : consumeRequestedMilkdropCollectionSelection();
  const collectionEntry = requestedCollectionTag
    ? (catalogCoordinator
        .getCatalogEntries()
        .find((entry) => entry.tags.includes(requestedCollectionTag)) ?? null)
    : null;

  const requestedPresetId =
    typeof window === 'undefined'
      ? null
      : consumeRequestedMilkdropPresetSelection();
  const startupPresetId = resolveStartupPresetId({
    requestedPresetId: requestedPresetId ?? null,
    preferredStartupPresetId:
      preferences.getStartupPresetId(initialPresetId) ?? null,
    collectionEntryId: collectionEntry?.id ?? null,
    isBackendSelectable: navigation.isBackendSelectable,
    getFirstSelectablePresetId: navigation.getFirstSelectablePresetId,
    activeBackend,
  });

  return {
    requestedCollectionTag,
    collectionEntry,
    startupPresetId,
    firstSelectablePresetId:
      navigation.getFirstSelectablePresetId(activeBackend),
  };
}
