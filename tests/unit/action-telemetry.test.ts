import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  installActionClickTelemetry,
  noteActionUse,
  resetActionTelemetryForTests,
} from '../../src/js/core/services/action-telemetry.ts';
import { resetTelemetryContextForTests } from '../../src/js/core/services/telemetry-context.ts';
import { useKeyboardShortcuts } from '../../src/js/frontend/hooks/useKeyboardShortcuts.ts';

/**
 * Which actions visitors run, and from which surface: one `action:<id>`
 * beacon per action and surface per page load.
 */

type Beacon = { url: string; body: Record<string, unknown> };
const pending: Promise<void>[] = [];
const flush = async () => {
  await Promise.all(pending.splice(0, pending.length));
};

let beacons: Beacon[] = [];
let originalLocation: PropertyDescriptor | undefined;
let originalNavigator: PropertyDescriptor | undefined;
let teardown: (() => void) | null = null;

beforeEach(() => {
  beacons = [];
  resetActionTelemetryForTests();
  resetTelemetryContextForTests();
  originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  // Local hosts never post; production's does.
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname: 'toil.fyi', origin: 'https://toil.fyi' },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      sendBeacon: (url: string, blob: Blob) => {
        pending.push(
          blob.text().then((text) => {
            beacons.push({ url, body: JSON.parse(text) });
          }),
        );
        return true;
      },
    },
  });
});

afterEach(() => {
  teardown?.();
  teardown = null;
  document.body.replaceChildren();
  resetTelemetryContextForTests();
  for (const [name, descriptor] of [
    ['location', originalLocation],
    ['navigator', originalNavigator],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

const sent = () => beacons.map(({ body }) => `${body.event}@${body.surface}`);

describe('noteActionUse', () => {
  test('sends one beacon per action and surface for the page load', async () => {
    noteActionUse('open-editor', 'menu');
    noteActionUse('open-editor', 'menu');
    noteActionUse('open-editor', 'key');
    await flush();
    expect(sent()).toEqual([
      'action:open-editor@menu',
      'action:open-editor@key',
    ]);
    expect(beacons[0]?.url).toBe('https://toil.fyi/api/telemetry');
  });

  test('drops anything that is not one of our ids', async () => {
    noteActionUse('https://example.com/?q=secret', 'other');
    noteActionUse('Open Editor', 'menu');
    noteActionUse('', 'menu');
    await flush();
    expect(beacons).toEqual([]);
  });
});

describe('installActionClickTelemetry', () => {
  function control(surface: string | null, action: string) {
    const host = document.createElement('div');
    if (surface) host.setAttribute('data-telemetry-surface', surface);
    const button = document.createElement('button');
    button.setAttribute('data-action', action);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    button.append(icon);
    host.append(button);
    document.body.append(host);
    return { button, icon };
  }

  const click = (target: Element) =>
    target.dispatchEvent(new Event('click', { bubbles: true }));

  test('names the action and the nearest surface, icon clicks included', async () => {
    teardown = installActionClickTelemetry(document);
    const menu = control('menu', 'open-editor');
    const bar = control('dock', 'next-preset');
    click(menu.icon);
    click(bar.button);
    await flush();
    expect(sent()).toEqual([
      'action:open-editor@menu',
      'action:next-preset@dock',
    ]);
  });

  test('a control on no tagged surface reads as other; a disabled one is not a use', async () => {
    teardown = installActionClickTelemetry(document);
    click(control(null, 'queue-add').button);
    const disabled = control('menu', 'open-record').button;
    disabled.setAttribute('disabled', '');
    click(disabled);
    await flush();
    expect(sent()).toEqual(['action:queue-add@other']);
  });

  test('stops listening once torn down', async () => {
    installActionClickTelemetry(document)();
    click(control('menu', 'open-editor').button);
    await flush();
    expect(beacons).toEqual([]);
  });
});

describe('keyboard shortcuts', () => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  function Keys() {
    useKeyboardShortcuts({
      liveMode: true,
      engineReady: true,
      panel: null,
      updatePanel: () => {},
      handlePresetSelection: () => {},
      handleShufflePreset: () => {},
      handlePreviousPreset: () => {},
      handleTogglePlayback: () => {},
      handleVisualSearch: async () => {},
      handleToggleFullscreen: () => {},
      setShowShortcuts: () => {},
    });
    return null;
  }

  test('a handled key is noted under the palette id of its binding', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(Keys)));
    const press = (key: string) =>
      document.dispatchEvent(
        // Cancelable like a real keydown: the hook notes what it
        // prevented, and an uncancelable event cannot be prevented.
        new window.KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
        }),
      );
    press('b');
    // Bound to nothing: no action ran, so nothing is noted.
    press('§');
    await flush();
    expect(sent()).toEqual(['action:open-browse@key']);
    act(() => root.unmount());
  });
});
