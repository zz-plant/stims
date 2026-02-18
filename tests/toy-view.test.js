import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createToyView } from '../assets/js/toy-view.ts';

describe('toy view helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toy-list"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('shows active view and registers back control once', () => {
    const view = createToyView();
    const onBack = mock();

    const container = view.showActiveToyView(onBack, {
      slug: 'demo',
      title: 'Demo Toy',
    });

    expect(container?.classList.contains('is-hidden')).toBe(false);
    const backControl = container?.querySelector('[data-back-to-library]');
    expect(backControl).not.toBeNull();
    expect(container?.querySelectorAll('[data-back-to-library]')).toHaveLength(
      1,
    );
    expect(
      container?.querySelector('.active-toy-nav__title')?.textContent,
    ).toBe('Demo Toy');

    backControl?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('renders capability error with fallback actions', () => {
    const view = createToyView();
    const onBack = mock();
    const onContinue = mock();
    const onBrowseCompatible = mock();

    const status = view.showCapabilityError(
      { slug: 'webgpu-toy', title: 'Fancy WebGPU' },
      { allowFallback: true, onBack, onContinue, onBrowseCompatible },
    );

    expect(status?.classList.contains('is-warning')).toBe(true);

    const buttons = status?.querySelectorAll('button');
    expect(buttons?.length).toBe(3);

    buttons?.[0].dispatchEvent(new Event('click', { bubbles: true }));
    buttons?.[1].dispatchEvent(new Event('click', { bubbles: true }));
    buttons?.[2].dispatchEvent(new Event('click', { bubbles: true }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onBrowseCompatible).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  test('renders compatibility mode recovery action when available', () => {
    const view = createToyView();
    const onUseWebGPU = mock();

    const status = view.showCapabilityError(
      { slug: 'webgpu-toy', title: 'Fancy WebGPU' },
      {
        allowFallback: true,
        compatibilityModeEnabled: true,
        onUseWebGPU,
        onContinue: mock(),
      },
    );

    expect(status?.querySelector('h2')?.textContent).toContain(
      'Compatibility mode is enabled',
    );
    const buttons = status?.querySelectorAll('button');
    expect(buttons?.length).toBe(4);
    expect(buttons?.[2]?.textContent).toContain('Use WebGPU');

    buttons?.[2].dispatchEvent(new Event('click', { bubbles: true }));
    expect(onUseWebGPU).toHaveBeenCalledTimes(1);
  });

  test('renders import error message for TypeScript modules', () => {
    const view = createToyView();
    const status = view.showImportError(
      { slug: 'import-error', title: 'Broken Toy' },
      { moduleUrl: 'assets/js/toys/broken.ts' },
    );

    expect(status?.textContent).toContain('could not start on this setup yet');
    expect(
      status?.querySelector('.active-toy-status__actions button'),
    ).not.toBeNull();
  });
});
