import { initNavigation, loadToy, loadFromQuery } from './loader.js';
import { createLibraryView } from './library-view.js';
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

libraryView.init();
