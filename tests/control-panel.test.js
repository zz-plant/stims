import { afterEach, describe, expect, test } from 'bun:test';

function setUserAgent(userAgent) {
  Object.defineProperty(navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  });
}

const freshImport = async () =>
  import(
    `../assets/js/utils/control-panel.ts?t=${Date.now()}-${Math.random()}`
  );

const DEFAULT_DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const DEFAULT_MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

let originalUserAgent;

describe('control panel mobile affordances', () => {
  afterEach(() => {
    if (originalUserAgent) {
      setUserAgent(originalUserAgent);
    }
  });

  test('defaults to mobile-friendly idle preset when user agent is mobile', async () => {
    originalUserAgent = navigator.userAgent;
    setUserAgent(DEFAULT_MOBILE_UA);

    const { createControlPanel } = await freshImport();
    const panel = createControlPanel();

    expect(panel.getState()).toEqual({
      idleEnabled: false,
      paletteCycle: true,
      mobilePreset: true,
    });

    const checkboxes = panel.panel.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[2].checked).toBe(true);
  });

  test('keeps idle motion enabled on desktop while mobile preset stays off', async () => {
    originalUserAgent = navigator.userAgent;
    setUserAgent(DEFAULT_DESKTOP_UA);

    const { createControlPanel } = await freshImport();
    const panel = createControlPanel();

    expect(panel.getState()).toEqual({
      idleEnabled: true,
      paletteCycle: true,
      mobilePreset: false,
    });

    const checkboxes = panel.panel.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[2].checked).toBe(false);
  });
});
