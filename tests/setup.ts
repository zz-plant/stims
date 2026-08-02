import { afterEach, beforeEach } from 'bun:test';
import './environment/install.ts';

Bun.plugin({
  name: 'stims-worker-suffix',
  setup(build) {
    build.onResolve({ filter: /\.ts\?worker$/ }, (args) => {
      return { path: args.path, namespace: 'stims-worker-suffix' };
    });
    build.onLoad({ filter: /.*/, namespace: 'stims-worker-suffix' }, () => ({
      contents: `
        const delegate = function StimsWorkerDelegate() {};
        const StimsWorker = new Proxy(delegate, {
          construct(target, args) {
            const Ctor =
              typeof globalThis !== 'undefined' ? globalThis.Worker : undefined;
            if (typeof Ctor !== 'function') {
              throw new TypeError('Worker is not available in this environment');
            }
            return Reflect.construct(Ctor, args, Ctor);
          },
        });
        export default StimsWorker;
      `,
      loader: 'js',
    }));
  },
});

import { resetMotionPreferenceState } from '../src/js/core/motion-preferences.ts';
import { resetPerformancePanelState } from '../src/js/core/performance-panel.ts';
import { resetRenderPreferencesState } from '../src/js/core/render-preferences.ts';
import { resetSettingsPanelState } from '../src/js/core/settings-panel.ts';
import { resetThemePreferenceState } from '../src/js/core/theme-preferences.ts';

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
