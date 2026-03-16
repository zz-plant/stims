import { describe, expect, test } from 'bun:test';
import {
  hideEmbeddedToyHud,
  isEmbeddedToyPage,
} from '../assets/js/utils/embedded-toy-page.ts';

describe('embedded toy page helpers', () => {
  test('detects embed mode from the query string', () => {
    const win = {
      location: { href: 'https://example.com/toys/holy.html?embed=1' },
    } as Window & typeof globalThis;

    expect(isEmbeddedToyPage(win)).toBe(true);
  });

  test('hides duplicated HUD elements for embedded toys', () => {
    document.body.innerHTML = `
      <div class="audio-panel"></div>
      <button id="start"></button>
    `;

    hideEmbeddedToyHud(['.audio-panel', '#start']);

    expect(document.querySelector<HTMLElement>('.audio-panel')?.hidden).toBe(
      true,
    );
    expect(document.querySelector<HTMLElement>('#start')?.hidden).toBe(true);
  });
});
