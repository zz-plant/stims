## Summary

The studio editing loop for the "Open one up" moment — the funnel fixes, then the authoring instruments, on one branch. Ten commits; each unit landed separately and was gate-verified before the next began.

**The funnel (PRODUCT_MOMENTS measured: 254 audible starts → 6 editor opens → 0 first edits):**
- Code gets at least eight lines before the dock (from the branched `fix/editor-code-height`, included here).
- The landing now offers "Edit this one" beside Play demo / Browse presets, gated on the attract preview being live (phones and low-power visitors get no dead-end button).
- When the dock folds, its Controls pill now carries its own Edit (kept in the accessibility tree — it used to leave it), and the folded hint names E.
- Tune leads with its controls (the intro paragraph and wave/shape picker are demoted), and a chip's visible text now names every driving band (`eq · bass, mid, treb`), not just the first.
- Two new growth events — `first-code-edit-applied` (typed/pasted/cut/dropped code committed by the 120 ms apply debounce, undo/redo excluded) and `first-tune-edit-applied` (the first value any Tune control writes). The existing `first-edit-applied` keeps its meaning frozen. AI proposals, agent applies and the guide button fire neither: only visitor-origin edits count.
- `tests/e2e/studio-loop.test.ts` walks browse → edit → compare → save → share without leaving the session, ending with the share link's `#code=` hash round-tripping through `decodePresetCodeFromHash` onto the stage.

**The instruments:**
- Watcher HUD: the Inspect pane's render-path history is now fixed-capacity `Float32Array` rings (O(1) writes, no `Array.shift`), and a stage overlay plots pinned variables at display rate — imperative DOM/canvas, one ring write per watched variable when on, zero steady-state paint allocations, value labels on a 200 ms clock. Palette action `toggle-watcher-hud`; top-anchored with a 30% max-height on coarse pointers so it never covers the mobile dock. Works with the editor closed.
- Version diffs: compare-any-two already shipped in #1253 — what's new is the dataflow-aware summary under the diff ("zoom stopped listening to bass"), derived from the audio-reach sets of both sources through the static dataflow, bounded at 6 lines, degrading to nothing on unparseable sources.
- The telemetry report's funnel now lists both new steps (audible start → editor opened → first code edit → first tune edit), split by device.
- Textures pane: the preset's external texture bindings with resolved files and swatch previews (same `resolveTextureUrl` the engine's loader uses), internal samplers in a collapsed group, alias/substitute/random/volume flags, and the active backend named in the hint. Classification mirrors the engine's shape rewrites, so `rand00` shows as external/random rather than pretending it aliases `noise`.

**Rebase notes (onto current main, post-maintainability restructure):** the visitor-edit telemetry now lives in the extracted `editor-codemirror.ts` machinery; the editor-host scroll fix landed in `shell/preset-finder.css` where the rule now lives; the lane's new modules import the toolchain through its source seams.

## Testing

- `bun run check` — exit 0 on the rebased branch (full gate: guards + unit + compat + corpus).
- Editor e2e re-run green on the rebased branch (this is what the CodeMirror-machinery port touches):
  - `tests/e2e/open-one-up.test.ts` — pointer path from the landing, dataflow chips, the edit on stage within budget.
  - `tests/e2e/studio-loop.test.ts` — the whole loop including the share-link reload.
  - `tests/e2e/landing-edit.test.ts` — landing → editor by pointer.
- Unit suites added by the lane, each mutation-verified to fail without the change:
  - `tests/unit/editor-first-edit-telemetry.test.ts`, `stage-controls-dock.test.tsx`, `workspace-first-fold-actions.test.tsx`, `first-play-hint.test.tsx`, `landing-*` unit coverage
  - `tests/unit/sample-ring.test.ts`, `tests/unit/watcher-hud.test.ts`, mobile-viewport-matrix invariant
  - `tests/unit/version-compare-summary.test.ts`, `editor-panel-versions.test.ts`
  - `tests/unit/editor-panel-textures.test.ts` (analysis + pane mount; a first mutation that survived exposed a real coverage gap, which was then closed)
  - `tests/unit/telemetry-report.test.ts`
- One-off live browser probes on the dev server confirmed the HUD paints real pixels and survives editor close/reopen, and the Textures pane shows real swatches on WebGPU.

## Docs touched

- `docs/PRODUCT_MOMENTS.md` — instruments for the HUD, the funnel's split first-edit events, the open question updated, a decision-log row.
- `docs/ROADMAP.md` — Watcher HUD shipped and the open item retired; version-compare bullet; Textures pane partial (overrides and uploads remain open); loop exit criteria updated conservatively.
- `tests/INDEX.md` — new entries.

## Review risk checklist

- [x] Null/undefined paths reviewed for changed logic
- [x] Async/lifecycle state transitions reviewed (HUD paint loop and watch-set changes; telemetry once-guards across session reloads; stale-run guards)
- [x] Existing shared helper/module checked before introducing duplicate logic (diff machinery reused; dataflow reused; browser-storage reused)
- [x] New visual literals use existing design tokens (watcher-hud.css adds no custom properties)
- [x] Behavior change is covered by tests

## Quality checklist

- [x] `bun run check:quick`
- [x] `bun run check`
- [ ] `bun run build` (no build/runtime output changed)

## Notes for reviewers

- One follow-up lands **after** the share lane's PR (`feat/share-lineage-reach`) merges: `EditorPanel.tsx`'s copy-share-link button gains the one-line optional `derivedFrom: entry?.derivedFrom` param that PR adds to `copyRemixLinkAction`. Nothing in this branch depends on it at type level.
- The HUD is palette-only (no dock button), deliberately: no accidental toggle mid-performance. Recorded as a product decision in the agent-action-id exemption list.
