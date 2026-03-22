import type { createLoader } from '../loader.ts';

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
