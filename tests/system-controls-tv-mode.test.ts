import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  COMPATIBILITY_MODE_KEY,
  MAX_PIXEL_RATIO_KEY,
  RENDER_SCALE_KEY,
  resetRenderPreferencesState,
} from '../assets/js/core/render-preferences.ts';
import { resetSettingsPanelState } from '../assets/js/core/settings-panel.ts';
import { importFresh, replaceProperty } from './test-helpers.ts';

const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36';
const TV_UA =
  'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko)';

let initSystemControls: typeof import('../assets/js/ui/system-controls.ts').initSystemControls;
let restoreUserAgent = () => {};

describe('system controls tv defaults', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = '';
    resetRenderPreferencesState();
    resetSettingsPanelState({ removePanel: true });
    const systemControlsModule = await importFresh<
      typeof import('../assets/js/ui/system-controls.ts')
    >('../assets/js/ui/system-controls.ts');
    initSystemControls = systemControlsModule.initSystemControls;
  });

  afterEach(() => {
    restoreUserAgent();
    restoreUserAgent = () => {};
    localStorage.clear();
    document.body.innerHTML = '';
    resetRenderPreferencesState();
    resetSettingsPanelState({ removePanel: true });
  });

  test('applies tv defaults when no render preferences are stored', () => {
    restoreUserAgent = replaceProperty(navigator, 'userAgent', TV_UA);
    const host = document.createElement('div');
    document.body.appendChild(host);

    initSystemControls(host);

    const presetSelect = host.querySelector('select');
    expect(presetSelect).toBeTruthy();
    expect((presetSelect as HTMLSelectElement).value).toBe('tv');

    expect(localStorage.getItem(COMPATIBILITY_MODE_KEY)).toBe('true');
    expect(localStorage.getItem(MAX_PIXEL_RATIO_KEY)).toBe('1.25');
    expect(localStorage.getItem(RENDER_SCALE_KEY)).toBe('0.9');
  });

  test('does not overwrite existing stored render preferences', () => {
    restoreUserAgent = replaceProperty(navigator, 'userAgent', TV_UA);
    localStorage.setItem(COMPATIBILITY_MODE_KEY, 'false');
    localStorage.setItem(MAX_PIXEL_RATIO_KEY, '2');
    localStorage.setItem(RENDER_SCALE_KEY, '1');

    const host = document.createElement('div');
    document.body.appendChild(host);

    initSystemControls(host);

    expect(localStorage.getItem(COMPATIBILITY_MODE_KEY)).toBe('false');
    expect(localStorage.getItem(MAX_PIXEL_RATIO_KEY)).toBe('2');
    expect(localStorage.getItem(RENDER_SCALE_KEY)).toBe('1');
  });

  test('keeps non-tv defaults on desktop devices', () => {
    restoreUserAgent = replaceProperty(navigator, 'userAgent', DESKTOP_UA);
    const host = document.createElement('div');
    document.body.appendChild(host);

    initSystemControls(host);

    const presetSelect = host.querySelector(
      'select',
    ) as HTMLSelectElement | null;
    expect(presetSelect?.value).toBe('balanced');
  });
});
