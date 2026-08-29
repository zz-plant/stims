import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { AudioVuStrip } from '../../src/js/frontend/AudioVuStrip.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

describe('AudioVuStrip', () => {
  test('renders the master energy meter and 3 band meters', () => {
    const rendered = renderWorkspace(createElement(AudioVuStrip));
    expect(rendered.container.querySelector('section')).not.toBeNull();
    expect(rendered.container.textContent).toContain('ENERGY');
    expect(rendered.container.textContent).toContain('BASS');
    expect(rendered.container.textContent).toContain('MID');
    expect(rendered.container.textContent).toContain('TREB');
    rendered.dispose();
  });
});
