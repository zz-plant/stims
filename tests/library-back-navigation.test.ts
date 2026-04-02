import { describe, expect, mock, test } from 'bun:test';
import {
  bindLibraryBackLink,
  navigateBackToLibrary,
  shouldUseHistoryBackToLibrary,
} from '../assets/js/core/library-back-navigation.ts';

describe('library back navigation', () => {
  test('prefers history back when the referrer is the library surface', () => {
    const historyBack = mock();
    const win = {
      history: { back: historyBack },
      location: { href: 'https://example.com/milkdrop/' },
    } as unknown as Window & typeof globalThis;
    const doc = {
      referrer: 'https://example.com/',
    } as Document;

    expect(
      shouldUseHistoryBackToLibrary({
        doc,
        win,
        backHref: '/',
      }),
    ).toBe(true);

    navigateBackToLibrary({ doc, win, backHref: '/' });

    expect(historyBack).toHaveBeenCalledTimes(1);
  });

  test('falls back to the library href when there is no matching referrer', () => {
    const historyBack = mock();
    const win = {
      history: { back: historyBack },
      location: { href: 'https://example.com/milkdrop/' },
    } as unknown as Window & typeof globalThis;
    const doc = {
      referrer: '',
    } as Document;

    navigateBackToLibrary({ doc, win, backHref: '/' });

    expect(historyBack).not.toHaveBeenCalled();
    expect(win.location.href).toBe('/');
  });

  test('intercepts library back links so launch routes share behavior', () => {
    const link = document.createElement('a');
    link.href = 'https://example.com/';

    const historyBack = mock();
    const win = {
      history: { back: historyBack },
      location: { href: 'https://example.com/milkdrop/' },
    } as unknown as Window & typeof globalThis;
    const doc = {
      referrer: 'https://example.com/',
    } as Document;

    bindLibraryBackLink(link, {
      doc,
      win,
      backHref: link.href,
    });

    const event = new Event('click', { bubbles: true, cancelable: true });
    const dispatched = link.dispatchEvent(event);

    expect(dispatched).toBe(false);
    expect(historyBack).toHaveBeenCalledTimes(1);
  });
});
