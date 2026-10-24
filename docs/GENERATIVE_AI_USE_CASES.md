# Generative AI use cases

Stims ships hosted preset generation, refinement, blending, image-guided generation, and semantic search, plus a Generate panel, local visual retrieval, typed decision tools, and measurement labs. Extend these around an editable result that a user can compare, accept, save, and share. The roadmap principle still applies: a foundation becomes a feature when it is connected, usable, and verified.

Companion docs: [`api.md`](./api.md) (endpoint reference), [`MCP_SERVER.md`](./MCP_SERVER.md) (agent tooling), [`MILKDROP_CODING_GUIDE.md`](./MILKDROP_CODING_GUIDE.md) (the authoring spec generation targets), [`ROADMAP.md`](./ROADMAP.md) (overall priorities), [`guides/training-models.md`](./guides/training-models.md) (datasets and benchmarks for training and scoring models).

The [learning-loop specification](./LEARNING_LOOPS_SPEC.md) owns the planned episode/index contracts, nine workflows, model roles, privacy, budgets, and release criteria. The sections below summarize current capabilities and the remaining generation work.

## Current state

### Shipped AI surface

| Piece | Where | What it does |
| --- | --- | --- |
| Text → preset | [`functions/api/generate-preset.ts`](../functions/api/generate-preset.ts) | Complexity-classified model routing, auto-titling (no cache — every request generates) |
| Conversational refine | [`functions/api/refine-preset.ts`](../functions/api/refine-preset.ts) | Instruction + history over existing `.milk` source; called from the editor panel and side panel |
| Image → preset | [`functions/api/image-to-preset.ts`](../functions/api/image-to-preset.ts) | Vision description → generated preset; wired to the Generate panel's reference-image input |
| Blend two presets | [`functions/api/blend-presets.ts`](../functions/api/blend-presets.ts) | Waves/motion from A, palette/atmosphere from B; called from the editor panel |
| Batch variations | [`functions/api/batch-generate.ts`](../functions/api/batch-generate.ts) | Up to 5 parallel seeded variations; called from the editor panel |
| Semantic search | [`functions/api/visual-search.ts`](../functions/api/visual-search.ts) | Embedding search over preset descriptions; called from the visual-embedding and audio-matcher services |
| Look-alikes | [`preset-visual-vectors.ts`](../src/js/core/services/preset-visual-vectors.ts) | On-device neighbours from EmbeddingGemma 2 preview vectors, shipped as a static file; backs Nearby, the finder's "By look" for catalog presets, Browse's "Like your saved" sort, Browse's ranking of visual-term searches (term vectors in `visual-terms.json`), and the visual `searchTerms` in the catalog |
| Real-compiler validation | [`functions/api/validate-preset.ts`](../functions/api/validate-preset.ts) | POST source → compiles with the real preset compiler and returns its diagnostics (parse + EEL compile errors, warnings); shader GLSL itself still only classifies statically |
| Generate panel | [`src/js/frontend/SynthesizePanel.tsx`](../src/js/frontend/SynthesizePanel.tsx) | Bundled UI; hosted route, loopback OpenAI-compatible (local) provider, or a BYOK OpenRouter provider (browser sends the key straight to openrouter.ai) |
| Client generation core | [`src/js/milkdrop/preset-generator.ts`](../src/js/milkdrop/preset-generator.ts), [`preset-prompt.ts`](../src/js/milkdrop/preset-prompt.ts) | Provider abstraction; prompt scaffolding shared by client and Worker; compiles returned source before loading |
| Generation tournament | [`preset-generator.ts`](../src/js/milkdrop/preset-generator.ts) | Compiles and scores multiple candidates using reactivity/richness signals; does not yet retrieve edit episodes or run visual repair |
| Reference starting point | [`ReferenceFinderPanel.tsx`](../src/js/frontend/ReferenceFinderPanel.tsx), [`reference-retrieval.ts`](../src/js/frontend/reference-retrieval.ts) | On-device retrieval of editable starting presets from a reference description (text scorer + EmbeddingGemma 2 visual terms, no upload); optional Clef pick against an uploaded reference image; opens the chosen preset in the editor |
| Local episode store | [`learning-loop-store.ts`](../src/js/core/services/learning-loop-store.ts) | Bounded (100 episodes / 32 MiB) on-device record of reference-remix runs with explicit outcomes; accepted references seed later runs |
| Typed media judgments | [Decision models](./DECISION_MODELS.md) | Explicit picture/animation checks, audio shortlist selection, one-shot performance scene choice, reference starting-point selection, and reviewed offline catalog/capture judgments |
| Deterministic fallback | [`src/js/milkdrop/ai-preset-synthesizer.ts`](../src/js/milkdrop/ai-preset-synthesizer.ts) | Non-LLM themed template synthesizer; offline fallback and eval control |
| Measurement labs | [`scripts/preset-lab-reactivity.ts`](../scripts/preset-lab-reactivity.ts), [`scripts/preset-lab-visual.ts`](../scripts/preset-lab-visual.ts) | Headless per-variable reactivity verdicts; browser pixel/reactivity metrics; both support baseline/compare |
| Generation benchmark | [`scripts/preset-lab-generation-bench.ts`](../scripts/preset-lab-generation-bench.ts) | `lab:generation-bench` scores any generation provider (default: the deterministic synthesizer as control) against a frozen prompt set on real-compiler compile success and the reactivity probe, with baseline/compare; render-based visual metrics remain an open stub (`--visual`) |
| Agent tooling | [`scripts/mcp-server.ts`](../scripts/mcp-server.ts), [`docs/MCP_SERVER.md`](./MCP_SERVER.md) | MCP tools including a describe → see → tweak → compare loop |

### Evidence boundaries

Per [`TECHNICAL_ACHIEVEMENTS.md`](./TECHNICAL_ACHIEVEMENTS.md), the Generate panel is model-backed but "hosted deployment availability, local browser configuration, output quality, and the full generated-preset user flow still require end-to-end verification," and "blending and the other optional services are not part of that bundled flow." The local application does not require any of these services for playback, browsing, editing, or import/export — that constraint holds for everything proposed below.

### Open gaps

Closed since this list was first written: the generation quality gate and the generation bench (#1404, recorded below), local-model scoring on the edit and shader-fix benchmarks (`lab:llm-answer`, #1445), and remix lineage in exports and share links (#1371, #1403).

1. No generation flow has browser-backed end-to-end proof on a configured deployment, for the hosted route, the loopback provider, or OpenRouter.
2. No automatic visual repair loop runs generate → diagnose → render/measure → revise → review. The existing tournament compiles and ranks candidates, while explicit media checks remain separate actions. The bench's render-based metric (`--visual`) is still a stub.
3. Generated shader blocks are not checked before they are shown. [`preset-prompt.ts`](../src/js/milkdrop/preset-prompt.ts) tells models to avoid `[warp_shader]`/`[comp_shader]` unless asked and gives no worked example; the static compiler only classifies shader text, and the GPU compiles it at render time. The shader-fix bench compiles model answers offline, which measures repair of existing translations, not generation.
4. Generated presets record no provenance: the prompt, source presets and model are not written to the exported file. Remix lineage is.

## Now: verify and gate what already generates

### Generation quality gate

Before adding surfaces, make the existing text → preset path trustworthy.

- Done: the Generate panel now chains compile diagnostics with an in-browser reactivity probe ([`src/js/milkdrop/reactivity-probe.ts`](../src/js/milkdrop/reactivity-probe.ts)) that steps the VM silent-vs-audio and labels presets whose equations ignore audio, plus a render-based near-black check ([`src/js/frontend/generated-preset-visual-check.ts`](../src/js/frontend/generated-preset-visual-check.ts)) that samples the live stage for a few seconds after load and labels presets whose picture never lights up as low-confidence. The bench-side visual metric remains open (`--visual` stub in `lab:generation-bench`).
- Done: the hosted [`validate-preset`](../functions/api/validate-preset.ts) route now compiles the submitted source with the real preset compiler and maps its diagnostics onto the same response shape — `valid` reflects the compile result, so invalid expressions and shader control programs are rejected instead of passing a paren counter.
- Reuse the deterministic synthesizer as a control: generation should measurably beat the template fallback on reactivity and visual-variance metrics, or the model call was not worth it.
- Complete the end-to-end verification the achievements doc calls out: hosted availability, loopback/local configuration, and the full browser flow.

Exit criteria:

- a generated preset shown to the user has passed compile diagnostics and a reactivity check, or carries a visible low-confidence label;
- the generated-preset flow has browser-backed end-to-end proof for both hosted and local providers; and
- generation quality is measured against the deterministic-synthesizer control, not asserted.

### Finish and verify the endpoint surfaces

Refine, blend, and batch variations already have editor-panel actions ([`src/js/milkdrop/overlay/editor-panel.ts`](../src/js/milkdrop/overlay/editor-panel.ts)); the work is upgrading them from fire-and-replace to trustworthy, not wiring them from scratch.

- **Inspectable diffs for assisted edits.** Done: the editor's refine, blend, variation, and quick-fix actions now propose a reviewable line diff ([`src/js/milkdrop/overlay/source-diff.ts`](../src/js/milkdrop/overlay/source-diff.ts)) with explicit Apply/Discard instead of replacing the buffer — the named Remix-studio bullet in [`ROADMAP.md`](./ROADMAP.md).
- **Blend from the catalog.** Blend today requires pasting source into the editor flow; add two-preset selection from the catalog feeding [`blend-presets`](../functions/api/blend-presets.ts), loaded through the same compile-before-load path the Generate panel uses.
- **Image to preset.** Wired: the Generate panel's hosted mode accepts a reference image feeding [`image-to-preset`](../functions/api/image-to-preset.ts) through the same compile-before-load path. Remaining work is end-to-end verification on a configured deployment.
- **Semantic search as an optional enhancer.** [`visual-search`](../functions/api/visual-search.ts) already backs the optional embedding services; surface it in catalog search as an optional layer, never a blocker for local search (roadmap principle).

Exit criteria:

- every AI-assisted edit is inspectable as a source diff before it applies;
- image-guided generation is reachable from the running session; and
- all surfaces degrade cleanly when the optional services are unreachable.

## Next: close the loop and raise the ceiling

### Closed-loop iteration and a generation benchmark

Start with [reference to editable preset (LL-01)](./LEARNING_LOOPS_SPEC.md#ll-01-reference-to-editable-preset), then [intent-preserving remix (LL-02)](./LEARNING_LOOPS_SPEC.md#ll-02-intent-preserving-remix) and [repair memory (LL-03)](./LEARNING_LOOPS_SPEC.md#ll-03-repair-memory). EmbeddingGemma retrieves source/render/edit examples; Clef checks narrow properties or selects a supplied strategy; an evaluated writer drafts the patch. Compile, render, measure, review, and record an explicit outcome within the spec's attempt and resource bounds.

The LL-01 retrieval half is shipped: the bounded episode store and the on-device reference finder in the Generate panel retrieve an editable starting preset, record proposal/applied/accept/reject outcomes, and reuse accepted references. The remaining LL-01 work is the writer-proposed diff plus render-and-measure under matching conditions, then the frozen baseline that measures accepted editable results and total latency against the current search and image-generation controls.

[`lab:generation-bench`](../scripts/preset-lab-generation-bench.ts) already scores a frozen prompt set on real-compiler success and the reactivity probe, with baseline/compare and the deterministic synthesizer as control. Render-based metrics and the autonomous iteration path remain open. Pair the existing CPU VM dataset with actual captures before using it for visual learning. Each proposed change needs before/after evidence under matching conditions; teacher/model preferences stay separate from human outcomes.

Exit criteria:

- a bounded run retrieves a relevant example, drafts and verifies a patch, and returns reviewable evidence without replacing the working source on failure;
- the workflow stores and reuses an explicit outcome, with stale-source and cancellation coverage; and
- prompt or routing changes land with family-held-out baseline comparisons covering acceptance, preservation/repair failures, latency, and usage.

### Verified shader generation

- The prompt scaffolding for GLSL `[warp_shader]`/`[comp_shader]` blocks already exists in [`preset-prompt.ts`](../src/js/milkdrop/preset-prompt.ts) but is defensive: models are told to avoid shader blocks unless asked, and there are no worked examples. Raise quality with examples drawn from the coding guide's AI-generation guidance, anti-patterns, and engine-limitation notes.
- Static compiler diagnostics cannot prove a shader works — the GPU compiles the GLSL at render time. The gate for shader-bearing presets therefore needs a browser or headless render-compile check (the `lab:visual` path already renders in Chromium) on top of the compile-diagnose-measure chain.

Exit criteria:

- generated presets can include working shader blocks, verified by a render-compile check in the benchmark corpus rather than by static diagnostics or inspection.

## Later: provenance and session assistance

- **Provenance and attribution.** Offer generation/remix provenance in exported `.milk` files or companion metadata, extending [`preset-credit.ts`](../src/js/milkdrop/preset-credit.ts). Preserve source credit and model identity; include private prompts or reference media only when explicitly selected. Reviewed provenance is a prerequisite for community-gallery promotion of generated work.
- **Phrase-aware performance (LL-05).** The client already offers one-shot Omni audio matching and a saved-scene choice. Extend these with look-ahead, bridge presets, local ramps, bounded change rates, and immediate manual takeover under the [performance contract](./LEARNING_LOOPS_SPEC.md#ll-05-phrase-aware-performance). Evaluate unfamiliar music and shuffled-audio controls before claiming musical fit.
- **Teaching and session taste (LL-04/07).** Retrieve a proven effect and one small editable example, or diversify suggestions from explicit local outcomes. Keep explanations tied to actual dataflow and make preference history deletable; [the spec](./LEARNING_LOOPS_SPEC.md#loop-requirements) owns acceptance criteria.

## Research, not roadmap commitments

Consistent with [`ROADMAP.md`](./ROADMAP.md): neural audio-to-visual generation, latent/Gaussian-splat rendering, and fine-tuning custom preset models remain research. [Measured parameter optimization (LL-09)](./LEARNING_LOOPS_SPEC.md#ll-09-measured-parameter-optimization) also needs paired render measurements and a held-out gain over simple search before a product commitment. Code may exist, but it stays labeled scaffolding until an end-to-end workflow and verification plan exist.

## Suggested implementation order

1. Generation quality gate and end-to-end verification of the existing Generate flow (unblocks honest claims about everything else).
2. Reference-guided remix with bounded local episodes and the reference corpus refresh (LL-00/01/08); retain the shipped source-diff review flow.
3. Intent-preserving edits and repair memory (LL-02/03), with rendered benchmarks and generation provenance.
4. Experiment selection (LL-06) only where those workflows need more evidence; use existing instruments and a fixed capture budget.
5. Teaching and local session taste (LL-04/07); separately evaluate the armed performance pilot (LL-05).
6. Shader-era generation after render-compile and held-out repair evidence support it. Keep parameter surrogates (LL-09) in research until their prerequisites are met.

## Typed decision workflows

[Decision models](./DECISION_MODELS.md) connects the existing compiler, catalog, visual captures, local search, generation tournament, and performance scenes to six fixed Clef question sets (the five original tasks plus `reference-choice`). Flash handles image observations and generation routing; Omni handles explicitly supplied audio/video evidence. The browser picture check and MCP suggestions are opt-in. The lab runner stores reviewable results, supports held-out labels, and promotes only intersected visual tags across both backends and orientations with matching capture-time source hashes.

These integrations have contract and orchestration tests. They do not establish model accuracy, tagging quality, or musical fit on the Stims corpus. Acceptance thresholds are provisional until a family-held-out comparison measures coverage, errors, calibration, latency, and cost. `lab:generation-bench --visual` remains a stub: the new explicit picture check does not complete an autonomous generate-render-repair loop. Safety, parity, compatibility, and performance claims remain attached to their deterministic instruments.
