import type { createLoader } from '../loader.ts';
import { bootExperienceShell } from './experience-shell-controller.ts';

type LoaderApi = ReturnType<typeof createLoader>;

export {
  isPresetFirstToySession,
  shouldCombineFocusedSessionPanels,
  shouldPreferDemoAudio,
} from './experience-shell-controller.ts';

export function bootToyPage({
  router,
  loadFromQuery,
  initNavigation,
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
  audioControlsContainer: HTMLElement | null;
  settingsContainer: HTMLElement | null;
}) {
  bootExperienceShell({
    router,
    loadFromQuery,
    initNavigation,
    audioControlsContainer,
    settingsContainer,
  });
}
