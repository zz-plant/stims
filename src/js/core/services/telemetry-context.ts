/**
 * The visitor context every telemetry beacon carries: which way the screen is
 * held, what kind of device it is, which audio source is live, and what kind
 * of site the visit came from.
 *
 * Until these existed the dataset could not say which moment a visitor was
 * in. The first-run preset rendered black on every phone held upright for
 * weeks, and production data could not show how many visitors that was,
 * because no row recorded the screen. The fields are coarse on purpose:
 * enough to weight work by where visitors are, nothing that identifies one.
 */
import { isMobileDevice } from '../../utils/browser/device-detect.ts';
import {
  TELEMETRY_AUDIO_SOURCES,
  type TelemetryEvent,
} from '../edge-contracts.ts';
import { resolveOptionalApiUrl } from './optional-api.ts';

export type TelemetryContext = Pick<
  TelemetryEvent,
  'orientation' | 'device' | 'audioSource' | 'arrival'
>;

/**
 * Below this short side, in CSS pixels, a touch device is a phone. The
 * largest phones in portrait are ~440 wide; the smallest tablets ~744.
 */
const PHONE_MAX_SHORT_SIDE = 600;

/**
 * Within this of square the screen is neither portrait nor landscape. The
 * first-run preset's failure was graded by aspect: lit on landscape, dim on
 * square, black on portrait.
 */
const SQUARE_TOLERANCE = 0.05;

let liveAudioSource: TelemetryContext['audioSource'] = 'none';

/**
 * A search engine's results host: the bare or www./search. name under any
 * country domain (google.co.uk, search.yahoo.com, search.brave.com), so
 * mail.google.com or docs.google.com do not count as search.
 */
const SEARCH_HOST =
  /^(?:www\.|search\.)?(?:google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|startpage|kagi|qwant|naver|seznam|brave)\.[a-z.]+$/;
/** Chat assistants that cite pages, kept apart from search on purpose. */
const ASSISTANT_HOST =
  /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|copilot\.microsoft\.com|gemini\.google\.com)$/;
const SOCIAL_HOST =
  /(^|\.)(reddit\.com|redd\.it|t\.co|x\.com|twitter\.com|facebook\.com|instagram\.com|threads\.net|youtube\.com|tiktok\.com|linkedin\.com|bsky\.app|discord\.com|news\.ycombinator\.com)$/;

/**
 * What kind of site a visit came from, read from the referrer's hostname and
 * nothing else of it. The query string a search engine might carry is never
 * looked at, and the hostname itself is never sent: only this class is.
 * Browsers send an origin-only referrer across sites by default, so a search
 * arrival reads as `https://www.google.com/`.
 */
export function classifyTelemetryArrival(
  referrer: string,
  ownOrigin: string,
): NonNullable<TelemetryContext['arrival']> {
  if (!referrer) return 'none';
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return 'other';
  }
  if (url.origin === ownOrigin) return 'internal';
  const host = url.hostname.toLowerCase();
  if (ASSISTANT_HOST.test(host)) return 'assistant';
  if (SEARCH_HOST.test(host)) return 'search';
  if (SOCIAL_HOST.test(host)) return 'social';
  return 'other';
}

/** Fixed for the page load: the referrer does not change after it. */
let pageArrival: TelemetryContext['arrival'];

function readPageArrival(): TelemetryContext['arrival'] {
  if (
    pageArrival === undefined &&
    typeof document !== 'undefined' &&
    typeof location !== 'undefined'
  ) {
    pageArrival = classifyTelemetryArrival(document.referrer, location.origin);
  }
  return pageArrival;
}

/** The audio source that is live now, or null when none is. */
export function setTelemetryAudioSource(source: string | null): void {
  liveAudioSource =
    TELEMETRY_AUDIO_SOURCES.find((known) => known === source) ?? 'none';
}

export function classifyTelemetryViewport(
  width: number,
  height: number,
  touch: boolean,
): Pick<TelemetryEvent, 'orientation' | 'device'> {
  if (!(width > 0 && height > 0)) return {};
  const ratio = width / height;
  const orientation =
    Math.abs(ratio - 1) <= SQUARE_TOLERANCE
      ? 'square'
      : ratio > 1
        ? 'landscape'
        : 'portrait';
  // A narrow desktop window is still a desktop: size alone would file it
  // with phones.
  const device = !touch
    ? 'desktop'
    : Math.min(width, height) < PHONE_MAX_SHORT_SIDE
      ? 'phone'
      : 'tablet';
  return { orientation, device };
}

/**
 * Where beacons go, or null when a test harness drives the page. Our own
 * Playwright runs against toil.fyi posted like visitors: 612 embed landings
 * in September, all from one country within one week and none since, which
 * is a capture run rather than an audience. Shares of visitors by screen mean
 * nothing while our tooling is counted in them.
 */
export function resolveTelemetryEndpoint(): string | null {
  if (typeof navigator !== 'undefined' && navigator.webdriver === true) {
    return null;
  }
  return resolveOptionalApiUrl('/api/telemetry');
}

/** Read at send time, so a phone rotated mid-session reports its new state. */
export function readTelemetryContext(): TelemetryContext {
  const viewport =
    typeof window === 'undefined'
      ? {}
      : classifyTelemetryViewport(
          window.innerWidth,
          window.innerHeight,
          isMobileDevice(),
        );
  const arrival = readPageArrival();
  return {
    ...viewport,
    audioSource: liveAudioSource,
    ...(arrival ? { arrival } : {}),
  };
}

/** Test-only reset. */
export function resetTelemetryContextForTests(): void {
  liveAudioSource = 'none';
  pageArrival = undefined;
}
