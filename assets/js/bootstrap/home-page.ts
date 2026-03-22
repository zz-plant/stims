import type { createLoader } from '../loader.ts';

const HOME_TOY_SLUG = 'milkdrop';

type LoaderApi = ReturnType<typeof createLoader>;

export function bootHomePage({
  loadToy,
  initNavigation,
}: {
  loadToy: LoaderApi['loadToy'];
  initNavigation: LoaderApi['initNavigation'];
}) {
  initNavigation();
  void loadToy(HOME_TOY_SLUG, { preferDemoAudio: true });
}
