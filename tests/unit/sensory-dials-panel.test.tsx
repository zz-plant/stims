import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetSensoryTranslationServiceStateForTests } from '../../src/js/core/services/sensory-translation.ts';
import { SensoryDialsPanel } from '../../src/js/frontend/SensoryDialsPanel.tsx';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  resetSensoryTranslationServiceStateForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe('SensoryDialsPanel', () => {
  test('renders three sliders when open', () => {
    act(() => {
      root?.render(
        createElement(SensoryDialsPanel, { open: true, onClose: () => {} }),
      );
    });
    const sliders = container?.querySelectorAll('input[type="range"]');
    expect(sliders?.length).toBe(3);
  });

  test('renders nothing when closed', () => {
    act(() => {
      root?.render(
        createElement(SensoryDialsPanel, { open: false, onClose: () => {} }),
      );
    });
    expect(container?.querySelector('section')).toBeNull();
  });
});
