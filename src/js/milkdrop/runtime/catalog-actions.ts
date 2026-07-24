import type { MilkdropCatalogStore, MilkdropRenderBackend } from '../types';
import type { MilkdropCatalogCoordinator } from './catalog-coordinator.ts';

export function createMilkdropCatalogActions({
  catalogStore,
  catalogCoordinator,
  getActivePresetId,
  getActiveBackend,
}: {
  catalogStore: MilkdropCatalogStore;
  catalogCoordinator: MilkdropCatalogCoordinator;
  getActivePresetId: () => string;
  getActiveBackend: () => MilkdropRenderBackend;
}) {
  const patchEntry = async (
    id: string,
    update: Parameters<
      MilkdropCatalogCoordinator['patchCatalogEntry']
    >[0]['update'],
  ) =>
    catalogCoordinator.patchCatalogEntry({
      id,
      activePresetId: getActivePresetId(),
      activeBackend: getActiveBackend(),
      update,
    });

  const setFavorite = async (id: string, favorite: boolean) => {
    await catalogStore.setFavorite(id, favorite);
    await patchEntry(id, { isFavorite: favorite });
  };

  const toggleFavorite = async (id: string) => {
    const entry = catalogCoordinator.getCatalogEntry(id);
    await setFavorite(id, !(entry?.isFavorite ?? false));
  };

  const setRating = async (id: string, rating: number) => {
    await catalogStore.setRating(id, rating);
    await patchEntry(id, { rating });
  };

  return {
    patchEntry,
    setFavorite,
    toggleFavorite,
    setRating,
  };
}
