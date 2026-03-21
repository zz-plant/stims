import { afterEach, describe, expect, test } from 'bun:test';

function setUserAgent(userAgent) {
  Object.defineProperty(navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  });
}

const freshImport = async () =>
  import(`../assets/js/ui/system-controls.ts?t=${Date.now()}-${Math.random()}`);

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
    document.body.innerHTML = '';
  });

  test('defaults to mobile-friendly idle preset when user agent is mobile', async () => {
    originalUserAgent = navigator.userAgent;
    setUserAgent(DEFAULT_MOBILE_UA);

    const { initSystemControls } = await freshImport();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = initSystemControls(host, {
      includeVisualBehaviorControls: true,
    });

    expect(panel.getVisualBehaviorState()).toEqual({
      idleEnabled: false,
      paletteCycle: true,
      mobilePreset: true,
    });

    const checkboxes = panel.element.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[2].checked).toBe(true);
  });

  test('keeps idle motion enabled on desktop while mobile preset stays off', async () => {
    originalUserAgent = navigator.userAgent;
    setUserAgent(DEFAULT_DESKTOP_UA);

    const { initSystemControls } = await freshImport();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = initSystemControls(host, {
      includeVisualBehaviorControls: true,
    });

    expect(panel.getVisualBehaviorState()).toEqual({
      idleEnabled: true,
      paletteCycle: true,
      mobilePreset: false,
    });

    const checkboxes = panel.element.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[2].checked).toBe(false);
  });

  test('supports embedding system controls inside another panel', async () => {
    const { initSystemControls } = await freshImport();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = initSystemControls(host, {
      variant: 'embedded',
    });

    expect(panel.element.classList.contains('control-panel--embedded')).toBe(
      true,
    );
    expect(panel.element.classList.contains('control-panel--inline')).toBe(
      false,
    );
  });
});
