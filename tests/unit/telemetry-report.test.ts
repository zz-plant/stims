import { describe, expect, test } from 'bun:test';
import {
  buildReports,
  EXCLUDED_DAYS,
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

describe('dwell reports', () => {
  const dwellReport = (title: string) =>
    buildReports(30).find((report) => report.title.startsWith(title));

  // Means here are set by tabs left open overnight, so a report that loses
  // its median says "phones 16 s, desktops 194 s" about a 2 s difference.
  test.each([
    ['Dwell and frame rate by screen', 'renderer'],
    ['Dwell by screen and audio source', 'audio'],
    ['Dwell by screen and arrival', 'arrival'],
  ])('%s has a median per device, orientation and %s', (title, split) => {
    const report = dwellReport(title);
    expect(report?.sql).toContain(
      'quantileWeighted(0.5)(double4, 1) AS median_dwell_ms',
    );
    expect(report?.columns).toEqual(
      expect.arrayContaining([
        'device',
        'orientation',
        split,
        'views',
        'median_dwell_ms',
        'avg_dwell_ms',
      ]),
    );
  });

  test('every report leaves out the Android spike day', () => {
    expect(EXCLUDED_DAYS).toContainEqual({
      from: '2026-11-03 00:00:00',
      to: '2026-11-04 00:00:00',
    });
    for (const report of buildReports(30)) {
      expect(report.sql).toContain(
        "(timestamp < toDateTime('2026-11-03 00:00:00') OR timestamp >= toDateTime('2026-11-04 00:00:00'))",
      );
    }
  });
});

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
