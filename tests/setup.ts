import { afterEach, beforeEach } from 'bun:test';
import './environment/install.ts';

import { resetMotionPreferenceState } from '../assets/js/core/motion-preferences.ts';
import { resetPerformancePanelState } from '../assets/js/core/performance-panel.ts';
import { resetRenderPreferencesState } from '../assets/js/core/render-preferences.ts';
import { resetSettingsPanelState } from '../assets/js/core/settings-panel.ts';
import { resetThemePreferenceState } from '../assets/js/core/theme-preferences.ts';

beforeEach(() => {
  resetRenderPreferencesState();
  resetMotionPreferenceState();
  resetSettingsPanelState();
  resetPerformancePanelState();
  resetThemePreferenceState();
});

afterEach(() => {
  resetRenderPreferencesState();
  resetMotionPreferenceState();
  resetSettingsPanelState();
  resetPerformancePanelState();
  resetThemePreferenceState();
});

export {
  advanceAnimationFrames,
  flushAnimationFrame,
  resetAnimationFrameController,
} from './environment/animation-frame.ts';
export { getDomWindow, installDomEnvironment } from './environment/dom.ts';
export { installMockGpu, resetMockGpu } from './environment/webgpu.ts';
