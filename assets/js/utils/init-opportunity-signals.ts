import {
  isValidMarketSegment,
  isValidOpportunityTrack,
  type MarketSegment,
  type OpportunityTrack,
  recordOpportunityContact,
  recordOpportunityInterest,
  recordSegmentPlanContact,
  recordSegmentPlanViewed,
} from './growth-metrics.ts';

const trackLabels: Record<OpportunityTrack, string> = {
  'creator-mode': 'Creator mode',
  'partnership-licensing': 'Partnership licensing',
  'facilitator-toolkit': 'Facilitator toolkit',
  'community-support': 'Community support',
};

type SegmentPlan = {
  label: string;
  topPriority: string;
  unlocks: string;
  pilotMetric: string;
  roadmap: string[];
};

const segmentPlans: Record<MarketSegment, SegmentPlan> = {
  'experiential-installations': {
    label: 'Experiential installations / activations',
    topPriority:
      'P1: Add kiosk defaults (auto demo-audio, fullscreen prompt, idle reset).',
    unlocks: 'Unlocks reliable unattended operation at events and popups.',
    pilotMetric:
      'Pilot KPI: average dwell time per attendee and repeat interactions per session.',
    roadmap: [
      'P1: Add kiosk defaults (auto demo-audio, fullscreen prompt, idle reset).',
      'P2: Publish a stable event setlist with fixed quality profiles for venue hardware.',
      'P3: Ship an operator runbook for setup, fallback, and live recovery.',
    ],
  },
  'wellness-focus-environments': {
    label: 'Wellness / focus environments',
    topPriority:
      'P1: Create low-stimulation preset bundles with calmer visuals and guided defaults.',
    unlocks:
      'Unlocks immediate fit for low-arousal spaces and comfort-sensitive sessions.',
    pilotMetric:
      'Pilot KPI: weekly returning sessions and completion rate for short guided sessions.',
    roadmap: [
      'P1: Create low-stimulation preset bundles with calmer visuals and guided defaults.',
      'P2: Introduce timed session modes (2/5/10 min) with gentle end cues.',
      'P3: Provide facilitator notes for mood-based toy selection and comfort settings.',
    ],
  },
  'education-enrichment': {
    label: 'Education enrichment',
    topPriority:
      'P1: Add classroom mode with simplified controls and larger touch targets.',
    unlocks:
      'Unlocks faster classroom starts with fewer teacher-side interventions.',
    pilotMetric:
      'Pilot KPI: teacher reuse across classes and successful classroom launches per week.',
    roadmap: [
      'P1: Add classroom mode with simplified controls and larger touch targets.',
      'P2: Bundle lesson prompts per toy (pattern, rhythm, color, interaction outcomes).',
      'P3: Offer admin-safe defaults (demo-audio first, no-mic required, quick class reset).',
    ],
  },
};

const validationSummary =
  'Growth-lab signals are sent to the configured server endpoint when enabled.';

const createDiscussionDraftUrl = (track: OpportunityTrack) => {
  const title = `Interest: ${trackLabels[track]}`;
  const body = [
    '## What I am interested in',
    `- Track: ${trackLabels[track]}`,
    '- Intended audience/context:',
    '- Expected outcomes:',
    '- Timeline or urgency:',
    '',
    '## Contact (optional)',
    '- Name/org:',
    '- Preferred follow-up channel:',
  ].join('\n');

  const params = new URLSearchParams({ category: 'ideas', title, body });
  return `https://github.com/zz-plant/stims/discussions/new?${params.toString()}`;
};

const createSegmentDiscussionUrl = (segment: MarketSegment) => {
  const plan = segmentPlans[segment];
  const title = `Pilot interest: ${plan.label}`;
  const body = [
    '## Segment pilot request',
    `- Segment: ${plan.label}`,
    '- Organization/environment:',
    '- Expected audience size:',
    '- Desired timeline:',
    '',
    '## Prioritized roadmap',
    ...plan.roadmap.map((step) => `- ${step}`),
    '',
    `## Unlock focus\n- ${plan.unlocks}`,
  ].join('\n');

  const params = new URLSearchParams({ category: 'ideas', title, body });
  return `https://github.com/zz-plant/stims/discussions/new?${params.toString()}`;
};

const setButtonActivatedState = (button: HTMLButtonElement, text: string) => {
  button.dataset.signalState = 'recorded';
  button.textContent = text;
  button.setAttribute('aria-pressed', 'true');
};

const isGrowthLabEnabled = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('growth-lab') === '1') return true;
  try {
    return window.localStorage.getItem('stims:growth-lab-enabled') === '1';
  } catch (_error) {
    return false;
  }
};

export const initOpportunitySignals = () => {
  const container = document.querySelector<HTMLElement>(
    '[data-opportunity-signals]',
  );
  if (!container) return;

  if (!isGrowthLabEnabled()) {
    container.setAttribute('hidden', '');
    return;
  }

  container.removeAttribute('hidden');

  const summary = container.querySelector<HTMLElement>(
    '[data-opportunity-summary]',
  );
  if (summary) summary.textContent = validationSummary;

  const prioritySelect = container.querySelector<HTMLSelectElement>(
    '[data-opportunity-priority-select]',
  );
  const interestButton = container.querySelector<HTMLButtonElement>(
    '[data-opportunity-action="interest"]',
  );
  const contactLink = container.querySelector<HTMLAnchorElement>(
    '[data-opportunity-action="contact"]',
  );

  const segmentSelect = container.querySelector<HTMLSelectElement>(
    '[data-segment-select]',
  );
  const segmentPriorityButton = container.querySelector<HTMLButtonElement>(
    '[data-segment-action="preview"]',
  );
  const segmentContactLink = container.querySelector<HTMLAnchorElement>(
    '[data-segment-action="contact"]',
  );
  const segmentOutcome = container.querySelector<HTMLElement>(
    '[data-segment-outcome]',
  );

  const getSelectedTrack = (): OpportunityTrack | null => {
    const selectedValue = prioritySelect?.value;
    return selectedValue && isValidOpportunityTrack(selectedValue)
      ? selectedValue
      : null;
  };

  const getSelectedSegment = (): MarketSegment | null => {
    const selectedValue = segmentSelect?.value;
    return selectedValue && isValidMarketSegment(selectedValue)
      ? selectedValue
      : null;
  };

  const syncTrackContactLink = () => {
    const selectedTrack = getSelectedTrack();
    if (contactLink && selectedTrack) {
      contactLink.href = createDiscussionDraftUrl(selectedTrack);
    }
  };

  const syncSegmentPresentation = (segment: MarketSegment) => {
    const plan = segmentPlans[segment];
    if (segmentOutcome) {
      segmentOutcome.textContent = `${plan.topPriority} ${plan.unlocks} ${plan.pilotMetric}`;
    }
    if (segmentContactLink) {
      segmentContactLink.href = createSegmentDiscussionUrl(segment);
    }
  };

  syncTrackContactLink();
  prioritySelect?.addEventListener('change', syncTrackContactLink);

  interestButton?.addEventListener('click', () => {
    const selectedTrack = getSelectedTrack();
    if (!selectedTrack) return;
    recordOpportunityInterest(selectedTrack);
    setButtonActivatedState(interestButton, 'Vote recorded ✓');
    if (summary) summary.textContent = validationSummary;
  });

  contactLink?.addEventListener('click', () => {
    const selectedTrack = getSelectedTrack();
    if (!selectedTrack) return;
    recordOpportunityContact(selectedTrack);
    if (summary) summary.textContent = validationSummary;
  });

  const initialSegment = getSelectedSegment();
  if (initialSegment) syncSegmentPresentation(initialSegment);

  segmentPriorityButton?.addEventListener('click', () => {
    const segment = getSelectedSegment();
    if (!segment) return;
    syncSegmentPresentation(segment);
    recordSegmentPlanViewed(segment);
    setButtonActivatedState(segmentPriorityButton, 'Priority recorded ✓');
    if (summary) summary.textContent = validationSummary;
  });

  segmentSelect?.addEventListener('change', () => {
    const segment = getSelectedSegment();
    if (!segment) return;
    syncSegmentPresentation(segment);
    if (segmentPriorityButton) {
      segmentPriorityButton.dataset.signalState = '';
      segmentPriorityButton.textContent = 'Mark segment priority';
    }
  });

  segmentContactLink?.addEventListener('click', () => {
    const segment = getSelectedSegment();
    if (!segment) return;
    recordSegmentPlanContact(segment);
    if (summary) summary.textContent = validationSummary;
  });
};
