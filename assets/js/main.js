import { initNavigation, loadToy, loadFromQuery } from './loader.ts';
import { createLibraryView } from './library-view.js';
import { initRepoStatusWidget } from './repo-status.js';
import toysData from './toys-data.js';

const libraryView = createLibraryView({
  toys: toysData,
  loadToy,
  initNavigation,
  loadFromQuery,
  targetId: 'toy-list',
  searchInputId: 'toy-search',
  cardElement: 'a',
  enableIcons: true,
  enableCapabilityBadges: true,
  enableKeyboardHandlers: true,
  enableDarkModeToggle: true,
  themeToggleId: 'theme-toggle',
});

const bindQuickstartCta = () => {
  const quickstart = document.querySelector('[data-quickstart-slug]');
  if (!quickstart || !('dataset' in quickstart)) return;

  const { quickstartSlug } = quickstart.dataset;
  if (!quickstartSlug) return;

  quickstart.addEventListener('click', (event) => {
    const isModifiedClick =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1;
    if (isModifiedClick) return;

    event.preventDefault();
    loadToy(quickstartSlug, { pushState: true });
  });
};

const startApp = () => {
  libraryView.init();
  bindQuickstartCta();
  void initRepoStatusWidget();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
