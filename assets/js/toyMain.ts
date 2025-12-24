import { initNavigation, loadFromQuery } from './loader.ts';

export function startToyPage() {
  initNavigation();
  void loadFromQuery();
}
