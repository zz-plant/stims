import { initAgentAPI } from './core/agent-api.ts';
import { initNavigation, loadFromQuery } from './loader.ts';
import { initGamepadNavigation } from './utils/gamepad-navigation.ts';

export function startToyPage() {
  initAgentAPI(); // Expose window.stimState for agents
  initNavigation();
  initGamepadNavigation();
  void loadFromQuery();
}
