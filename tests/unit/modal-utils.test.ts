import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getFocusableElements,
  restoreFocusIfPresent,
  trapFocusWithin,
} from '../../src/js/core/modal-utils.ts';

describe('modal-utils focus handling', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = '';
  });

  test('getFocusableElements identifies interactable focusable elements', () => {
    container.innerHTML = `
      <button id="btn1">Button 1</button>
      <a href="#" id="link1">Link 1</a>
      <input type="text" id="input1" />
      <button disabled id="disabledBtn">Disabled</button>
      <div tabindex="0" id="tabindexDiv">Focusable div</div>
      <div tabindex="-1" id="ignoredDiv">Non-focusable div</div>
      <div aria-hidden="true">
        <button id="hiddenBtn">Hidden Button</button>
      </div>
    `;

    const focusables = getFocusableElements(container);
    const ids = focusables.map((el) => el.id);

    expect(ids).toEqual(['btn1', 'link1', 'input1', 'tabindexDiv']);
  });

  test('trapFocusWithin traps Tab navigation inside container', () => {
    container.innerHTML = `
      <button id="btn1">First</button>
      <button id="btn2">Middle</button>
      <button id="btn3">Last</button>
    `;

    const cleanup = trapFocusWithin(container);
    const btn1 = container.querySelector('#btn1') as HTMLButtonElement;
    const btn3 = container.querySelector('#btn3') as HTMLButtonElement;

    btn3.focus();
    expect(document.activeElement).toBe(btn3);

    // Simulate Tab on last element
    const KeyboardEventCtor = window.KeyboardEvent || globalThis.KeyboardEvent;
    const tabEvent = new KeyboardEventCtor('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(tabEvent);
    expect(document.activeElement).toBe(btn1);

    // Simulate Shift+Tab on first element
    btn1.focus();
    const shiftTabEvent = new KeyboardEventCtor('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(shiftTabEvent);
    expect(document.activeElement).toBe(btn3);

    cleanup();
  });

  test('restoreFocusIfPresent restores focus to target element if connected', () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();
    expect(document.activeElement).toBe(other);

    restoreFocusIfPresent(trigger);
    expect(document.activeElement).toBe(trigger);
  });
});
