import { afterEach, beforeEach, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
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

const workletSource = readFileSync(
  resolvePath(
    import.meta.dirname,
    '../src/js/utils/audio/frequency-analyser-processor.ts',
  ),
  'utf8',
);
mock.module(
  '../src/js/utils/audio/frequency-analyser-processor.ts?worklet',
  () => ({
    default: workletSource,
  }),
);
mock.module('../utils/audio/frequency-analyser-processor.ts?worklet', () => ({
  default: workletSource,
}));

import { resetDeviceProfileCache } from '../src/js/core/device-profile.ts';
import { resetMotionPreferenceState } from '../src/js/core/motion-preferences.ts';
import { resetPerformancePanelState } from '../src/js/core/performance-panel.ts';
import { resetSettingsPanelState } from '../src/js/core/settings-panel.ts';
import { resetRenderPreferenceStore } from '../src/js/core/state/render-preference-store.ts';
import { resetThemePreferenceState } from '../src/js/core/theme-preferences.ts';
import { resetDeviceDetectCache } from '../src/js/utils/browser/device-detect.ts';

beforeEach(() => {
  resetRenderPreferenceStore();
  resetMotionPreferenceState();
  resetSettingsPanelState();
  resetPerformancePanelState();
  resetThemePreferenceState();
  // isMobileDevice() memoises its answer (397e4545), so a test that swaps in a
  // mobile navigator gets the previous test's verdict unless the memo is
  // cleared. Tests that carefully build a fake navigator in their own
  // beforeEach were silently reading stale values.
  resetDeviceDetectCache();
  resetDeviceProfileCache();
});

afterEach(() => {
  resetRenderPreferenceStore();
  resetMotionPreferenceState();
  resetSettingsPanelState();
  resetPerformancePanelState();
  resetThemePreferenceState();
  // isMobileDevice() memoises its answer (397e4545), so a test that swaps in a
  // mobile navigator gets the previous test's verdict unless the memo is
  // cleared. Tests that carefully build a fake navigator in their own
  // beforeEach were silently reading stale values.
  resetDeviceDetectCache();
  resetDeviceProfileCache();
});

export {
  advanceAnimationFrames,
  flushAnimationFrame,
  resetAnimationFrameController,
} from './environment/animation-frame.ts';
export { getDomWindow, installDomEnvironment } from './environment/dom.ts';
export { installMockGpu, resetMockGpu } from './environment/webgpu.ts';
