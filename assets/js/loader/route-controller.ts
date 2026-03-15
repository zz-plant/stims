import type { Route } from '../router.ts';

export function createLoaderRouteController({
  backToLibrary,
  loadToy,
}: {
  backToLibrary: (options?: { updateRoute?: boolean }) => void;
  loadToy: (slug: string) => Promise<void>;
}) {
  const handleRoute = async (
    route: Route,
    { updateRoute = false }: { updateRoute?: boolean } = {},
  ) => {
    if (route.view === 'toy') {
      if (route.slug) {
        await loadToy(route.slug);
        return;
      }
      backToLibrary({ updateRoute: true });
      return;
    }

    backToLibrary({ updateRoute });
  };

  return {
    handleRoute,
  };
}
