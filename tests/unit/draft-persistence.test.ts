import { describe, expect, mock, test } from 'bun:test';
import {
  createDraftPersistence,
  createDraftSaveStatus,
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

describe('draft save status', () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const harness = () => {
    const writes: ReturnType<typeof deferred>[] = [];
    const unsaved: boolean[] = [];
    const failures: unknown[] = [];
    const status = createDraftSaveStatus({
      persist: () => {
        const write = deferred();
        writes.push(write);
        return write.promise;
      },
      onUnsavedChange: (value) => unsaved.push(value),
      onFailure: (error) => failures.push(error),
    });
    return { status, writes, unsaved, failures };
  };

  test('an edit is unsaved until its write lands', async () => {
    const { status, writes, unsaved } = harness();
    const saving = status.save('p', 'zoom=2');
    expect(unsaved).toEqual([true]);
    writes[0].resolve();
    await saving;
    expect(unsaved).toEqual([true, false]);
  });

  test('a failed write keeps the edit unsaved and is reported once', async () => {
    // Blocked or full IndexedDB: the edit exists only in this tab, so the
    // shell must keep warning before the page is left.
    const { status, writes, unsaved, failures } = harness();
    const first = status.save('p', 'zoom=2');
    writes[0].reject(new Error('QuotaExceededError'));
    await first;
    const second = status.save('p', 'zoom=3');
    writes[1].reject(new Error('QuotaExceededError'));
    await second;
    expect(unsaved).toEqual([true]);
    expect(failures).toHaveLength(1);
  });

  test('an older write landing late does not mark a newer edit saved', async () => {
    const { status, writes, unsaved } = harness();
    const older = status.save('p', 'zoom=2');
    const newer = status.save('p', 'zoom=3');
    writes[0].resolve();
    await older;
    expect(unsaved).toEqual([true]);
    writes[1].resolve();
    await newer;
    expect(unsaved).toEqual([true, false]);
  });

  test('a preset load clears the pending state', () => {
    const { status, unsaved } = harness();
    void status.save('p', 'zoom=2');
    status.reset();
    expect(unsaved).toEqual([true, false]);
  });
});
