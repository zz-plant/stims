import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { VmOscilloscope } from '../../src/js/frontend/VmOscilloscope.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

describe('VmOscilloscope', () => {
  test('renders the VM telemetry parameters', () => {
    const rendered = renderWorkspace(createElement(VmOscilloscope));
    expect(rendered.container.querySelector('section')).not.toBeNull();
    expect(rendered.container.textContent).toContain('VM OSC');
    expect(rendered.container.textContent).toContain('backend');
    expect(rendered.container.textContent).toContain('tempo');
    expect(rendered.container.textContent).toContain('zoom');
    expect(rendered.container.textContent).toContain('warp');
    rendered.dispose();
  });
});
