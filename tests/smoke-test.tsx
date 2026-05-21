import { describe, expect, test } from 'bun:test';
import { createRoot } from 'react-dom/client';

describe('smoke', () => {
  test('createRoot renders React element', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const container = document.getElementById('root');
    if (!container) {
      throw new Error('Expected root container to exist.');
    }
    const root = createRoot(container);
    root.render(<div data-testid="hello">Hi</div>);
    const el = container.querySelector('[data-testid="hello"]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('Hi');
    root.unmount();
    document.body.innerHTML = '';
  });
});
