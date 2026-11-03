import { describe, expect, test } from 'bun:test';
import { onRequest } from '../../functions/api/telemetry.ts';
import {
  buildReports,
  OPEN_ONE_UP_FUNNEL_STEPS,
} from '../../scripts/telemetry-report.ts';

/**
 * The "Open one up funnel" report is the moment's growth instrument
 * (docs/PRODUCT_MOMENTS.md). Its step list is the contract: the funnel
 * means audible start → editor opened → first edit → shared or saved, and
 * since the 2026-10-09 split the first-edit step has three events (the
 * frozen guide button, the first typed code edit, the first committed Tune
 * control). Dropping or renaming a step quietly changes what the printed
 * funnel claims, so the built query is pinned here.
 */

const funnelReport = (days = 7) =>
  buildReports(days).find((report) =>
    report.title.startsWith('Open one up funnel'),
  );

const selectedSteps = (sql: string): string[] => {
  const inList = sql.match(/blob1 IN \(([^)]+)\)/u)?.[1] ?? '';
  return inList.split(',').map((step) => step.trim().replace(/^'|'$/gu, ''));
};

describe('open one up funnel report', () => {
  test('counts the three first-edit events, after the earlier steps', () => {
    const steps: string[] = [...OPEN_ONE_UP_FUNNEL_STEPS];
    const order = (step: string) => steps.indexOf(step);
    expect(steps).toContain('growth-audio-started');
    expect(steps).toContain('growth-editor-opened');
    // The frozen guide button keeps its own event and its own meaning.
    expect(steps).toContain('growth-first-edit-applied');
    // The two new steps from the 2026-10-09 split are now part of the funnel.
    expect(steps).toContain('growth-first-code-edit-applied');
    expect(steps).toContain('growth-first-tune-edit-applied');
    // Funnel order: every first-edit step comes after the editor open.
    expect(order('growth-first-code-edit-applied')).toBeGreaterThan(
      order('growth-editor-opened'),
    );
    expect(order('growth-first-tune-edit-applied')).toBeGreaterThan(
      order('growth-editor-opened'),
    );
  });

  test('the funnel query selects exactly the funnel steps, split by device', () => {
    const report = funnelReport();
    expect(report).toBeDefined();
    const sql = report?.sql ?? '';
    expect(selectedSteps(sql)).toEqual([...OPEN_ONE_UP_FUNNEL_STEPS]);
    // The device split is what keeps phones and desktops from being averaged
    // together; a funnel that drops it answers a different question.
    expect(sql).toContain("blob7 != ''");
    expect(report?.columns).toContain('device');
  });

  test('no other report grew the funnel step list', () => {
    const reports = buildReports(7);
    expect(
      reports.filter((report) => report.title.startsWith('Open one up funnel')),
    ).toHaveLength(1);
    // The lookback window stays the script's only knob.
    expect(funnelReport(30)?.title).toContain('last 30d');
  });
});

/**
 * Analytics Engine addresses columns by position, so a report reading the
 * wrong slot prints a plausible table of something else. These write a beacon
 * through the real Worker and read back the slot each report names.
 */
describe('audible starts by OS and engine', () => {
  const report = (prefix: string) => {
    const found = buildReports(7).find((candidate) =>
      candidate.title.startsWith(prefix),
    );
    if (!found) throw new Error(`no report titled ${prefix}`);
    return found;
  };

  const writtenPoint = async () => {
    const points: { blobs?: string[]; doubles?: number[] }[] = [];
    await onRequest({
      request: new Request('https://toil.fyi/api/telemetry', {
        method: 'POST',
        body: JSON.stringify({
          event: 'growth-audio-started',
          device: 'phone',
          os: 'android',
          engine: 'chromium',
          engineMajor: 117,
          androidWebView: true,
        }),
      }),
      env: {
        STIMS_TELEMETRY: { writeDataPoint: (point) => points.push(point) },
      },
    });
    const point = points[0];
    if (!point) throw new Error('the Worker wrote no data point');
    return point;
  };

  const readColumn = (
    sql: string,
    alias: string,
    point: { blobs?: string[]; doubles?: number[] },
  ) => {
    const match = sql.match(
      new RegExp(`(blob|double)(\\d+) AS ${alias}\\b`, 'u'),
    );
    if (!match) throw new Error(`no column aliased ${alias}`);
    const values = match[1] === 'blob' ? point.blobs : point.doubles;
    return values?.[Number(match[2]) - 1];
  };

  test('the OS report reads the slots the Worker writes OS and device to', async () => {
    const { sql } = report('Audible starts by OS');
    const point = await writtenPoint();
    expect(readColumn(sql, 'os', point)).toBe('android');
    expect(readColumn(sql, 'device', point)).toBe('phone');
  });

  test('the engine report reads the slots the Worker writes the engine to', async () => {
    const { sql } = report('Audible starts by engine major version');
    const point = await writtenPoint();
    expect(readColumn(sql, 'engine', point)).toBe('chromium');
    expect(readColumn(sql, 'major', point)).toBe(117);
    expect(readColumn(sql, 'webview', point)).toBe('webview');
  });

  test('both count audible starts and leave out rows older than the fields', () => {
    for (const prefix of [
      'Audible starts by OS',
      'Audible starts by engine major version',
    ]) {
      const { sql, columns } = report(prefix);
      expect(sql).toContain("blob1 = 'growth-audio-started'");
      expect(sql).toMatch(/blob1[12] != ''/u);
      expect(columns).toContain('count');
    }
  });

  test('sorts engine versions by number, newest first', () => {
    const { sql } = report('Audible starts by engine major version');
    expect(sql).toContain('ORDER BY engine, major DESC');
    expect(sql).toContain('double5 AS major');
  });
});
