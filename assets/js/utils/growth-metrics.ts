type GrowthEventName =
  | 'library_visit'
  | 'toy_open'
  | 'toy_share'
  | 'premium_prompt_dismissed'
  | 'opportunity_interest'
  | 'opportunity_contact'
  | 'segment_plan_viewed'
  | 'segment_plan_contact';

export type OpportunityTrack =
  | 'creator-mode'
  | 'partnership-licensing'
  | 'facilitator-toolkit'
  | 'community-support';

export type MarketSegment =
  | 'experiential-installations'
  | 'wellness-focus-environments'
  | 'education-enrichment';

type ToyOpenSource = 'library' | 'direct';

type ToyOpenEntry = {
  slug: string;
  openedAt: string;
  source?: string;
};

type GrowthState = {
  activeDays: string[];
  lastSeenAt?: string;
  toyOpens: number;
  toyOpenHistory: ToyOpenEntry[];
  shares: number;
  premiumPromptDismissed: boolean;
};

const STORAGE_KEY = 'stims-growth-metrics-v1';

const createEmptyState = (): GrowthState => ({
  activeDays: [],
  toyOpens: 0,
  toyOpenHistory: [],
  shares: 0,
  premiumPromptDismissed: false,
});

const opportunityTracks: OpportunityTrack[] = [
  'creator-mode',
  'partnership-licensing',
  'facilitator-toolkit',
  'community-support',
];

const isOpportunityTrack = (value: string): value is OpportunityTrack =>
  opportunityTracks.includes(value as OpportunityTrack);

const marketSegments: MarketSegment[] = [
  'experiential-installations',
  'wellness-focus-environments',
  'education-enrichment',
];

const isMarketSegment = (value: string): value is MarketSegment =>
  marketSegments.includes(value as MarketSegment);

const isoDay = (timestamp = Date.now()) =>
  new Date(timestamp).toISOString().slice(0, 10);

const readState = (): GrowthState => {
  if (typeof window === 'undefined') {
    return createEmptyState();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createEmptyState();
    }

    const parsed = JSON.parse(raw) as Partial<GrowthState>;

    return {
      activeDays: Array.isArray(parsed.activeDays) ? parsed.activeDays : [],
      lastSeenAt:
        typeof parsed.lastSeenAt === 'string' ? parsed.lastSeenAt : undefined,
      toyOpens:
        typeof parsed.toyOpens === 'number' && Number.isFinite(parsed.toyOpens)
          ? parsed.toyOpens
          : 0,
      toyOpenHistory: Array.isArray(parsed.toyOpenHistory)
        ? parsed.toyOpenHistory.filter((entry): entry is ToyOpenEntry =>
            Boolean(entry && typeof entry.slug === 'string'),
          )
        : [],
      shares:
        typeof parsed.shares === 'number' && Number.isFinite(parsed.shares)
          ? parsed.shares
          : 0,
      premiumPromptDismissed: Boolean(parsed.premiumPromptDismissed),
    };
  } catch (_error) {
    return createEmptyState();
  }
};

const writeState = (state: GrowthState) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_error) {
    // Ignore storage write errors.
  }
};

const emitMetricEvent = (
  name: GrowthEventName,
  detail: Record<string, string | number> = {},
) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('stims:growth-event', {
      detail: {
        name,
        timestamp: Date.now(),
        ...detail,
      },
    }),
  );
};

type GrowthSignalPayload = {
  name: GrowthEventName;
  timestamp: string;
  detail: Record<string, string | number>;
};

const resolveGrowthSignalEndpoint = () => {
  if (typeof document === 'undefined') return null;
  const node = document.querySelector<HTMLMetaElement>(
    'meta[name="stims-growth-signal-endpoint"]',
  );
  return node?.content?.trim() || null;
};

const sendGrowthSignal = (payload: GrowthSignalPayload) => {
  if (typeof window === 'undefined') return;
  const endpoint = resolveGrowthSignalEndpoint();
  if (!endpoint) return;

  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
  } catch (_error) {
    // Ignore and fallback to fetch.
  }

  void fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Ignore network errors for optional signal endpoint.
  });
};

const emitServerSignal = (
  name: GrowthEventName,
  detail: Record<string, string | number>,
) => {
  sendGrowthSignal({
    name,
    timestamp: new Date().toISOString(),
    detail,
  });
};

export const recordLibraryVisit = () => {
  const state = readState();
  const today = isoDay();
  if (!state.activeDays.includes(today)) {
    state.activeDays.push(today);
    state.activeDays = state.activeDays.slice(-35);
  }
  state.lastSeenAt = new Date().toISOString();
  writeState(state);
  emitMetricEvent('library_visit', {
    weeklyActiveDays: getWeeklyActiveDays(state),
  });
  return state;
};

export const recordToyOpen = (
  slug: string,
  source: ToyOpenSource = 'library',
) => {
  if (!slug) return;
  const state = readState();
  state.toyOpens += 1;
  state.lastSeenAt = new Date().toISOString();
  const currentDay = isoDay();
  if (!state.activeDays.includes(currentDay)) {
    state.activeDays.push(currentDay);
    state.activeDays = state.activeDays.slice(-35);
  }

  const nextHistory: ToyOpenEntry[] = [
    { slug, openedAt: new Date().toISOString(), source },
    ...state.toyOpenHistory.filter((entry) => entry.slug !== slug),
  ];
  state.toyOpenHistory = nextHistory.slice(0, 8);
  writeState(state);
  emitMetricEvent('toy_open', { slug, source, toyOpens: state.toyOpens });
};

export const recordToyShare = (slug: string) => {
  const state = readState();
  state.shares += 1;
  writeState(state);
  emitMetricEvent('toy_share', { slug, shares: state.shares });
};

export const dismissPremiumPrompt = () => {
  const state = readState();
  state.premiumPromptDismissed = true;
  writeState(state);
  emitMetricEvent('premium_prompt_dismissed');
};

export const shouldShowPremiumPrompt = () => {
  const state = readState();
  if (state.premiumPromptDismissed) return false;
  return getWeeklyActiveDays(state) >= 2 && state.toyOpens >= 4;
};

export const getRecentToySlugs = (limit = 3) => {
  const state = readState();
  return state.toyOpenHistory.slice(0, limit).map((entry) => entry.slug);
};

export const getGrowthSnapshot = () => {
  const state = readState();
  return {
    weeklyActiveDays: getWeeklyActiveDays(state),
    toyOpens: state.toyOpens,
    shares: state.shares,
    recentToySlugs: getRecentToySlugs(),
  };
};

export const recordOpportunityInterest = (track: OpportunityTrack) => {
  emitMetricEvent('opportunity_interest', { track });
  emitServerSignal('opportunity_interest', { track });
};

export const recordOpportunityContact = (track: OpportunityTrack) => {
  emitMetricEvent('opportunity_contact', { track });
  emitServerSignal('opportunity_contact', { track });
};

export const isValidOpportunityTrack = (
  value: string,
): value is OpportunityTrack => isOpportunityTrack(value);

export const recordSegmentPlanViewed = (segment: MarketSegment) => {
  emitMetricEvent('segment_plan_viewed', { segment });
  emitServerSignal('segment_plan_viewed', { segment });
};

export const recordSegmentPlanContact = (segment: MarketSegment) => {
  emitMetricEvent('segment_plan_contact', { segment });
  emitServerSignal('segment_plan_contact', { segment });
};

export const isValidMarketSegment = (value: string): value is MarketSegment =>
  isMarketSegment(value);

const getWeeklyActiveDays = (state: GrowthState) => {
  const lastSevenDays = new Set<string>();
  for (let index = 0; index < 7; index += 1) {
    const day = new Date(Date.now() - index * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    lastSevenDays.add(day);
  }

  return state.activeDays.filter((day) => lastSevenDays.has(day)).length;
};
