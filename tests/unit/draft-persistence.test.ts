import { describe, expect, mock, test } from 'bun:test';
import {
  createDraftPersistence,
  createOriginalSourceResolver,
  dropRedundantDraft,
} from '../../src/js/milkdrop/draft-persistence.ts';
import { samePresetSource } from '../../src/js/milkdrop/overlay/source-diff.ts';

// What the editor shows on load is the formatted source, so that is the
// original every comparison here is made against.
const FORMATTED = 'title=Alpha\nzoom=1.000\n';

function fakeStore() {
  const drafts = new Map<string, string>();
  return {
    drafts,
    store: {
      async saveDraft(id: string, raw: string) {
        drafts.set(id, raw);
      },
      async clearDraft(id: string) {
        drafts.delete(id);
      },
      async getDraft(id: string) {
        return drafts.get(id) ?? null;
      },
    },
  };
}

const resolveTo = (original: string | null, delayFirstMs = 0) =>
  (() => {
    let calls = 0;
    return async (_id: string) => {
      calls += 1;
      if (delayFirstMs && calls === 1) {
        await new Promise((resolve) => setTimeout(resolve, delayFirstMs));
      }
      return original;
    };
  })();

describe('draft persistence', () => {
  test('keeps an edit as the draft', async () => {
    const { drafts, store } = fakeStore();
    await createDraftPersistence(store, resolveTo(FORMATTED))(
      'alpha',
      'title=Alpha\nzoom=1.5\n',
    );
    expect(drafts.get('alpha')).toBe('title=Alpha\nzoom=1.5\n');
  });

  test('an edit taken back to the original leaves no draft', async () => {
    const { drafts, store } = fakeStore();
    const persist = createDraftPersistence(store, resolveTo(FORMATTED));
    await persist('alpha', 'title=Alpha\nzoom=1.5\n');
    await persist('alpha', 'title=Alpha\r\nzoom=1.000   \n\n');
    expect(drafts.has('alpha')).toBe(false);
  });

  test('writes land in the order they were asked for', async () => {
    // The first lookup is the slow one: unserialized, its save would land
    // after the later clear and bring the reverted edit back.
    const { drafts, store } = fakeStore();
    const persist = createDraftPersistence(store, resolveTo(FORMATTED, 20));
    const first = persist('alpha', 'title=Alpha\nzoom=1.5\n');
    const second = persist('alpha', FORMATTED);
    await Promise.all([first, second]);
    expect(drafts.has('alpha')).toBe(false);
  });

  test('drops a stored draft that is only the original', async () => {
    const { drafts, store } = fakeStore();
    drafts.set('alpha', FORMATTED);
    drafts.set('beta', 'title=Beta\nzoom=2\n');
    expect(await dropRedundantDraft(store, resolveTo(FORMATTED), 'alpha')).toBe(
      true,
    );
    expect(await dropRedundantDraft(store, resolveTo(FORMATTED), 'beta')).toBe(
      false,
    );
    expect([...drafts.keys()]).toEqual(['beta']);
  });

  test('formats each original once while it stays the same', async () => {
    const format = mock(() => FORMATTED);
    const resolve = createOriginalSourceResolver(
      {
        async getPresetSource(id: string) {
          return {
            id,
            title: id,
            raw: 'title=Alpha\nzoom=1\n',
            origin: 'bundled' as const,
          };
        },
      },
      format,
    );
    expect(await resolve('alpha')).toBe(FORMATTED);
    expect(await resolve('alpha')).toBe(FORMATTED);
    expect(format).toHaveBeenCalledTimes(1);
  });

  test('compares as preset code, not as bytes', () => {
    expect(samePresetSource('a=1\r\nb=2  \n', 'a=1\nb=2')).toBe(true);
    expect(samePresetSource('a=1\nb=2', 'a=1\nb=3')).toBe(false);
  });
});
