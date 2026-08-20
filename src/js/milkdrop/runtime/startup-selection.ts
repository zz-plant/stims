import { consumeRequestedMilkdropCollectionSelection } from '../collection-intent.ts';
import { consumeRequestedMilkdropPresetSelection } from '../preset-selection.ts';
import type { createMilkdropCatalogCoordinator } from './catalog-coordinator.ts';
import type { createMilkdropPresetNavigationController } from './preset-navigation-controller.ts';
import { resolveStartupPresetChoice } from './startup.ts';

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
  const { presetId: startupPresetId, reason: startupPresetReason } =
    resolveStartupPresetChoice({
      // A deep link and a remembered preset are separated here purely so the
      // reported reason names the right one: `getStartupPresetId(id)` returns
      // `id ?? lastPresetId`, which folded a `?preset=` arrival into the
      // "remembered" slot and made provenance report it as a restored
      // session. Priority is unchanged — deep link still outranks history.
      requestedPresetId: requestedPresetId ?? initialPresetId ?? null,
      preferredStartupPresetId: preferences.getStartupPresetId() ?? null,
      collectionEntryId: collectionEntry?.id ?? null,
      isBackendSelectable: navigation.isBackendSelectable,
      getFirstSelectablePresetId: navigation.getFirstSelectablePresetId,
      activeBackend,
    });

  return {
    requestedCollectionTag,
    collectionEntry,
    startupPresetId,
    startupPresetReason,
  };
}
