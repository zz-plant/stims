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
  enableIcons: true,
  enableCapabilityBadges: true,
  enableKeyboardHandlers: true,
  enableDarkModeToggle: true,
  themeToggleId: 'theme-toggle',
});

const startApp = () => {
  libraryView.init();
  void initRepoStatusWidget();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
