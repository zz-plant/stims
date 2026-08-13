import { afterEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { StageControls } from '../../src/js/frontend/StageControls.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

const originalNavigator = globalThis.navigator;

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

function openMenu() {
  const rendered = renderWorkspace(
    createElement(StageControls, {
      isFullscreen: false,
      onToggleFullscreen: () => {},
    }),
  );
  rendered.click(
    rendered.container.querySelector<HTMLButtonElement>('[aria-haspopup]'),
  );
  return rendered;
}

function menuLabels(container: Element) {
  return [...container.querySelectorAll('[role="menu"] button')].map((node) =>
    (node.textContent ?? '').trim(),
  );
}

describe('StageControls WebXR affordance', () => {
  test('is absent when the browser has no WebXR at all', async () => {
    setNavigator({ ...originalNavigator, xr: undefined });
    const rendered = openMenu();
    await Promise.resolve();

    const labels = menuLabels(rendered.container);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).not.toContain('Enter VR');

    rendered.dispose();
  });

  test('appears once an immersive-vr device is reported', async () => {
    setNavigator({
      ...originalNavigator,
      xr: {
        isSessionSupported: async () => true,
        requestSession: async () => {},
      },
    });
    const rendered = openMenu();
    // Let the async capability probe resolve and its state update paint.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(menuLabels(rendered.container)).toContain('Enter VR');

    rendered.dispose();
  });

  test('is absent when WebXR exists but reports no immersive-vr device', async () => {
    setNavigator({
      ...originalNavigator,
      xr: { isSessionSupported: async () => false },
    });
    const rendered = openMenu();
    await Promise.resolve();
    await Promise.resolve();

    expect(menuLabels(rendered.container)).not.toContain('Enter VR');

    rendered.dispose();
  });
});
