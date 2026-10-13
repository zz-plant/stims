# Promoting a package to its own repo: the `audio-reactive` test case

A costed, step-by-step path for flipping one package from "canonical in `stims`
with a read-only mirror" to "canonical in its own repo that Stims depends on."
`audio-reactive` is the test case because it is the most decoupled of the four:
bare-name imports only, zero runtime dependencies, and a small public surface.
The same plan applies to `flash-guard` and `eel-conformance`; `milkdrop-toolchain`
is a separate, much harder case (see the readme's relationship section and the
import census at the bottom of this file).

This is a decision artifact, not a work order: execute it only when a trigger
fires, and land Phase 0 and Phase 1 in `stims` *before* touching the repo.

---

## Current state (evidence)

- Source of truth: `packages/audio-reactive/` in `zz-plant/stims`.
- App consumes it as a Bun workspace dep (`"audio-reactive": "workspace:*"` in
  root `package.json`) with **no build step**: the package's `exports` list
  `stims-source`/`bun` conditions that point at
  `packages/audio-reactive/src/index.ts`, and Vite
  (`resolve.conditions`), the UI harness, and TypeScript (`customConditions`)
  all honour `stims-source`. npm consumers get `dist/`.
- Import surface in the app: 7 sites
  (`src/js/core/audio-handler.ts`, `src/js/milkdrop/runtime-signals.ts`,
  `src/js/milkdrop/audio-signal-processor.ts`,
  `src/js/frontend/audio-signal-state.ts`,
  `src/js/frontend/SilentAudioNotice.tsx`, `scripts/lab-audio-fidelity.ts`) —
  five bare `audio-reactive`, one
  `audio-reactive/worklet?worklet` (Vite worklet syntax), one direct.
- Package is self-contained: `dependencies: {}`; devDeps are only
  `@types/bun` and `typescript`.
- Mirror `zz-plant/audio-reactive` already holds the package's full history
  (read-only, issues/Actions off), pushed by `mirror-packages.yml` via the
  deterministic `scripts/split-package.ts`.
- The package list itself is `scripts/package-manifest.ts`; `check:ci-config`
  validates every package surface against it, and a `promoted` role flips on
  `check:no-source-seams`, which names each `workspace:`/`src/` seam a
  promotion must resolve.
- Publishing `publish-packages.yml` already works for any package; trusted
  publishing just needs the repo+workflow registered as publisher on npm once
  the name exists.
- Sites: `pages-packages.yml` deploys all four `site/` dirs to
  `zz-plant.github.io/stims/<name>/`.

The only thing that is hard about the move is *source-level consumption*. The
repo topology, history, and publishing plumbing are all already there.

---

## The core decision

**What should Stims consume after the split: `dist/` from npm, or source from
the new repo?**

Versioned `dist/` is the only sane answer — anything else (cross-repo
workspaces, submodules, git deps) re-creates monorepo coordination without
atomic commits. Accepting that means accepting, for this one package:

1. Every `audio-reactive` change the app wants now goes through
   `bump → tag → publish → bun update`, instead of landing in the same commit.
2. The app's dev loop reads `dist/`, so a broken build emits before the app
   ever sees the change.
3. The `stims-source` conditions become moot for this package (they stay for
   the others; a versioned dep simply misses the package's `stims-source`
   condition and falls through to `dist`).

Phase 0 proves the seam before any of this is irreversible.

---

## Phase 0 — Prove the dist seam (no topology change)

Goal: evidence that Stims works against built `dist/`, so the API contract the
app actually needs is known and frozen.

1. **Pin the public surface.** The app imports two subpaths: `.` and
   `./worklet`. Treat `packages/audio-reactive/src/index.ts` and
   `packages/audio-reactive/src/frequency-analyser-processor.ts` (the worklet
   entry) as the committed API. Note `sideEffects` currently
   lists both worklet entries — preserved in `dist`.
2. **Reproducible build.** `bun run check:dist-determinism -- audio-reactive`
   builds the package twice from clean and byte-compares the two `dist/`
   outputs (wired into `publish-packages.yml` ahead of `npm pack`). If tsc
   emits differ run-to-run, that is a find-before-promote: pin a Node version
   in the package CI.
3. **Consume-dist smoke test.** In a scratch branch, point the app at the
   package's `dist` (temporarily swap the root dep to `file:packages/audio-reactive`
   or add a `stims-dist` condition) and run the full gate:
   `bun run check` plus the worklet path specifically —
   `src/js/core/audio-handler.ts` imports `audio-reactive/worklet?worklet`, and
   Vite must resolve it to `dist/frequency-analyser-processor.js` and still
   treat it as a worklet (`?worklet`). This is the single most likely thing to
   break; prove it here.
4. **Record the results** in this file (or the PR): gate pass/fail, worklet
   outcome, and any `exports`/`files` gaps (e.g. `files` already ships `dist`
   + `src`; decide whether `src` stays in the tarball).

Exit criteria: a green full gate with the app reading `dist/`, including the
worklet import.

---

## Phase 1 — Flip Stims to a versioned dependency (package still in-repo)

Goal: land the app-side change while rollback is one line, *before* any repo
move.

1. Root `package.json`: `"audio-reactive": "workspace:*"` →
   `"audio-reactive": "^0.1.0"` (the version already in the package file).
2. Delete the local `node_modules/audio-reactive` symlink and re-link from the
   package's build: `bun --cwd packages/audio-reactive run build` then
   `bun link`/`file:` override for local dev, or simply accept that dev now
   exercises the published shape (build first). The repo's
   `stims-source` condition must not be relied on for this package anymore:
   Vite/tsconfig conditions stay global, and the package's `exports` simply
   falls to `default`.
3. Run the full gate (`bun run check`). Root tsconfig does not include
   `packages/`, so only the app's own typecheck + tests guard the integration.
4. Commit and ship this as its own PR. **Rollback at this point** =
   revert to `workspace:*`; nothing else changed.

Exit criteria: green on `main` with the app importing published-shape
`audio-reactive`.

This phase is the real cost center. From here on, every subsequent
`audio-reactive` change the app needs is a release, not a commit.

---

## Phase 2 — Promote the repo

Goal: `zz-plant/audio-reactive` becomes writable, building, and publishing on
its own; history is already there.

The mirror is already a full clone of the package's history, so no migration
step exists — this phase is repository settings and new workflow files in the
package repo:

1. GitHub settings on `zz-plant/audio-reactive`: enable issues and Actions;
   the repo keeps its name/URL (its `package.json` `repository` field already
   points at `zz-plant/stims` with `directory: packages/audio-reactive` — flip
   it to the new repo URL, same for `homepage` and `bugs`).
2. Port `publish-packages.yml` into the new repo, scoped to this one package.
   Switch the trusted-publisher registration on npmjs.com from
   `zz-plant/stims` + that workflow to `zz-plant/audio-reactive` + its workflow.
3. Add CI in the new repo: typecheck + `bun test` + build (this replaces
   `audio-reactive`'s row in `check:packages`, which the Stims gate will drop).
4. Decide the site: move `site/` to the package repo and deploy its Pages
   from there (it currently ships under `zz-plant.github.io/stims/audio-reactive/`).
   The four sites share `site/styles.css` by convention — the audio-reactive
   copy stays frozen or the convention is relaxed to "per-repo reset".
5. Branch protection + release notes flow (`scripts/release-notes.ts` exists
   in Stims; if used, port or drop it for the package).

---

## Phase 3 — Rewire Stims automations

Goal: no Stims surface still assumes the package lives here.

Most of this phase is now a one-field flip. The package list lives in
`scripts/package-manifest.ts`, and `check:ci-config` validates every surface
against it (mirror matrix, publish choices, `packages/` directory, README
table); `check:no-source-seams` fails on any `workspace:` dependency or `src/`
subpath import a promotion leaves behind, and `check:dist-determinism` guards
the published tarball. What remains by hand:

1. Flip the entry in `scripts/package-manifest.ts` to
   `role: 'promoted'` — the guards then name every remaining seam and surface
   until each is fixed.
2. Remove the site from the Pages build (`site:packages` skips it once the
   directory is gone; move `site/` to the package repo first).
3. Delete `packages/audio-reactive/`; root dep stays `^0.1.0` from Phase 1.
4. `packages/README.md` — move `audio-reactive` from the table to a
   "published elsewhere" note with a link.

---

## Phase 4 — First cross-repo release

1. In the new repo: `bun run build`, `npm publish --provenance` (or the
   `audio-reactive@<version>` tag → workflow path; the version in
   `package.json` stays the source of truth).
2. Back in Stims: `bun update audio-reactive`, gate, ship. Demo the worklet
   path on the PR's branch preview (`?worklet` is the thing to watch).

---

## Rollback

Every phase is reversible until the registry publish is consumed:

- Failing Phase 1 → revert the one-line dep change.
- Failing Phase 2/3 → re-add `packages/audio-reactive/` from the mirror
  (history intact) and restore the matrix entries; the app never stopped
  working because it already consumes the version.
- After a bad publish → `npm deprecate` and restore the previous version
  (`^0.1.0` pins nothing, so bump discipline matters: app-side lockfile).

---

## Costing

| Item | Now (monorepo) | After split | One-time |
| --- | --- | --- | --- |
| Change reaches app | same commit, instant | bump → tag → publish → `bun update` (≥ one release round-trip, minutes) | — |
| Dev loop for app+package | edit → gate (~1 min) | edit → pkg test → build → app gate | — |
| Gate coverage of the package | `check:packages` in Stims CI (55 tests) | package's own CI; Stims gate covers only the app integration | new CI file |
| Trusted publishing | registered to `zz-plant/stims` | registered to `zz-plant/audio-reactive` | npm settings |
| History | split mirror (read-only) | canonical, full history already present | none (git) |
| Sites | one Pages deploy of 4 dirs | package repo deploys its own | Pages config |
| Coordination | atomic commits, one gate | version skew possible; release checklist per change | docs |

The recurring tax is version skew + release round-trip. It is cheap only while
`audio-reactive` changes rarely and never in lockstep with the app. The moment
its rate of change rises (or its API churns), the split net-costs more than the
monorepo — which is the strongest argument for waiting for an external consumer
before promoting.

---

## When to pull the trigger

Execute this plan when any of:

1. **An external consumer installs `audio-reactive`** (npm downloads, an issue
   filed on the current mirror, a fork) — the first real signal of independent
   value.
2. `audio-reactive` needs a **release cadence the app doesn't want to ride**
   (e.g. a fix waiting on an unrelated app change).
3. The `audio-reactive` API stops churning (v0.1.0 is fresh; the worklet
   contract is the least settled part).

Until one of those fires, the current model already gives external users the
artifacts (npm tarball, README, demo site, history) at zero coordination cost.

---

## Import census (coupling evidence)

Bare `audio-reactive`:
- `src/js/core/audio-handler.ts` (×2), `src/js/milkdrop/runtime-signals.ts`,
  `src/js/milkdrop/audio-signal-processor.ts`,
  `src/js/frontend/audio-signal-state.ts`,
  `src/js/frontend/SilentAudioNotice.tsx`, `scripts/lab-audio-fidelity.ts`

Worklet subpath (the riskiest seam):
- `src/js/core/audio-handler.ts` → `audio-reactive/worklet?worklet`

Context-only references (type/catalog, not imports, checked for completeness):
- `functions/api/refine-preset.ts`, `functions/discover-slugs.ts`,
  `src/js/frontend/CreditsPanel.tsx`, `src/js/frontend/SynthesizePanel.tsx`,
  `src/js/frontend/workspace-helpers.ts`,
  `src/js/milkdrop/feedback-manager-shared.ts`,
  `src/js/milkdrop/renderer-helpers/procedural-wave-renderer.ts`,
  `src/js/milkdrop/runtime/first-run-preset.ts`,
  `src/js/milkdrop/runtime/motion-dampener.ts`