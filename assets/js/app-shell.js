import { initNavigation, loadToy, loadFromQuery } from './loader.ts';
import { createLibraryView } from './library-view.js';
import toysData from './toys-data.js';

const libraryView = createLibraryView({
  toys: toysData,
  loadToy,
  initNavigation,
  loadFromQuery,
  targetId: 'toy-list',
  searchInputId: 'search-bar',
  cardElement: 'div',
});

libraryView.init();
