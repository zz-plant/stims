import { createLibraryView } from './library-view.js';
import { initNavigation, loadFromQuery, loadToy } from './loader.ts';
import toysData from './toys-data.js';

const loaderOverrides = globalThis.__stimsLoaderOverrides;
const loader = loaderOverrides ?? { initNavigation, loadFromQuery, loadToy };

const libraryView = createLibraryView({
  toys: globalThis.__stimsToyLibrary ?? toysData,
  loadToy: loader.loadToy,
  initNavigation: loader.initNavigation,
  loadFromQuery: loader.loadFromQuery,
  targetId: 'toy-list',
  searchInputId: 'search-bar',
  cardElement: 'a',
});

libraryView.init();
