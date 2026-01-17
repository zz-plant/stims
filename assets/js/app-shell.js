import { createLibraryView } from './library-view.js';
import { initNavigation, loadFromQuery, loadToy } from './loader.ts';
import toysData from './toys-data.js';

const libraryView = createLibraryView({
  toys: globalThis.__stimsToyLibrary ?? toysData,
  loadToy,
  initNavigation,
  loadFromQuery,
  targetId: 'toy-list',
  searchInputId: 'search-bar',
  cardElement: 'a',
});

libraryView.init();
