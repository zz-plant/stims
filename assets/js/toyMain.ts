import { initAgentAPI } from './core/agent-api.ts';
import { initNavigation, loadFromQuery } from './loader.ts';

export function startToyPage() {
  initAgentAPI(); // Expose window.stimState for agents
  initNavigation();
  void loadFromQuery();
}
