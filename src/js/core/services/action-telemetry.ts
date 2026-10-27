/**
 * Which actions visitors run, and from where.
 *
 * Before this, production recorded audio starts, editor opens, first edits
 * and shares, and nothing else a visitor did: whether anyone used the
 * palette, a shortcut, a gesture, Browse, the AI panels, the queue or a MIDI
 * pad was unknowable, so "too hard to find" could only be inferred from how
 * deep a control sat. Each event is `action:<id>` with the surface it was run
 * from, where `<id>` is the command-palette id where one exists (so the same
 * action reads the same from every surface) or the control's `data-action`.
 *
 * Sent once per action and surface per page load: the question is whether a
 * route gets used at all, not how often, and the bound keeps a performer's
 * hundredth press of N from costing a beacon.
 */
import type { TELEMETRY_SURFACES } from '../edge-contracts.ts';
import {
  readTelemetryContext,
  resolveTelemetryEndpoint,
} from './telemetry-context.ts';

export type ActionSurface = (typeof TELEMETRY_SURFACES)[number];

/** An id from our own code: lowercase words, digits, dots and dashes. */
const ACTION_ID = /^[a-z0-9][a-z0-9.-]{0,47}$/;
/** Room for every action from several surfaces, short of a firehose. */
const MAX_ACTION_TRANSMITS_PER_SESSION = 150;

const sent = new Set<string>();

export function noteActionUse(actionId: string, surface: ActionSurface) {
  if (!ACTION_ID.test(actionId)) return;
  const key = `${actionId}|${surface}`;
  if (sent.has(key) || sent.size >= MAX_ACTION_TRANSMITS_PER_SESSION) return;
  const endpoint = resolveTelemetryEndpoint();
  if (!endpoint) return;
  sent.add(key);
  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(
        endpoint,
        new Blob(
          [
            JSON.stringify({
              event: `action:${actionId}`,
              surface,
              ...readTelemetryContext(),
            }),
          ],
          { type: 'application/json' },
        ),
      );
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

const SURFACE_ATTRIBUTE = 'data-telemetry-surface';

function surfaceOf(element: Element): ActionSurface {
  const value = element
    .closest(`[${SURFACE_ATTRIBUTE}]`)
    ?.getAttribute(SURFACE_ATTRIBUTE);
  return (value as ActionSurface | null | undefined) ?? 'other';
}

/**
 * Notes every click on a control carrying `data-action`, with the surface
 * named by its nearest `data-telemetry-surface` ancestor. Capture phase, so
 * it reads the control before a menu that closes on the click unmounts it.
 * Returns the teardown.
 */
export function installActionClickTelemetry(
  root: Pick<Document, 'addEventListener' | 'removeEventListener'> = document,
): () => void {
  const handleClick = (event: Event) => {
    // Duck-typed rather than `instanceof Element`: a click on a button's
    // icon targets an SVG element, and those count too.
    const target = event.target as Element | null;
    if (typeof target?.closest !== 'function') return;
    const control = target.closest('[data-action]');
    if (!control || control.matches(':disabled')) return;
    const actionId = control.getAttribute('data-action');
    if (actionId) noteActionUse(actionId, surfaceOf(control));
  };
  root.addEventListener('click', handleClick, { capture: true });
  return () =>
    root.removeEventListener('click', handleClick, { capture: true });
}

/** Test-only reset of the once-per-load memory. */
export function resetActionTelemetryForTests() {
  sent.clear();
}
