/**
 * A quiet toast reaches screen readers through the same live region as any
 * other toast, without drawing a card over the stage.
 */
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { WorkspaceToast } from '../../src/js/frontend/WorkspaceToast.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

describe('WorkspaceToast', () => {
  test.each([
    [true, 'stims-shell__sr-only'],
    [false, 'stims-shell__toast'],
  ])('quiet=%p renders a polite status with class %s', (quiet, className) => {
    const rendered = renderWorkspace(
      createElement(WorkspaceToast, {
        toast: { message: 'Loaded Alpha.', tone: 'info', quiet },
      }),
    );

    const status = rendered.container.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('Loaded Alpha.');
    expect(status?.className).toBe(className);

    rendered.dispose();
  });
});
