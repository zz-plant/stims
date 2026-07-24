import { afterEach, expect, mock, test } from 'bun:test';
import { createToyViewportSession } from '../../src/js/core/toy-viewport-session.ts';
import { replaceProperty } from '../test-helpers.ts';

let restoreMatchMedia = () => {};

afterEach(() => {
  restoreMatchMedia();
  restoreMatchMedia = () => {};
});

test('toy viewport session supports legacy MediaQueryList listeners', () => {
  const addListener = mock();
  const removeListener = mock();
  restoreMatchMedia = replaceProperty(window, 'matchMedia', () => ({
    matches: true,
    media: '(resolution: 1dppx)',
    onchange: null,
    addListener,
    removeListener,
    dispatchEvent: () => false,
  }));

  const session = createToyViewportSession({
    container: null,
    onResize: mock(),
  });

  expect(addListener).toHaveBeenCalledTimes(1);
  session.dispose();
  expect(removeListener).toHaveBeenCalledTimes(1);
});
