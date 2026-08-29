import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { ParityDiffOverlay } from '../../src/js/frontend/ParityDiffOverlay.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

describe('ParityDiffOverlay', () => {
  test('returns null when referenceUrl is null', () => {
    const rendered = renderWorkspace(
      createElement(ParityDiffOverlay, { referenceUrl: null }),
    );
    expect(rendered.container.querySelector('section')).toBeNull();
    rendered.dispose();
  });

  test('renders section when referenceUrl is provided', () => {
    const rendered = renderWorkspace(
      createElement(ParityDiffOverlay, {
        referenceUrl: 'https://example.com/ref.png',
      }),
    );
    expect(rendered.container.querySelector('section')).not.toBeNull();
    expect(rendered.container.querySelector('img')).not.toBeNull();
    rendered.dispose();
  });
});
