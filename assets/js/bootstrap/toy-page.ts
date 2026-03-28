import type { createLoader } from '../loader.ts';
import { bootExperienceShell } from './experience-shell-controller.ts';

type LoaderApi = ReturnType<typeof createLoader>;

export {
  isPresetFirstToySession,
  shouldCombineFocusedSessionPanels,
  shouldPreferDemoAudio,
} from './experience-shell-controller.ts';
export {
  applyMilkdropLaunchIntents,
  parseRequestedPresetId,
} from './milkdrop-launch-intents.ts';

export function bootToyPage({
  router,
  loadFromQuery,
  initNavigation,
  navContainer,
  audioControlsContainer,
  settingsContainer,
}: {
  router: {
    getCurrentRoute: () => {
      view: 'library' | 'experience';
      slug: string | null;
    };
    getLibraryHref: () => string;
  };
  loadFromQuery: LoaderApi['loadFromQuery'];
  initNavigation: LoaderApi['initNavigation'];
  navContainer: HTMLElement | null;
  audioControlsContainer: HTMLElement | null;
  settingsContainer: HTMLElement | null;
}) {
  bootExperienceShell({
    router,
    loadFromQuery,
    initNavigation,
    navContainer,
    audioControlsContainer,
    settingsContainer,
  });
}
