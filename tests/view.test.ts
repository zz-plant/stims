import { describe, expect, mock, test } from 'bun:test';

import { createToyView } from '../assets/js/core/view.ts';

function createDocument() {
  const doc = document.implementation.createHTMLDocument('view');
  const toyList = doc.createElement('div');
  toyList.id = 'toy-list';
  doc.body.appendChild(toyList);
  return { doc, toyList };
}

describe('toy view helper', () => {
  test('shows active toy view and wires back control', () => {
    const { doc, toyList } = createDocument();
    const onBack = mock();
    const view = createToyView({
      document: doc,
      host: doc.body,
      toyList,
      onBackToLibrary: onBack,
    });

    const container = view.showActiveToyView();
    const backControl = container?.querySelector('[data-back-to-library]');

    expect(container?.classList.contains('is-hidden')).toBe(false);
    expect(toyList.classList.contains('is-hidden')).toBe(true);
    expect(backControl).not.toBeNull();

    backControl?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('renders import errors with retry affordance', () => {
    const { doc, toyList } = createDocument();
    const onBack = mock();
    const view = createToyView({
      document: doc,
      host: doc.body,
      toyList,
      onBackToLibrary: onBack,
    });

    view.showImportError(
      { title: 'Example Toy' },
      { moduleUrl: 'assets/js/toys/example.ts', importError: new Error('MIME') }
    );

    const status = doc.querySelector('.active-toy-status.is-error');
    expect(status?.querySelector('h2')?.textContent).toContain('Unable to load this toy');
    expect(status?.querySelector('p')?.textContent).toContain('Example Toy');

    const retry = status?.querySelector('button');
    retry?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('shows capability errors', () => {
    const { doc, toyList } = createDocument();
    const view = createToyView({
      document: doc,
      host: doc.body,
      toyList,
    });

    view.showCapabilityError({ title: 'Fancy WebGPU' });

    const status = doc.querySelector('.active-toy-status.is-error');
    expect(status?.querySelector('h2')?.textContent).toContain('WebGPU not available');
    expect(status?.querySelector('p')?.textContent).toContain('Fancy WebGPU');
  });
});
