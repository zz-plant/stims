import { describe, expect, test } from 'bun:test';
import { onRequest as presetsRequest } from '../../functions/api/presets.ts';

type PreparedCall = {
  sql: string;
  params: unknown[];
};

function createD1Mock(firstResults: unknown[]) {
  const calls: PreparedCall[] = [];
  const runSql: string[] = [];

  return {
    calls,
    runSql,
    db: {
      prepare(sql: string) {
        const call: PreparedCall = { sql, params: [] };
        calls.push(call);
        return {
          bind(...params: unknown[]) {
            call.params = params;
            return this;
          },
          async first<T = unknown>() {
            return (firstResults.shift() ?? null) as T | null;
          },
          async all<T = unknown>() {
            return { results: [] as T[] };
          },
          async run() {
            runSql.push(sql);
            return { success: true };
          },
        };
      },
    },
  };
}

describe('presets API', () => {
  test('toggles a community preset favorite on for the current session', async () => {
    const { db, calls, runSql } = createD1Mock([null]);
    const response = await presetsRequest({
      request: new Request(
        'https://toil.fyi/api/presets/community:aurora/favorite',
        {
          method: 'POST',
          headers: { 'x-stims-session-id': 'session-1' },
        },
      ),
      env: {
        DB: db,
        GALLERY_R2: {
          put: async () => {},
          get: async () => null,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ favorited: true });
    expect(calls[0]?.params).toEqual(['aurora', 'session-1']);
    expect(runSql.some((sql) => sql.includes('INSERT INTO favorites'))).toBe(
      true,
    );
    expect(runSql.some((sql) => sql.includes('rating = rating + 1'))).toBe(
      true,
    );
  });

  test('toggles a community preset favorite off when already saved', async () => {
    const { db, runSql } = createD1Mock([{ id: 12 }]);
    const response = await presetsRequest({
      request: new Request(
        'https://toil.fyi/api/presets/community:aurora/favorite',
        {
          method: 'POST',
          headers: { 'x-stims-session-id': 'session-1' },
        },
      ),
      env: {
        DB: db,
        GALLERY_R2: {
          put: async () => {},
          get: async () => null,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ favorited: false });
    expect(runSql.some((sql) => sql.includes('DELETE FROM favorites'))).toBe(
      true,
    );
    expect(runSql.some((sql) => sql.includes('rating = MAX'))).toBe(true);
  });
});
