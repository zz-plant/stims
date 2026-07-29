import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useFocusTrap } from '../../src/js/frontend/hooks/use-focus-trap.ts';
import { createToyContainer } from '../toy-test-helpers.ts';

function TestModal({ active }: { active: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>({
    active,
    autoFocus: true,
    restoreFocusOnUnmount: true,
  });

  if (!active) return null;

  return createElement(
    'div',
    { ref, tabIndex: -1, id: 'modal' },
    createElement('button', { type: 'button', id: 'modalBtn1' }, 'Modal Btn 1'),
    createElement('button', { type: 'button', id: 'modalBtn2' }, 'Modal Btn 2'),
  );
}

describe('useFocusTrap hook', () => {
  let toy: ReturnType<typeof createToyContainer>;
  let triggerBtn: HTMLButtonElement;

  beforeEach(() => {
    toy = createToyContainer('focus-trap-test');
    triggerBtn = document.createElement('button');
    triggerBtn.type = 'button';
    triggerBtn.id = 'triggerBtn';
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
  });

  afterEach(() => {
    triggerBtn.remove();
    toy.dispose();
    document.body.innerHTML = '';
  });

  test('autoFocuses first focusable element when active and restores focus on unmount', () => {
    const root = createRoot(toy.container);

    expect(document.activeElement).toBe(triggerBtn);

    flushSync(() => {
      root.render(createElement(TestModal, { active: true }));
    });

    const modalBtn1 = toy.container.querySelector('#modalBtn1');
    expect(document.activeElement).toBe(modalBtn1);

    flushSync(() => {
      root.render(createElement(TestModal, { active: false }));
    });

    expect(document.activeElement).toBe(triggerBtn);

    root.unmount();
  });
});
