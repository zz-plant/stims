import type { createLoader } from '../loader.ts';
import { CREAM_OF_THE_CROP_COLLECTION_TAG } from '../milkdrop/collection-intent.ts';

const HOME_TOY_SLUG = 'milkdrop';
const HOME_LANDING_PARAM = 'landing';
const HOME_LANDING_OPT_OUT = '1';

type LoaderApi = ReturnType<typeof createLoader>;

function redirectHomeTrafficToLaunch(win: Window = window) {
  const currentUrl = new URL(win.location.href);

  if (currentUrl.pathname !== '/') {
    return false;
  }

  if (
    currentUrl.searchParams.get(HOME_LANDING_PARAM) === HOME_LANDING_OPT_OUT
  ) {
    return false;
  }

  const launchUrl = new URL('/milkdrop/', currentUrl);
  for (const [key, value] of currentUrl.searchParams.entries()) {
    launchUrl.searchParams.append(key, value);
  }
  if (!launchUrl.searchParams.has('audio')) {
    launchUrl.searchParams.set('audio', 'demo');
  }
  if (!launchUrl.searchParams.has('panel')) {
    launchUrl.searchParams.set('panel', 'browse');
  }
  if (!launchUrl.searchParams.has('collection')) {
    launchUrl.searchParams.set(
      'collection',
      CREAM_OF_THE_CROP_COLLECTION_TAG.replace(/^collection:/u, ''),
    );
  }
  launchUrl.hash = currentUrl.hash;

  win.location.replace(launchUrl.toString());
  return true;
}

export function bootHomePage({
  loadToy,
  initNavigation,
}: {
  loadToy: LoaderApi['loadToy'];
  initNavigation: LoaderApi['initNavigation'];
}) {
  if (redirectHomeTrafficToLaunch()) {
    return;
  }

  initNavigation();
  void loadToy(HOME_TOY_SLUG, { preferDemoAudio: true });
}
