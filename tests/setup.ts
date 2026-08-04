import { afterEach, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
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

    build.onResolve({ filter: /\.ts\?worklet$/ }, (args) => {
      const filePath = resolvePath(
        dirname(args.importer),
        args.path.replace(/\?worklet$/, ''),
      );
      return { path: `${filePath}?worklet`, namespace: 'stims-worklet-suffix' };
    });
    build.onLoad(
      { filter: /\.ts\?worklet$/, namespace: 'stims-worklet-suffix' },
      (args) => {
        const filePath = args.path.replace(/\?worklet$/, '');
        const source = readFileSync(filePath, 'utf8');
        return {
          contents: `export default ${JSON.stringify(source)}`,
          loader: 'js',
        };
      },
    );
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
