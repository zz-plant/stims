# Generative AI use cases

Stims already ships a substantial generative-AI surface: hosted Workers AI endpoints for preset generation, refinement, blending, image-guided generation, and semantic search, plus a bundled Generate panel and headless measurement labs. This document proposes where generative AI should go next as a set of product use cases. The framing is extension and hardening of what exists — not greenfield — and follows the roadmap principle that a foundation is not a feature until it is connected, usable, and verified.

Companion docs: [`api.md`](./api.md) (endpoint reference), [`MCP_SERVER.md`](./MCP_SERVER.md) (agent tooling), [`MILKDROP_CODING_GUIDE.md`](./MILKDROP_CODING_GUIDE.md) (the authoring spec generation targets), [`ROADMAP.md`](./ROADMAP.md) (overall priorities).

## Current state

### Shipped AI surface

| Piece | Where | What it does |
| --- | --- | --- |
| Text → preset | [`functions/api/generate-preset.ts`](../functions/api/generate-preset.ts) | Complexity-classified model routing, auto-titling (no cache — every request generates) |
| Conversational refine | [`functions/api/refine-preset.ts`](../functions/api/refine-preset.ts) | Instruction + history over existing `.milk` source; called from the editor panel and side panel |
| Image → preset | [`functions/api/image-to-preset.ts`](../functions/api/image-to-preset.ts) | Vision description → generated preset; embedding cache serves a matched gallery preset's source when resolvable; wired to the Generate panel's reference-image input |
| Blend two presets | [`functions/api/blend-presets.ts`](../functions/api/blend-presets.ts) | Waves/motion from A, palette/atmosphere from B; called from the editor panel |
| Batch variations | [`functions/api/batch-generate.ts`](../functions/api/batch-generate.ts) | Up to 5 parallel seeded variations; called from the editor panel |
| Semantic search | [`functions/api/visual-search.ts`](../functions/api/visual-search.ts) | Embedding search over preset descriptions; called from the visual-embedding and audio-matcher services |
| Syntax pre-check | [`functions/api/validate-preset.ts`](../functions/api/validate-preset.ts) | POST source → line-level diagnostics (assignments, parentheses); a lightweight check that does not run the preset compiler |
| Generate panel | [`src/js/frontend/SynthesizePanel.tsx`](../src/js/frontend/SynthesizePanel.tsx) | Bundled UI; hosted route or loopback OpenAI-compatible (local) provider |
| Client generation core | [`src/js/milkdrop/preset-generator.ts`](../src/js/milkdrop/preset-generator.ts), [`preset-prompt.ts`](../src/js/milkdrop/preset-prompt.ts) | Provider abstraction; prompt scaffolding shared by client and Worker; compiles returned source before loading |
| Deterministic fallback | [`src/js/milkdrop/ai-preset-synthesizer.ts`](../src/js/milkdrop/ai-preset-synthesizer.ts) | Non-LLM themed template synthesizer; offline fallback and eval control |
| Measurement labs | [`scripts/preset-lab-reactivity.ts`](../scripts/preset-lab-reactivity.ts), [`scripts/preset-lab-visual.ts`](../scripts/preset-lab-visual.ts) | Headless per-variable reactivity verdicts; browser pixel/reactivity metrics; both support baseline/compare |
| Agent tooling | [`scripts/mcp-server.ts`](../scripts/mcp-server.ts), [`docs/MCP_SERVER.md`](./MCP_SERVER.md) | MCP tools including a describe → see → tweak → compare loop |

### Evidence boundaries

Per [`TECHNICAL_ACHIEVEMENTS.md`](./TECHNICAL_ACHIEVEMENTS.md), the Generate panel is model-backed but "hosted deployment availability, local browser configuration, output quality, and the full generated-preset user flow still require end-to-end verification," and "blending and the other optional services are not part of that bundled flow." The local application does not require any of these services for playback, browsing, editing, or import/export — that constraint holds for everything proposed below.

### Gaps this document targets

1. The endpoint surfaces are wired but unverified. Generate and image-guided generation live in the Generate panel, refine, blend, and batch variations have editor-panel actions, and visual search backs the optional embedding/audio-matcher services — but none of these flows has end-to-end proof or quality gating.
2. Nothing gates generated presets on quality. The hosted [`validate-preset`](../functions/api/validate-preset.ts) route is syntax-only (it never runs the real compiler), `lab:reactivity` and `lab:visual` run nowhere in the generation path, and no chain runs generate → diagnose → measure → regenerate before a generated preset reaches the user.
3. There is no eval corpus or benchmark for generation quality, in contrast to the mature parity/certification corpus for rendering.
4. Shader generation is unverified. [`preset-prompt.ts`](../src/js/milkdrop/preset-prompt.ts) already documents the GLSL `[warp_shader]`/`[comp_shader]` blocks but tells models to avoid them unless asked, ships no worked examples, and nothing verifies that emitted GLSL actually compiles — the static compiler only classifies shader text; the GPU compiles it at render time.
5. Provenance and attribution for generated or remixed presets is unspecified, though [`src/js/milkdrop/preset-credit.ts`](../src/js/milkdrop/preset-credit.ts) and the roadmap's "record remix provenance" bullet point at where it belongs.

## Now: verify and gate what already generates

### Generation quality gate

Before adding surfaces, make the existing text → preset path trustworthy.

- Done in part: the Generate panel now chains compile diagnostics with an in-browser reactivity probe ([`src/js/milkdrop/reactivity-probe.ts`](../src/js/milkdrop/reactivity-probe.ts)) that steps the VM silent-vs-audio and labels presets whose equations ignore audio. Near-black detection still needs a render-based check.
- Wire the hosted [`validate-preset`](../functions/api/validate-preset.ts) route to the real compiler (or route validation through client-side compilation) before anything treats it as a quality gate — today it is a line-level syntax check that passes invalid expressions and shader programs.
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

- Chain generate → validate → measure → regenerate as an agent-facing loop, building on the MCP server's existing describe → see → tweak → compare tooling, with lab compare modes ("movers" tables, side-by-side contact sheets) as the iteration signal.
- Establish a generation benchmark corpus mirroring the certification-corpus pattern: a fixed prompt set, scored on compile success, reactivity verdicts, and visual metrics, tracked over time so model routing and prompt changes are regressions-tested like renderer changes.

Exit criteria:

- an agent (or CI job) can run the full loop headlessly from one command; and
- prompt or model-routing changes land with before/after benchmark numbers.

### Verified shader generation

- The prompt scaffolding for GLSL `[warp_shader]`/`[comp_shader]` blocks already exists in [`preset-prompt.ts`](../src/js/milkdrop/preset-prompt.ts) but is defensive: models are told to avoid shader blocks unless asked, and there are no worked examples. Raise quality with examples drawn from the coding guide's AI-generation guidance, anti-patterns, and engine-limitation notes.
- Static compiler diagnostics cannot prove a shader works — the GPU compiles the GLSL at render time. The gate for shader-bearing presets therefore needs a browser or headless render-compile check (the `lab:visual` path already renders in Chromium) on top of the compile-diagnose-measure chain.

Exit criteria:

- generated presets can include working shader blocks, verified by a render-compile check in the benchmark corpus rather than by static diagnostics or inspection.

## Later: identity and ambient intelligence

- **Provenance and attribution.** Record generation/remix provenance (prompt, source presets, model) in exported `.milk` files or companion metadata, extending [`preset-credit.ts`](../src/js/milkdrop/preset-credit.ts). Prerequisite for any community-gallery promotion of generated work.
- **Audio-aware auto-DJ.** Grow the client's [`audio-matcher`](../src/js/core/services/audio-matcher.ts) service (which matches audio character against preset embeddings via `visual-search`) into a session mode that re-ranks or transitions presets as the audio changes, treated as an optional enhancement over local playback. The redundant server-side `audio-select` route was retired in favor of this client path.

## Research, not roadmap commitments

Consistent with [`ROADMAP.md`](./ROADMAP.md): neural audio-to-visual generation, latent/Gaussian-splat rendering, and fine-tuning custom preset models remain research. Code may exist, but it stays labeled scaffolding until an end-to-end product workflow and verification plan exist.

## Suggested implementation order

1. Generation quality gate and end-to-end verification of the existing Generate flow (unblocks honest claims about everything else).
2. Refine-in-editor with source diffs (highest roadmap alignment: Remix studio).
3. Blend and image-to-preset surfaces; semantic search enhancer.
4. Generation benchmark corpus, then the closed agent loop on top of it.
5. Shader-era generation, gated by the benchmark.
6. Provenance metadata, then audio-aware auto-DJ.
