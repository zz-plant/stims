import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createToyView } from '../assets/js/toy-view.ts';

function createMockRuntime() {
  const listeners = {
    onLoading: new Set(),
    onActive: new Set(),
    onError: new Set(),
    onDisposed: new Set(),
  };

  const emit = (event, payload) => listeners[event].forEach((listener) => listener(payload));

  return {
    listeners,
    emit,
    setContainer: mock(),
    onLoading: (listener) => {
      listeners.onLoading.add(listener);
      return () => listeners.onLoading.delete(listener);
    },
    onActive: (listener) => {
      listeners.onActive.add(listener);
      return () => listeners.onActive.delete(listener);
    },
    onError: (listener) => {
      listeners.onError.add(listener);
      return () => listeners.onError.delete(listener);
    },
    onDisposed: (listener) => {
      listeners.onDisposed.add(listener);
      return () => listeners.onDisposed.delete(listener);
    },
  };
}

describe('toy view helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toy-list"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('binds runtime events and registers back control once', () => {
    const view = createToyView();
    const runtime = createMockRuntime();
    const onBack = mock();

    view.bindRuntime(runtime);

    runtime.emit('onLoading', { toy: { slug: 'demo', title: 'Demo Toy' }, onBack });
    const container = document.querySelector('.active-toy-container');

    expect(container?.classList.contains('is-hidden')).toBe(false);
    const backControl = container?.querySelector('[data-back-to-library]');
    expect(backControl).not.toBeNull();
    expect(container?.querySelectorAll('[data-back-to-library]')).toHaveLength(1);
    expect(container?.querySelector('.active-toy-nav__title')?.textContent).toBe('Demo Toy');

    runtime.emit('onActive', { toy: { slug: 'demo' }, container });

    backControl?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('renders capability error with fallback actions from runtime event', () => {
    const view = createToyView();
    const runtime = createMockRuntime();
    const onBack = mock();
    const onContinue = mock();

    view.bindRuntime(runtime);

    runtime.emit('onError', {
      toy: { slug: 'webgpu-toy', title: 'Fancy WebGPU' },
      error: { type: 'capability', options: { allowFallback: true, onBack, onContinue } },
    });

    const status = document.querySelector('.active-toy-status.is-warning');
    expect(status).not.toBeNull();

    const buttons = status?.querySelectorAll('button');
    expect(buttons?.length).toBe(2);

    buttons?.[0].dispatchEvent(new Event('click', { bubbles: true }));
    buttons?.[1].dispatchEvent(new Event('click', { bubbles: true }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  test('renders import error message for TypeScript modules through runtime', () => {
    const view = createToyView();
    const runtime = createMockRuntime();

    view.bindRuntime(runtime);

    runtime.emit('onError', {
      toy: { slug: 'import-error', title: 'Broken Toy' },
      error: { type: 'import', options: { moduleUrl: 'assets/js/toys/broken.ts' } },
    });

    const status = document.querySelector('.active-toy-status.is-error');
    expect(status?.textContent).toContain('could not be compiled');
    expect(status?.querySelector('.active-toy-status__actions button')).not.toBeNull();
  });
});
