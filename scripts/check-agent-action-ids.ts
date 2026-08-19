/**
 * Guard against drift between the command palette's action-id catalog and
 * the stage dock's `data-action` attributes.
 *
 * Both lists exist so browser automation can select a control by a stable
 * id instead of fragile aria-label/text matching:
 *   - the palette's authoritative action list lives inline in App.tsx's
 *     `paletteActions` useMemo (see command-palette-registry.ts for the
 *     `CommandAction` type/matching logic only — it does not enumerate ids)
 *   - the dock wires matching `data-action="<id>"` attributes onto its
 *     buttons/menu items in StageControls.tsx
 *
 * Nothing stops these two lists from drifting apart as the app evolves: a
 * new palette action added without its dock counterpart, or a dock
 * data-action typo'd against no real palette id. This is a plain text scan
 * (matching this repo's other `check-*` scripts), not a TS parser — good
 * enough to catch literal-id drift without the cost of a real AST.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const APP_PATH = join(REPO_ROOT, 'src/js/frontend/App.tsx');
const STAGE_CONTROLS_PATH = join(
  REPO_ROOT,
  'src/js/frontend/StageControls.tsx',
);

function logError(msg: string) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
}

function logWarning(msg: string) {
  console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`);
}

function logInfo(msg: string) {
  console.log(`\x1b[32m[INFO]\x1b[0m ${msg}`);
}

/**
 * Palette action ids that are deliberately palette-only — no natural dock
 * button exists for them. Every entry here must be justified by reading the
 * dock source, not added just to make the check pass.
 *
 * - 'toggle-autoplay': StageControls.tsx has no autoplay control at all
 *   (confirmed: no "autoplay" occurrence in the file); autoplay is only
 *   toggled via the command palette / keyboard shortcut.
 */
// - 'open-shortcuts', 'cycle-theme', 'use-webgl': preference-level commands.
//   The dock is for things you reach for mid-performance; these are settings
//   you change once, so they get a palette row (and a Settings control) but
//   no permanent dock slot.
// - 'queue-take': the cue monitor owns this verb with its own Take button,
//   which is a larger and better-placed target than a dock menu row would be;
//   the palette row exists so automation and keyboard users can reach it.
// - 'queue-skip', 'queue-fade': same as queue-take — the cue monitor owns
//   these with its own buttons, right next to the preview they act on. The
//   palette rows exist so automation and keyboard users can reach them.
// - 'queue-clear': queue management, not a mid-performance move.
const PALETTE_ONLY_EXEMPT = new Set([
  'queue-take',
  'queue-skip',
  'queue-fade',
  'queue-clear',
  'toggle-autoplay',
  'open-shortcuts',
  'cycle-theme',
  'use-webgl',
]);

/**
 * Dock data-action ids that are deliberately dock-only — no palette action
 * exists (or reasonably could exist) for them. Every entry here must be
 * justified by reading App.tsx's paletteActions list, not added just to
 * make the check pass.
 *
 * - 'toggle-pip': Picture-in-Picture is gated behind a browser support
 *   check (`pip.supported`) that only makes sense as a dock control.
 * - 'open-palette': the dock's "open command palette" button — a palette
 *   action to open the palette from within itself would be meaningless.
 */
const DOCK_ONLY_EXEMPT = new Set(['toggle-pip', 'open-palette']);

function extractPaletteActionIds(source: string): string[] {
  const startMarker = 'const paletteActions: CommandAction[] = useMemo(';
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(
      `Could not find "${startMarker}" in ${APP_PATH}. The paletteActions useMemo may have moved or been renamed — update this script's boundary marker.`,
    );
  }
  // Bound the scan to the useMemo's own closing `],\n    [deps],\n  );`.
  // This used to match the literal deps array, which meant that adding one
  // dependency — an ordinary edit — broke the check with a confusing
  // "block may have been restructured" error. Match the *shape* instead: the
  // first deps array at the useMemo's indentation, whatever it contains.
  const depsPattern = /\n {4}\[[^\]]*\],\n {2}\);/;
  const rest = source.slice(startIdx);
  const depsMatch = depsPattern.exec(rest);
  if (!depsMatch) {
    throw new Error(
      `Could not find the paletteActions useMemo's closing deps array after its start in ${APP_PATH}. The block may have been restructured — update this script's boundary pattern.`,
    );
  }
  const block = rest.slice(0, depsMatch.index);

  const ids: string[] = [];
  const idPattern = /id:\s*'([a-z0-9-]+)'/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((match = idPattern.exec(block)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

/** Small option arrays StageControls.tsx builds template-literal
 * data-action ids from, so we can resolve those to real ids instead of
 * skipping them. Kept in sync by hand with StageControls.tsx's own
 * TRANSITION_STEPS / AUDIO_SOURCE_OPTIONS — if those change shape, this
 * resolver (or its ids) needs a matching update. */
function resolveTemplateDockActionIds(source: string): {
  ids: string[];
  warnings: string[];
} {
  const ids: string[] = [];
  const warnings: string[] = [];

  // TRANSITION_STEPS: { mode: 'cut' | 'blend', seconds: number }[], rendered
  // via data-action={step.mode === 'cut' ? 'transition-cut' : `transition-${step.seconds}s`}
  const transitionBlockMatch = source.match(
    /const TRANSITION_STEPS = \[([\s\S]*?)\];/,
  );
  if (transitionBlockMatch) {
    const stepPattern =
      /\{\s*mode:\s*'(cut|blend)'\s*as const,\s*seconds:\s*(\d+)\s*\}/g;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
    while ((m = stepPattern.exec(transitionBlockMatch[1])) !== null) {
      const [, mode, seconds] = m;
      ids.push(mode === 'cut' ? 'transition-cut' : `transition-${seconds}s`);
    }
    if (ids.length === 0) {
      warnings.push(
        'Found TRANSITION_STEPS but could not parse any {mode, seconds} entries out of it — check the shape has not changed.',
      );
    }
  } else {
    warnings.push(
      'Could not find TRANSITION_STEPS in StageControls.tsx to resolve its templated data-action ids.',
    );
  }

  // AUDIO_SOURCE_OPTIONS: { source: 'demo' | 'microphone' | 'tab', ... }[],
  // rendered via data-action={`audio-${option.source}`}
  const audioBlockMatch = source.match(
    /const AUDIO_SOURCE_OPTIONS = \[([\s\S]*?)\];/,
  );
  if (audioBlockMatch) {
    const sourcePattern = /source:\s*'([a-z-]+)'\s*as const/g;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
    while ((m = sourcePattern.exec(audioBlockMatch[1])) !== null) {
      ids.push(`audio-${m[1]}`);
    }
    if (ids.length === 0) {
      warnings.push(
        'Found AUDIO_SOURCE_OPTIONS but could not parse any {source} entries out of it — check the shape has not changed.',
      );
    }
  } else {
    warnings.push(
      'Could not find AUDIO_SOURCE_OPTIONS in StageControls.tsx to resolve its templated data-action ids.',
    );
  }

  return { ids, warnings };
}

function extractDockActionIds(source: string): {
  ids: string[];
  warnings: string[];
} {
  const ids: string[] = [];
  const warnings: string[] = [];

  // `data-action="literal-id"` — static string attribute
  const staticAttrPattern = /data-action="([a-z0-9-]+)"/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = staticAttrPattern.exec(source)) !== null) {
    ids.push(m[1]);
  }

  // `data-action={item.actionId}` — resolved by reading each MenuItem's own
  // `actionId: 'literal-id'` field. We don't try to correlate these two
  // patterns positionally (too fragile against reordering); instead we just
  // collect every `actionId: '...'` literal directly, since every
  // data-action={item.actionId} usage in this file is fed exclusively by
  // MenuItem objects with a literal actionId string.
  const actionIdFieldPattern = /actionId:\s*'([a-z0-9-]+)'/g;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = actionIdFieldPattern.exec(source)) !== null) {
    ids.push(m[1]);
  }

  // Confirm every `data-action={...}` computed usage is one we resolved
  // above (either `item.actionId` or a template literal handled by
  // resolveTemplateDockActionIds), otherwise warn instead of silently
  // missing coverage.
  const computedAttrPattern = /data-action=\{([^}]+)\}/g;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = computedAttrPattern.exec(source)) !== null) {
    const expr = m[1].trim();
    const isKnownShape =
      expr === 'item.actionId' ||
      expr.includes("'transition-cut'") ||
      expr.startsWith('`audio-');
    if (!isKnownShape) {
      warnings.push(
        `Unrecognized computed data-action expression "${expr}" in StageControls.tsx — this script does not statically resolve it, so it is not checked for drift.`,
      );
    }
  }

  const templateResult = resolveTemplateDockActionIds(source);
  ids.push(...templateResult.ids);
  warnings.push(...templateResult.warnings);

  return { ids: [...new Set(ids)], warnings };
}

export function checkAgentActionIds(): boolean {
  let appSource: string;
  let stageControlsSource: string;
  try {
    appSource = readFileSync(APP_PATH, 'utf8');
  } catch (error) {
    logError(`Failed to read ${APP_PATH}: ${(error as Error).message}`);
    return false;
  }
  try {
    stageControlsSource = readFileSync(STAGE_CONTROLS_PATH, 'utf8');
  } catch (error) {
    logError(
      `Failed to read ${STAGE_CONTROLS_PATH}: ${(error as Error).message}`,
    );
    return false;
  }

  let paletteIds: string[];
  try {
    paletteIds = extractPaletteActionIds(appSource);
  } catch (error) {
    logError((error as Error).message);
    return false;
  }
  if (paletteIds.length === 0) {
    logError(
      `Parsed zero action ids out of paletteActions in ${APP_PATH} — the extraction regex is likely broken.`,
    );
    return false;
  }

  const { ids: dockIds, warnings: dockWarnings } =
    extractDockActionIds(stageControlsSource);
  if (dockIds.length === 0) {
    logError(
      `Parsed zero data-action ids out of ${STAGE_CONTROLS_PATH} — the extraction regex is likely broken.`,
    );
    return false;
  }
  for (const warning of dockWarnings) {
    logWarning(warning);
  }

  logInfo(
    `Parsed ${paletteIds.length} palette action ids and ${dockIds.length} dock data-action ids.`,
  );

  const paletteIdSet = new Set(paletteIds);
  const dockIdSet = new Set(dockIds);

  let errorsCount = 0;

  for (const id of paletteIds) {
    if (dockIdSet.has(id)) continue;
    if (PALETTE_ONLY_EXEMPT.has(id)) {
      logInfo(`Palette action "${id}" is deliberately palette-only (exempt).`);
      continue;
    }
    logError(
      `Palette action "${id}" (defined in App.tsx's paletteActions) has no matching data-action in StageControls.tsx, and is not on the PALETTE_ONLY_EXEMPT list. Either add a dock control with data-action="${id}", or add it to PALETTE_ONLY_EXEMPT with a comment justifying why it is palette-only.`,
    );
    errorsCount += 1;
  }

  for (const id of dockIds) {
    if (paletteIdSet.has(id)) continue;
    if (DOCK_ONLY_EXEMPT.has(id)) {
      logInfo(`Dock data-action "${id}" is deliberately dock-only (exempt).`);
      continue;
    }
    logError(
      `Dock data-action "${id}" (in StageControls.tsx) does not match any palette action id in App.tsx's paletteActions — likely a typo or a stale id left after a rename. Either fix the id, or add it to DOCK_ONLY_EXEMPT with a comment justifying why it is dock-only.`,
    );
    errorsCount += 1;
  }

  // Exempt entries that turned out to no longer be needed are themselves a
  // form of drift (dead documentation of a gap that closed) — flag them so
  // the lists stay minimal and truthful.
  for (const id of PALETTE_ONLY_EXEMPT) {
    if (!paletteIdSet.has(id)) {
      logError(
        `PALETTE_ONLY_EXEMPT lists "${id}", but it is no longer a palette action id — remove it from the exempt list in scripts/check-agent-action-ids.ts.`,
      );
      errorsCount += 1;
    } else if (dockIdSet.has(id)) {
      logError(
        `PALETTE_ONLY_EXEMPT lists "${id}", but a matching dock data-action now exists — remove it from the exempt list in scripts/check-agent-action-ids.ts.`,
      );
      errorsCount += 1;
    }
  }
  for (const id of DOCK_ONLY_EXEMPT) {
    if (!dockIdSet.has(id)) {
      logError(
        `DOCK_ONLY_EXEMPT lists "${id}", but it is no longer a dock data-action id — remove it from the exempt list in scripts/check-agent-action-ids.ts.`,
      );
      errorsCount += 1;
    } else if (paletteIdSet.has(id)) {
      logError(
        `DOCK_ONLY_EXEMPT lists "${id}", but a matching palette action now exists — remove it from the exempt list in scripts/check-agent-action-ids.ts.`,
      );
      errorsCount += 1;
    }
  }

  if (errorsCount > 0) {
    logError(`Agent action id drift check failed with ${errorsCount} errors.`);
    return false;
  }

  logInfo('Agent action id drift check passed successfully.');
  return true;
}

if (import.meta.main) {
  const ok = checkAgentActionIds();
  if (!ok) {
    process.exit(1);
  }
}
