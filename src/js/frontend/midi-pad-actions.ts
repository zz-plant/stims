/**
 * Pads that run commands.
 *
 * A note binding has always carried a `target` string, and every target was
 * a preset field: a pad could gate q1 or toggle a wave, but it could not do
 * what a pad on a DJ controller is for, which is to fire something. Next
 * preset, pause, take the queued preset: all of them already exist as
 * command-palette actions with stable ids, and the shortcut layer already
 * runs them by id. A pad does the same through a target spelled
 * `action:<palette id>`, so any command the palette has, including ones
 * added later, can be put on a pad without a second registry.
 */

const PAD_ACTION_PREFIX = 'action:';

export function padActionTarget(actionId: string): string {
  return `${PAD_ACTION_PREFIX}${actionId}`;
}

/** The palette id a binding target runs, or null for a field target. */
export function padActionIdOf(target: string | undefined): string | null {
  if (!target?.startsWith(PAD_ACTION_PREFIX)) return null;
  const id = target.slice(PAD_ACTION_PREFIX.length);
  return id || null;
}

/** What a pad mapped to a command no longer offered says when hit. */
export function describeMissingPadAction(actionId: string): string {
  return `This pad runs "${actionId}", which this version has no command for. Remap it in Settings → Performance hardware.`;
}
