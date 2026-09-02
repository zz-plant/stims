# Architectural changes proposal — September 2026

Status: proposal. No runtime code changes accompany this document. Every
number below was measured on `main` at `3f8804e` (2026-09-01) with the
commands in the [appendix](#appendix-how-the-numbers-were-measured), so a
reader can re-run them before trusting or citing them.

## Thesis

The boundaries this codebase documents are mostly respected by convention:
there are no import cycles, the shared core does not depend on the React
shell, and the engine runtime is imported from exactly two files. The two
boundaries that matter most, however, are not encoded in anything the
compiler or the guards can check:

1. **React ↔ engine.** The snapshot the shell reads from the engine is typed
   `any`, and the guard the agent docs say enforces the seam does not exist.
2. **Catalog file → rendered row.** Preset data crosses four hand-listed
   projections, and the code comments at those sites record two shipped bugs
   caused by fields silently vanishing between them.

The proposal is to turn the conventions `ARCHITECTURE.md` already states into
contracts: declared interfaces at the seam, a real boundary rule, one derived
row type, and contract tests that fail when the two backends or the two sides
of the seam drift. That work then makes the two largest hotspots, the shell's
god component and the flat engine directory, safe to reshape.

## Proposed changes at a glance

| # | Change | Kind | Size | What it buys |
| --- | --- | --- | --- | --- |
| 1 | Declare the engine seam: an experience-controller interface and a typed snapshot | types | M | Ends the `any` channel behind 200+ shell reads |
| 2 | Make the boundary guard real: a dependency-cruiser seam rule with an explicit engine public surface | guard | S | The rule `.github/AGENTS.md` already claims |
| 3 | One catalog-entry contract: derive the row type from the engine type, collapse four projections into one, add a field-survival test | types + code | M | Closes the field-loss class that shipped twice |
| 4 | Decompose `App.tsx` by lifecycle concern and split the workspace context by change cadence | refactor | L | Attacks the #3 fix category at its hottest file |
| 5 | Give `src/js/milkdrop/` a shape: one folder per concern, each with an index that is its public surface | move | L | The map in `src-map.md` becomes the directory |
| 6 | Feedback composite: one uniform table both managers own, verified by a differential test, before any single IR | data + test | M | The sequencing the two removed IR stubs got wrong |

Sizes: S is one PR of an afternoon, M is two to three PRs, L is a series of
mechanical PRs. Sequencing and dependencies are in
[Sequencing](#sequencing).

## What is already strong

These are measured, not assumed, and nothing below should regress them.

- **No import cycles.** `bun run check:architecture` cruises 1,717 modules
  and 5,106 dependencies with zero violations in 15 s.
- **Layering holds.** `src/js/core/` imports from `src/js/milkdrop/` in
  exactly two places (`webgpu-query-override.ts` and
  `runtime/debug-snapshot.ts`); the engine never imports the frontend;
  `src/js/ui/` and `src/js/utils/` import nothing above them except two
  `core` helpers.
- **The seam is in the right place.** `src/js/milkdrop/runtime.ts` is
  imported by exactly two files, both inside `src/js/frontend/engine/`.
- **The renderer seam is declared.** `MilkdropRendererAdapter`,
  `MilkdropFeedbackManager`, and `MilkdropVM` in
  [`src/js/milkdrop/renderer-types.ts`](../../src/js/milkdrop/renderer-types.ts)
  are real interfaces. Change 1 asks the engine ↔ shell seam to meet the
  same bar the engine ↔ backend seam already meets.
- **Guards are the house style.** 31 `check:*` scripts, a generated
  `GUARDRAILS.md`, and a docblock-driven script index. Every change below
  lands with a guard or a contract test so it cannot quietly unwind.
- **Cadence splitting is already practiced.** `engine-context.tsx` separates
  the per-frame snapshot context from the stable data-and-actions context.
  Change 4 extends that pattern rather than introducing a new one.

## Findings and proposals

### 1. The engine seam is type-erased

**Evidence.**

- `buildExperienceController(deps: Record<string, any>)` at
  [`src/js/milkdrop/runtime.ts:1094`](../../src/js/milkdrop/runtime.ts)
  assembles the object the shell talks to. Its public methods are
  `subscribe(listener: unknown)`, `applyFields(updates: unknown)`,
  `attachRuntime(nextRuntime: unknown)`, and
  `update(frame: unknown, options?: unknown)`. `getStateSnapshot()` returns
  `deps.buildSnapshot()`, which is `any`.
- [`src/js/frontend/engine/engine-snapshot.ts`](../../src/js/frontend/engine/engine-snapshot.ts)
  derives `adaptiveQuality`, `catalogEntries`, and `sessionState` from that
  return type through `ReturnType<...>`, so all three are `any` in the
  shell. A type probe (appendix) confirms it, with a negative control:

  | Type at the seam | Probe result |
  | --- | --- |
  | `ReturnType<controller['getStateSnapshot']>` | `any` |
  | `EngineSnapshot['catalogEntries']` | `any` |
  | `EngineSnapshot['sessionState']` | `any` |
  | `EngineSnapshot['adaptiveQuality']` | `any` |
  | `Parameters<controller['applyFields']>[0]` | `unknown` |
  | `EngineSnapshot['activePresetId']` (control) | `string \| null`, as declared |

- The adapter's own type is inferred, not declared:
  `MilkdropEngineAdapter = ReturnType<typeof createMilkdropEngineAdapter>`
  in [`src/js/frontend/engine/milkdrop-engine-adapter.ts`](../../src/js/frontend/engine/milkdrop-engine-adapter.ts).
  Across `src/js` there are 70 `ReturnType<typeof ...>` contracts in 31
  files and 44 `as unknown as` casts.
- Blast radius in the shell: `sessionState` is read 162 times across five
  files (139 of them in `workspace-context.tsx`), `catalogEntries` 25 times
  across eight files, `adaptiveQuality` 20 times across six. None of those
  reads is checked.

**Consequence.** A rename or removal inside the engine's snapshot compiles
clean in the shell and fails at runtime. The review checklist in
[`.agent/skills/review-workspace-ui-state/SKILL.md`](../../.agent/skills/review-workspace-ui-state/SKILL.md)
asks that "state exchange uses typed events or the adapter's public API",
which cannot be checked while the API's types are `any`. The "workspace UI /
state" fix category that skill exists for is the #3 category at 19% of fix
commits (measured 2026-08-27 over 400 commits).

**Proposal.**

1. Declare `MilkdropExperienceSnapshot` and `MilkdropExperienceController`
   as interfaces in
   [`src/js/milkdrop/runtime-types.ts`](../../src/js/milkdrop/runtime-types.ts),
   and give `buildExperienceController` a typed `ExperienceControllerDeps`
   parameter instead of `Record<string, any>`. The builder-pattern comment
   at that site is where the type belongs.
2. Make `EngineSnapshot` name those interfaces directly instead of chaining
   `ReturnType` through the adapter.
3. Declare `MilkdropEngineAdapter` as an interface in the adapter module and
   have `createMilkdropEngineAdapter` in
   [`milkdrop-engine-session.ts`](../../src/js/frontend/engine/milkdrop-engine-session.ts)
   return it. The shell then depends on a declared contract, and the
   engine can be swapped or mocked against it in tests.
4. Add `tests/unit/engine-seam-types.test.ts` (NEW): a compile-time probe
   asserting `IsAny<T>` is `false` for each seam type. It is the probe from
   the appendix with the assertions inverted, needs no new tooling, and runs
   inside `bun run check` because unit tests are in the gate.

**Migration.** Three PRs, each leaving `bun run check` green: declare the
interfaces and land the probe test with the current `any` still permitted
on the internal deps; type the deps; flip the probe assertions. The third
PR will surface latent type errors among the 200+ reads. That is the point
of the change, and the budget for it belongs in the estimate.

**Risk and rollback.** Interfaces are additive. If the third PR surfaces
more breakage than a PR can absorb, keep the interfaces and the probe
scoped to the fields already clean, and ratchet the rest field by field.

### 2. The documented boundary guard does not exist

**Evidence.**

- [`.github/AGENTS.md`](../../.github/AGENTS.md) described
  `check:architecture` as "the `frontend/*` → engine boundary; only the
  engine adapter may cross it", and
  [`docs/agents/src-map.md`](../agents/src-map.md) repeated the claim.
  (Both are corrected in the change that adds this document.)
- The rules file, `.dependency-cruiser.mjs`, contains two `error` rules,
  `no-circular` and `no-prod-to-tests`, and two `info` rules that name the
  retired `loader/` and `bootstrap/` directories under `src/js`, which
  `ARCHITECTURE.md` records as deleted. There is no rule about the
  frontend → engine seam.
  [`docs/GUARDRAILS.md`](../GUARDRAILS.md) lists `check:architecture` under
  "Not yet documented".
- Reality on `main`: 27 of the 111 files under `src/js/frontend/` that are
  outside `frontend/engine/` import 20 distinct engine modules. The most
  imported are `preset-preview.ts` (6), `preset-id-resolution.ts` (5),
  `preset-credit.ts` (4), `types.ts`, `shader-execution-mode.ts`, and
  `formatter.ts` (3 each). Most are helpers and type modules, which the
  doc's wording ("deep runtime internals") does not clearly forbid, so the
  rule cannot be enforced as written. It needs a definition of "public".
- `scripts/` is a second consumer with the same problem: 31 script files
  import engine internals, led by `compiler.ts` and `common-types.ts` (11
  importers each) and `vm.ts` and `runtime-signals.ts` (5 each).

**Proposal.**

1. Define the engine's public surface as an explicit allowlist in the
   cruiser config, seeded with exactly the 20 modules imported today, so the
   rule lands green and any new deep import is a violation from day one.
   Shrink the list deliberately afterwards; change 5 replaces it with
   folder indexes.
2. Add two rules to `.dependency-cruiser.mjs`:
   - `frontend-engine-seam` (`error`): from `^src/js/frontend/(?!engine/)`
     to `^src/js/milkdrop/`, except the allowlist.
   - `engine-runtime-only-via-adapter` (`error`): only
     `src/js/frontend/engine/` may import `milkdrop/runtime.ts`,
     `milkdrop/runtime/*`, `renderer-*`, `feedback-*`, `vm*`, and
     `compiler.ts`.
   Apply the same allowlist to `scripts/` at `warn` severity so the report
   shows the coupling without blocking the lab tooling.
3. Delete the two dead `info` rules, and give the guard the docblock
   `check:module-docs` and `generate:guardrails` expect, so it leaves the
   "Not yet documented" list.

**Verification.** `bun run check:architecture` (15 s measured). The rule
must pass on `main` before merge; a seed allowlist that does not is a
measurement error, not a reason to loosen the rule.

**Risk.** None at runtime. The cost is a config file that names 20 modules,
which change 5 retires.

### 3. Catalog data crosses the seam by hand-copied projections

**Evidence.**

- The shell declares its own `PresetCatalogEntry` in
  [`src/js/frontend/contracts.ts`](../../src/js/frontend/contracts.ts) as a
  parallel of the engine's `MilkdropCatalogEntry` in
  [`src/js/milkdrop/catalog-types.ts`](../../src/js/milkdrop/catalog-types.ts).
  The field sets overlap but diverge (the shell has `file`,
  `expectedFidelityClass`, and boolean `supports`; the engine has
  `bundledFile`, `fidelityClass`, `origin`, `evidence`, `parity`, and
  status-object `supports`).
- Four hand-listed projections sit between `catalog.json` and a rendered
  row, and the code says so:
  [`catalog-bundled-pipeline.ts:106`](../../src/js/milkdrop/catalog-bundled-pipeline.ts)
  ("the earliest of three hand-listed projections ... a field missing from
  any one of them vanishes silently, with no type error, because each layer
  builds a fresh object instead of spreading"),
  [`catalog-store-projection.ts:200`](../../src/js/milkdrop/catalog-store-projection.ts)
  ("how the reactivity band and the photosensitivity warning came to read
  fields that were present in catalog.json and absent by the time the UI
  saw an entry"), and `mapRuntimeCatalogEntry` in
  [`workspace-helpers.ts:792`](../../src/js/frontend/workspace-helpers.ts)
  ("the last of four hand-listed projections").

**Consequence.** Two user-facing features, the reactivity band and the
photosensitivity warning, shipped reading fields that never survived the
trip. The comments were added after the fact as warnings; nothing stops the
third occurrence.

**Proposal.**

1. Make the row type derived, not parallel: `PresetCatalogEntry` becomes
   `Pick<MilkdropCatalogEntry, ...>` plus the few view-only fields
   (`file`, boolean `supports`, `expectedFidelityClass`). A field renamed or
   removed in the engine then fails to compile in the shell instead of
   disappearing.
2. Collapse the chain to one projection that the engine's public surface
   owns: pipeline parses and validates, the store holds state, and a single
   `projectCatalogRow()` produces the row. Where a projection must build a
   fresh object, it spreads the source and overrides explicitly, so an
   unnamed field is carried rather than dropped.
3. Add `tests/unit/catalog-projection-contract.test.ts` (NEW): for every
   measured field on a fixture `catalog.json` entry (`quality`,
   `sensoryProfile`, the evidence and certification fields), assert it is
   present on the row the browse panel receives. This is the field-survival
   test the three comments are asking for.

**Verification.** The new test, `bun run check:catalog-integrity`, and the
existing browse and preset-grid unit tests.

**Risk.** Low and behavior-preserving. The `supports ?? compatibility`
alias handled in the bundled pipeline moves into the one projection with a
test of its own.

### 4. The shell has one god component and one god context

**Evidence.**

- [`src/js/frontend/App.tsx`](../../src/js/frontend/App.tsx) is 1,653 lines
  with 49 imports, 33 `useEffect` calls, 9 refs, and 7 state cells. The next
  most effect-heavy module, `workspace-hooks.ts`, has 12; no other file has
  more than 7.
- [`workspace-context.tsx`](../../src/js/frontend/workspace-context.tsx)
  exposes 57 members on `WorkspaceContextValue` and reads the `any`-typed
  `sessionState` 139 times. [`engine-context.tsx`](../../src/js/frontend/engine-context.tsx)
  exposes 62 members on `EngineContextValue`, mixing per-session data with
  stable action callbacks in one provider, so a consumer that only needs an
  action re-renders whenever the data changes.
- The May 2026 recurring-fix audit
  ([`docs/evidence/RECURRING_FIX_PATTERNS_AUDIT_2026-05.md`](../evidence/RECURRING_FIX_PATTERNS_AUDIT_2026-05.md))
  put `workspace-hooks.ts` at a 36.8% fix rate and `App.tsx` at 17.9%, with
  the root cause recorded as "stale closures in React hooks, async
  engine-state races, toggle double-fire". As of 2026-08-27 the category is
  still #3 at 19%. This clone is shallow (50 commits), so the audit was not
  re-run here; re-run `bun run audit:fix-categories` on a full clone before
  citing a fresher number.

**Proposal.**

1. Extract the 33 effects into lifecycle hooks grouped by concern, following
   the precedent of the hooks that already exist
   ([`hooks/use-audio-source-sync.ts`](../../src/js/frontend/hooks/use-audio-source-sync.ts),
   [`hooks/use-preset-route-sync.ts`](../../src/js/frontend/hooks/use-preset-route-sync.ts)):
   engine mount and dispose, route and URL sync, audio lifecycle, MIDI
   binding, document and dataset sync, agent bridge. Target: `App.tsx`
   composes hooks and renders, with no raw `useEffect` of its own.
2. Split `EngineContextValue` by change cadence into an actions context
   (stable function identities) and a data context, the same split the file
   already makes between the per-frame snapshot and everything else.
3. Add `tests/unit/app-shell-effect-budget.test.ts` (NEW): a ratchet that
   counts `useEffect(` in `App.tsx` and fails when the count rises above the
   current value. Lower the budget in the same PR as each extraction.
4. While moving hooks, settle the naming: `hooks/` currently mixes
   `use-audio-source-sync.ts` with `useFullscreen.ts`. Kebab-case matches
   the rest of `src/`.

**Verification.** The existing `app-shell-*` unit tests, `bun run ui:diff`
for the screenshot surface, and the ratchet test. Do this after change 1,
because a typed snapshot is what makes moving effects out of `App.tsx` safe
to review.

**Risk.** Medium: this is the file where fixes cluster. Mitigate by moving
one concern per PR and by leaning on the typed seam from change 1 so each
extraction is compiler-checked.

### 5. The engine directory is a flat bag of eight concerns

**Evidence.**

- `src/js/milkdrop/` has 88 top-level files (33,054 lines) beside its
  subfolders. By prefix they group into catalog (10 files), compiler
  front-end (about 14: `compiler.ts`, `expression*`, `shader-ast.ts`,
  `salvage-compile.ts`, `wgsl-*`, `field-normalization.ts`, ...), feedback
  (10 `feedback-*`), renderer (11 `renderer-*`), preset tooling (13
  `preset-*` plus `reactivity-probe.ts`, `ai-preset-synthesizer.ts`,
  `builtin-docs.ts`, `formatter.ts`), editor (`editor-session.ts`,
  `editor-worker.ts`, `overlay/`), runtime (`runtime.ts`, `runtime-signals.ts`,
  `runtime-types.ts`, `live-tile-pool.ts`, `trace-capture.ts`, ...), and
  flags and overrides (`webgpu-optimization-flags.ts`,
  `webgpu-query-override.ts`, `webgpu-prefetch-policy.ts`,
  `catalog-query-override.ts`, `parity-allowlist.ts`).
- [`docs/agents/src-map.md`](../agents/src-map.md) needs nine table rows of
  glob patterns to describe the directory, because the directory does not
  encode its own map.
- The two most-imported modules in `src/js` are `frontend/contracts.ts`
  (25 importers) and `milkdrop/types.ts` (24): barrels that stand in for the
  public surfaces the folders would otherwise provide.

**Proposal.** One folder per concern, each with an `index.ts` that is the
folder's public surface: `catalog/`, `compiler/` (exists; the front-end
files move in), `vm/` (exists; `vm.ts` and `vm-gpu.ts` move in),
`renderer/` (absorbing `renderer-helpers/` and `renderer-backends/`),
`feedback/`, `preset/`, `editor/` (absorbing `overlay/`), `runtime/`
(exists), and `config/` for the flags and overrides. Change 2's allowlist
then becomes "import a folder through its index", which is a one-line
cruiser rule instead of a list of 20 files.

**Migration.** After change 2 is green, one folder per PR, `git mv` plus an
import rewrite and nothing else, so review is mechanical and the cruiser
proves nothing new crossed a boundary. The cost is import churn in 289
unit-test files and 31 scripts; do each folder in a single commit so the
rewrite is one `sed` and Biome's import organizer, not hand edits.

**Docs that move with it.** `src-map.md`, `ARCHITECTURE.md`, the skill
routing tables that name engine paths, and `check:doc-references` will say
which.

**Risk.** Mechanical but wide. The mitigations are the rule from change 2
and the one-folder-per-PR cadence.

### 6. Feedback composite: one uniform table before one IR

**Evidence.**

- The renderer and feedback family is 15,124 lines. The two largest files in
  the repo are [`feedback-manager-webgpu-tsl.ts`](../../src/js/milkdrop/feedback-manager-webgpu-tsl.ts)
  (3,789 lines) and [`feedback-manager-shared.ts`](../../src/js/milkdrop/feedback-manager-shared.ts)
  (3,030), the first mirroring the second's GLSL composite as TSL node
  graphs by hand, with [`feedback-manager-webgpu-composite.ts`](../../src/js/milkdrop/feedback-manager-webgpu-composite.ts)
  (946) alongside.
- Parity (render and shader) is the #1 fix category, 22.4% in the May
  audit, where `feedback-manager-shared.ts` carried a 38.1% fix rate.
- [`WEBGPU_ARCHITECTURAL_REVAMP.md`](../WEBGPU_ARCHITECTURAL_REVAMP.md)
  workstream 2 proposes a single composite IR generating both GLSL and TSL.
  [`IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) records it as
  not started, with two stub modules removed unused because "neither had a
  code generator consuming them, and both restated uniform defaults the
  feedback managers already own".

**Consequence.** The IR has failed to start twice for the same reason: it
was built as a parallel description with no consumer, so it duplicated the
managers instead of owning anything. Meanwhile each backend can add a
uniform or a pass the other lacks, and nothing but a parity capture notices.

**Proposal.** Invert the dependency and take the smallest step that has a
consumer on day one:

1. Add `src/js/milkdrop/feedback-composite-contract.ts` (NEW) holding the
   composite's uniform names, defaults, and pass order as data.
2. Make both managers read their defaults from it, so the table is owned,
   not restated. This is the step the stubs skipped.
3. Add `tests/unit/milkdrop-feedback-uniform-contract.test.ts` (NEW): a
   differential test asserting that each manager's registered uniform set
   equals the table. A uniform added on one backend and not the other fails
   in `bun run check` instead of in a parity capture.
4. Only then evaluate generating either backend's shader from the table.
   That decision stays with the revamp plan; this proposal only makes it
   possible to start.

**Verification.** The new test, the existing `milkdrop-feedback-*` tests,
`bun run lab:backend-diff` for a frame-level check that WebGL and WebGPU
still agree, and `bun run parity:suite` before promotion.

**Risk.** Low. The table is data, both managers keep their code, and the
change is reversible by deleting the import.

## Sequencing

| Phase | Changes | Why this order |
| --- | --- | --- |
| A: safe wins | 2 (rule with seed allowlist, dead-rule cleanup, guard docblock); 1 step 1 (declare interfaces, land the probe test); 3 (derived row type and field-survival test) | All additive, all land green, and together they give later phases a compiler and a cruiser to lean on |
| B: contracts | 1 steps 2 and 3 (type the deps, flip the probe); 6 (uniform table and differential test) | Type errors surfaced here are the debt being paid; the feedback table gives the parity lane an immediate guard |
| C: shell | 4, one concern per PR, ratchet lowered each time | Needs the typed snapshot from B to be safely reviewable |
| D: shape | 5, one folder per PR; then tighten change 2 to "import through the folder index" | Needs the rule from A so each move is provably boundary-neutral |

Phases A and B are the proposal's core and stand on their own. C and D are
where the payoff compounds, and each can stop early without leaving the
tree in a worse state than today.

## Guardrails this proposal adds

| Guard | Where it runs | Rule |
| --- | --- | --- |
| `frontend-engine-seam` cruiser rule | `check:architecture` | The shell outside `frontend/engine/` imports only the engine's public surface |
| `engine-runtime-only-via-adapter` cruiser rule | `check:architecture` | Only `frontend/engine/` imports the runtime, renderers, feedback managers, VM, or compiler entry |
| `tests/unit/engine-seam-types.test.ts` (NEW) | `check` | No `any` reaches the seam |
| `tests/unit/catalog-projection-contract.test.ts` (NEW) | `check` | Every measured catalog field survives to the rendered row |
| `tests/unit/app-shell-effect-budget.test.ts` (NEW) | `check` | Raw effects in `App.tsx` only go down |
| `tests/unit/milkdrop-feedback-uniform-contract.test.ts` (NEW) | `check` | Both backends register the same composite uniforms |

New guard scripts need the docblock `check:module-docs` and
`generate:guardrails` expect; the four tests above are ordinary unit tests
and need nothing extra.

## Non-goals and deferred items

- **Not re-proposing the WebGPU revamp.** Its worker renderer, WGSL
  vectorization, render bundles, and gradual enablement stay tracked in
  [`WEBGPU_ARCHITECTURAL_REVAMP.md`](../WEBGPU_ARCHITECTURAL_REVAMP.md).
  Change 6 is a precondition for its workstream 2, not a replacement.
- **No state library.** `createDomainStore` in
  [`src/js/core/state/domain-store.ts`](../../src/js/core/state/domain-store.ts)
  with `useSyncExternalStore` is adequate. The problem in change 4 is the
  shape of the contexts, not the mechanism.
- **Not reorganizing `scripts/`.** 128 flat files are indexed by namespace
  through `bun run help` already; the pain is their coupling to engine
  internals, which change 2 measures and change 5 narrows.
- **Docs drift noted, not fixed here.** [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md)
  says the repo has 127 scripts; `package.json` has 154.
  [`FULL_REFACTOR_PLAN.md`](../FULL_REFACTOR_PLAN.md) still describes the
  retired toy stage. Both belong in a docs-only change.

## Open questions for maintainers

1. **Allowlist or folder?** Change 2 seeds an allowlist because it lands
   with zero moves. If change 5 is approved up front, a `public/` folder
   (or per-folder indexes) from the start avoids maintaining the list.
2. **Keep or retire `PresetCatalogEntry`?** Change 3 keeps it as a derived
   type. The alternative is to delete it and let the shell consume
   `MilkdropCatalogEntry` with a small view-model for the three view-only
   fields. The derived type is the smaller diff; the deletion is the
   smaller long-term surface.
3. **Unit test or `check:*` script for the seam probe?** A unit test needs
   no tooling and is already in the gate. A script would appear in
   `GUARDRAILS.md` with a rationale. The tests are proposed; promoting them
   later is cheap.

## Appendix: how the numbers were measured

All commands were run from the repository root on `main` at `3f8804e`.

Module and line counts:

```bash
find src/js -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l
find src/js -type f \( -name '*.ts' -o -name '*.tsx' \) -exec wc -l {} + | sort -rn | head -45
ls -1 src/js/milkdrop | grep -E '\.(ts|tsx)$' | wc -l
```

Cross-boundary imports (shell → engine, outside the adapter directory):

```bash
grep -rlE "from '[^']*/milkdrop/" src/js/frontend --include='*.ts' --include='*.tsx' \
  | grep -v '^src/js/frontend/engine/' | wc -l
grep -rE "from '[^']*/milkdrop/[^']*'" src/js/frontend --include='*.ts' --include='*.tsx' \
  | grep -v '^src/js/frontend/engine/' \
  | sed -E "s/^[^:]+:.*from '([^']*)'.*/\1/; s#^(\.\./)+##" | sort | uniq -c | sort -rn
```

Effect census, context members, and inferred contracts:

```bash
grep -c 'useEffect(' src/js/frontend/App.tsx
awk '/^export interface WorkspaceContextValue/,/^}/' src/js/frontend/workspace-context.tsx \
  | grep -cE '^\s+[a-zA-Z]+\??\s*[:(]'
grep -rn 'ReturnType<typeof' src/js --include='*.ts' --include='*.tsx' | wc -l
grep -rn 'as unknown as' src/js --include='*.ts' --include='*.tsx' | wc -l
```

The seam type probe. Save it as `src/js/__seam-probe.ts` (NEW), run
`bun run typecheck`, and delete it. Each positive line compiles only if the
named type is `any`; the control line must fail, which proves the probe is
checking:

```ts
import type { EngineSnapshot } from './frontend/engine/engine-snapshot.ts';
import type { createMilkdropExperience } from './milkdrop/runtime.ts';
type C = ReturnType<typeof createMilkdropExperience>;
type S = ReturnType<C['getStateSnapshot']>;
type IsAny<T> = 0 extends 1 & T ? true : false;
export const snapshotIsAny: IsAny<S> = true;
export const catalogEntriesIsAny: IsAny<EngineSnapshot['catalogEntries']> = true;
export const sessionStateIsAny: IsAny<NonNullable<EngineSnapshot['sessionState']>> = true;
export const adaptiveQualityIsAny: IsAny<NonNullable<EngineSnapshot['adaptiveQuality']>> = true;
export const applyFieldsParamIsUnknown: unknown extends Parameters<C['applyFields']>[0] ? true : false = true;
// Control: declared `string | null`, so this line MUST error.
export const control: IsAny<EngineSnapshot['activePresetId']> = true;
```

Guard and audit runs:

```bash
bun run check:architecture        # 1,717 modules, 5,106 dependencies, 0 violations, ~15 s
bun run audit:fix-categories      # needs a full clone; this session's clone held 50 commits
```
