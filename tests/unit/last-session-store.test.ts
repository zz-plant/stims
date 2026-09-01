import { describe, expect, test } from 'bun:test';

/**
 * hadSessionBeforeBoot must reflect what storage held BEFORE the app booted,
 * not whatever the current session has since written. The store captures the
 * snapshot at module evaluation, so each scenario imports a fresh copy of the
 * module (cache-busted) after arranging storage.
 */
const STORAGE_KEY = 'stims:last-session';

const session = JSON.stringify({
  presetId: 'krash-rovastar-cerebral-demons-stars',
  presetTitle: 'Krash & Rovastar - Cerebral Demons (Stars Remix)',
  source: 'demo',
  savedAt: 1756600000000,
});

async function importFresh(tag: string) {
  return import(`../../src/js/core/state/last-session-store.ts?boot=${tag}`);
}

describe('hadSessionBeforeBoot', () => {
  test('false on a first visit, and unmoved by a save during the session', async () => {
    localStorage.removeItem(STORAGE_KEY);
    const store = await importFresh('first-visit');
    expect(store.hadSessionBeforeBoot()).toBe(false);

    // The current session saving (what happens as soon as audio starts) must
    // not flip the boot snapshot — that is the whole reason it exists.
    store.saveLastSession({
      presetId: 'krash-rovastar-cerebral-demons-stars',
      presetTitle: 'Krash & Rovastar - Cerebral Demons (Stars Remix)',
      source: 'demo',
    });
    expect(store.hadSessionBeforeBoot()).toBe(false);
    localStorage.removeItem(STORAGE_KEY);
  });

  test('true when a previous session was saved before boot', async () => {
    localStorage.setItem(STORAGE_KEY, session);
    const store = await importFresh('return-visit');
    expect(store.hadSessionBeforeBoot()).toBe(true);
    localStorage.removeItem(STORAGE_KEY);
  });
});
