import { expect, test } from 'bun:test';
import {
  getDomWindow,
  installDomEnvironment,
  resetDomEnvironment,
} from '../environment/dom.ts';

/**
 * Bun runs many test files in one process, and `tests/setup.ts` installs the
 * DOM once as the ambient baseline for all of them — most files never install
 * it themselves, they just use `document`. So a file whose teardown *removed*
 * the globals broke whichever file happened to run next, with a
 * `ReferenceError: document is not defined` far from its cause and a pass when
 * that file was run alone. Guard the invariant directly.
 */
test('resetting the DOM environment leaves a usable document behind', () => {
  resetDomEnvironment();

  expect(typeof document).toBe('object');
  expect(typeof window).toBe('object');

  // Usable, not merely defined.
  document.body.innerHTML = '<div id="probe"></div>';
  expect(document.getElementById('probe')).not.toBeNull();
  document.body.innerHTML = '';
});

test('resetting swaps in a fresh window rather than reusing the old one', () => {
  const before = getDomWindow();
  document.body.innerHTML = '<div id="stale"></div>';

  const after = resetDomEnvironment();

  expect(after).not.toBe(before);
  expect(getDomWindow()).toBe(after);
  expect(document.getElementById('stale')).toBeNull();
});

test('installing is itself repeatable', () => {
  const first = installDomEnvironment();
  const second = installDomEnvironment();

  expect(second).not.toBe(first);
  expect(typeof document).toBe('object');
});
