/**
 * The single owner of the stage's CSS brightness filter.
 *
 * Two things want to dim the stage, for unrelated reasons: the WCAG flash
 * governor clamps it reactively when content strobes, and the visitor sets a
 * comfort ceiling they expect to hold. Both used to be expressible only as
 * `stage.style.filter = 'brightness(...)'`, which is one slot — and the
 * governor writes it on a rAF loop, so a user ceiling written the same way
 * would be overwritten within a frame and appear to do nothing.
 *
 * So the property has an owner. Callers set their own channel; this composes
 * them and writes once. Multiplying is the right composition for the two
 * meanings involved: the governor's clamp is "at most this much of what you
 * asked for", and the ceiling is what was asked for.
 */

export type StageLuminanceChannel = 'governor' | 'ceiling';

type Channels = { governor: number; ceiling: number };

const channelsByStage = new WeakMap<HTMLElement, Channels>();

function channelsFor(stage: HTMLElement): Channels {
  let channels = channelsByStage.get(stage);
  if (!channels) {
    channels = { governor: 1, ceiling: 1 };
    channelsByStage.set(stage, channels);
  }
  return channels;
}

/**
 * The composed scale currently applied to a stage.
 *
 * Reads without creating: a stage nobody has written to has no filter, and
 * an accessor that registered one would populate this map for every element
 * it is merely asked about. The flash governor calls this per frame to learn
 * what the viewer is actually looking at, so it must stay a pure read.
 */
export function stageLuminanceScale(stage: HTMLElement): number {
  const channels = channelsByStage.get(stage);
  return channels ? channels.governor * channels.ceiling : 1;
}

export function setStageLuminanceChannel(
  stage: HTMLElement,
  channel: StageLuminanceChannel,
  scale: number,
): void {
  const channels = channelsFor(stage);
  const next = Number.isFinite(scale) ? Math.min(1, Math.max(0, scale)) : 1;
  if (channels[channel] === next) return;
  channels[channel] = next;

  const composed = channels.governor * channels.ceiling;
  // Clearing rather than writing brightness(1) keeps the stage off the
  // filter path entirely in the overwhelmingly common case where neither
  // channel is engaged — a filter, even an identity one, forces a
  // compositing layer the renderer does not otherwise need.
  stage.style.filter =
    composed >= 0.999 ? '' : `brightness(${composed.toFixed(3)})`;
}

/** Test seam: forget a stage's channels between cases. */
export function resetStageLuminance(stage: HTMLElement): void {
  channelsByStage.delete(stage);
  stage.style.filter = '';
}
