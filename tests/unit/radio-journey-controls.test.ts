import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { RadioJourneyControls } from '../../src/js/frontend/RadioJourneyControls.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

describe('RadioJourneyControls', () => {
  test('renders the radio journey toggle and triggers transitions', () => {
    const rendered = renderWorkspace(createElement(RadioJourneyControls), {
      engine: {
        handleShufflePreset: () => {},
      },
    });

    const button = rendered.container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('Start Radio Journey');

    if (button) {
      rendered.click(button);
    }
    expect(rendered.container.textContent).toContain('Radio ON');
    expect(rendered.container.querySelector('select')).not.toBeNull();

    rendered.dispose();
  });
});
