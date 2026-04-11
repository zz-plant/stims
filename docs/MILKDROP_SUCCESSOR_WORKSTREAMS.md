# MilkDrop successor workstreams

This page turns the current Stims direction into parallel work that can run without stepping on itself.

Stims is an independent browser-native visualizer in the MilkDrop lineage. The goal is to become the strongest credible successor candidate in this repo, not to claim full projectM replacement before the evidence exists.

## Workstreams

### 1. Parity and fidelity

Own the compiler, VM, renderer, and measured reference corpus needed to make support claims honest.

Primary requirement:

- Stims itself must compile and run `.milk` presets imported from the broader projectM ecosystem.
- External `projectM` reference images are proof inputs, not a client runtime dependency.

Primary files:

- `assets/js/milkdrop/compiler/*`
- `assets/js/milkdrop/vm/*`
- `assets/js/milkdrop/renderer-helpers/*`
- `assets/data/milkdrop-parity/*`
- `tests/milkdrop-parity.test.ts`
- `tests/milkdrop-projectm-compat.test.ts`

Exit signal:

- certification-corpus presets compile and step inside Stims
- measured visual results exist for the certified corpus
- shipped fidelity labels are derived from evidence, not optimism

Bundled shipped preset lane:

- `eos-glowsticks-v2-03-music`
- `rovastar-parallel-universe`
- `eos-phat-cubetrace-v2`
- `krash-rovastar-cerebral-demons-stars`

These four presets are the current bundled proof loop. They should be pushed through capture, `projectM` reference import, checked-in reference promotion, suite diffing, and measured-result promotion in that order.

### 2. Runtime performance

Own the hot path where frame time and GC pressure matter most.

Primary files:

- `assets/js/milkdrop/runtime.ts`
- `assets/js/milkdrop/vm.ts`
- `assets/js/milkdrop/vm/frame-generation.ts`
- `assets/js/milkdrop/vm/wave-builder.ts`
- `assets/js/milkdrop/renderer-adapter*.ts`

Exit signal:

- fewer per-frame allocations in the core render loop
- no visible regression in preset playback or controls

### 3. Browser-native product

Own the React shell, route state, and overlay UX that make Stims feel better than a desktop port in the browser.

Primary files:

- `assets/js/frontend/*`
- `assets/js/milkdrop/overlay/*`
- `public/milkdrop-presets/catalog.json`

Exit signal:

- launch, browse, and recovery flows are cleaner than the legacy path
- mobile and keyboard workflows remain coherent

### 4. Proof and release

Own the evidence chain that justifies stronger claims and keeps the repo honest.

Primary files:

- `scripts/run-quality-gate.ts`
- `scripts/run-parity-diff-suite.ts`
- `scripts/promote-parity-suite-result.ts`
- `tests/visual-reference-manifest.test.ts`
- `tests/measured-visual-results.test.ts`
- `docs/DEVELOPMENT.md`
- `docs/LINEAGE_AND_CREDITS.md`

Exit signal:

- quality gates cover the relevant claims
- public wording matches the strongest evidence actually present

## Coordination rule

Prefer one owner per workstream and avoid cross-cutting edits unless a change is explicitly about handoff or shared proof. Parity and runtime work can move in parallel, but claim changes should wait for proof work to catch up.
