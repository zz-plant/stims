import { afterEach, describe, expect, test } from 'bun:test';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StimsErrorBoundary } from '../../src/js/frontend/ErrorBoundary.tsx';
import { replaceProperty } from '../test-helpers.ts';

describe('StimsErrorBoundary recovery details', () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;
  let restoreClipboard: (() => void) | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    restoreClipboard?.();
    host = null;
    root = null;
    restoreClipboard = null;
  });

  test('copies the non-duplicated error stack and confirms success', async () => {
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    let copied = '';
    restoreClipboard = replaceProperty(navigator, 'clipboard', {
      writeText: async (text: string) => {
        copied = text;
      },
    });
    const boundaryRef = createRef<StimsErrorBoundary>();
    const error = new Error('GPU pipeline failed');
    error.stack = 'Error: GPU pipeline failed\n    at render.ts:42:7';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <StimsErrorBoundary ref={boundaryRef}>
          <p>Visualizer</p>
        </StimsErrorBoundary>,
      );
      boundaryRef.current?.setState({ error });
    });

    const copyButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Copy error details',
    );
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.click();
      await Promise.resolve();
    });

    expect(copied).toBe(error.stack);
    expect(copyButton?.textContent).toBe('Copied error details');
  });
});
