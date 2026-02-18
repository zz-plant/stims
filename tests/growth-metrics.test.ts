import { beforeEach, describe, expect, test } from 'bun:test';

import {
  getGrowthSnapshot,
  recordLibraryVisit,
  recordOpportunityContact,
  recordOpportunityInterest,
  recordSegmentPlanContact,
  recordSegmentPlanViewed,
  recordToyOpen,
} from '../assets/js/utils/growth-metrics.ts';

describe('growth metrics', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('tracks active days and toy opens', () => {
    recordLibraryVisit();
    recordToyOpen('aurora-painter', 'library');

    const snapshot = getGrowthSnapshot();
    expect(snapshot.weeklyActiveDays).toBeGreaterThanOrEqual(1);
    expect(snapshot.toyOpens).toBe(1);
    expect(snapshot.recentToySlugs).toEqual(['aurora-painter']);
  });

  test('emits non-persistent opportunity signals', () => {
    let opportunityEvents = 0;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ name: string }>).detail;
      if (detail?.name === 'opportunity_interest') {
        opportunityEvents += 1;
      }
    };

    window.addEventListener('stims:growth-event', handler as EventListener);
    recordOpportunityInterest('creator-mode');
    recordOpportunityContact('creator-mode');
    window.removeEventListener('stims:growth-event', handler as EventListener);

    expect(opportunityEvents).toBe(1);
    const raw = window.localStorage.getItem('stims-growth-metrics-v1') ?? '';
    expect(raw).not.toContain('opportunitySignals');
  });

  test('emits non-persistent segment signals', () => {
    let segmentEvents = 0;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ name: string }>).detail;
      if (detail?.name === 'segment_plan_viewed') {
        segmentEvents += 1;
      }
    };

    window.addEventListener('stims:growth-event', handler as EventListener);
    recordSegmentPlanViewed('education-enrichment');
    recordSegmentPlanContact('education-enrichment');
    window.removeEventListener('stims:growth-event', handler as EventListener);

    expect(segmentEvents).toBe(1);
    const raw = window.localStorage.getItem('stims-growth-metrics-v1') ?? '';
    expect(raw).not.toContain('segmentSignals');
  });
});
