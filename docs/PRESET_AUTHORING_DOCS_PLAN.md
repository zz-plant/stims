# Preset Authoring Docs — Master Plan

Goal: build the definitive learning path for writing and editing MilkDrop presets — good enough, combined with Stims itself, to bring a new generation into the hobby. This document is the assessment of the existing landscape plus the full plan.

Status: proposal (2026-08-11). Nothing here is built yet except where marked SHIPPED.

---

## Part 1 — Assessment: what exists today

Surveyed August 2026. Full detail lives in the research notes below; this is the load-bearing summary.

### The canon is two documents, both frozen

| Resource | Year | What it is | Failure mode |
|---|---|---|---|
| [Geiss authoring guide](https://www.geisswerks.com/milkdrop/milkdrop_preset_authoring.html) | ~2008 | The only complete spec: variable pools, q-vars, custom waves/shapes, HLSL shader reference | Reference, not pedagogy. ~2 worked examples in 15k words. Assumes DirectX/HLSL literacy. Its own "beginners start here" link (milkdrop.co.uk) is dead. |
| [Rovastar/Krash Beginners Guide](https://milkdrop.org/resources/beginners-guide) | **2002** | The only true tutorial: progressive, four line-by-line preset dissections | Predates MilkDrop 2 by five years. No shaders, no modern q-var usage, no custom waves/shapes as actually used. |

A 24-year-old tutorial is still the best beginner document the community has. That is the headline finding.

### Everything else

- **projectM**: no authoring docs; wiki links back to the 2008 Geiss guide. Compatibility knowledge lives in scattered GitHub issues.
- **Butterchurn**: the most accessible runtime (any browser) has *zero* authoring docs. The HLSL→GLSL transpile behavior — what authors most need to know — is documented nowhere.
- **MilkDrop3** (active, v3.33 March 2026): extends the format (.milk2, q33–q64, shader FFT) with README-only docs. The format is forking ahead of its own spec.
- **The community knowledge base is inaccessible**: Winamp forums (15 years of technique Q&A from Rovastar, Flexi, Krash, martin, Eo.S.) are Cloudflare-walled; wiki.winamp.com is DNS-dead; both still rank in search. A newcomer's first hour is link archaeology.
- **The real curriculum is 50,000 .milk files** with author comments — unsearchable, requiring you to already read the format to learn the format. No cookbook has ever extracted the named tricks.
- **Practicing VJs redistribute doc bundles via Patreon** (ISOSCELES/NestDrop) because the docs situation is that bad.
- **One substantive video tutorial exists** (Jason Fletcher's mashup/editing walkthrough).
- **milkdrop.org** is the one active preservation hub — it re-hosts the two canonical guides but authors nothing new.

### What is taught well, poorly, or not at all

Covered adequately: the format spec (frozen at 2008), in-app tweaking, mashup workflow.

Covered poorly: q-var architecture (spec'd, never taught), shader writing (intrinsics table + two examples).

**Never covered anywhere:**
1. **The feedback-loop mental model** — that each frame samples the previous frame through a distorted mesh. This is MilkDrop's entire magic and it has never been developed with diagrams or interaction. It's also why Shadertoy skills don't transfer.
2. **Math intuition** for why `zoom`/`rot`/`dx`/`warp` produce the motion they produce.
3. **Audio-reactivity design** — `*_att` vs raw bands, beat gating, smoothing patterns — beyond variable listings.
4. **The authoring pipeline as a diagram** (mesh → warp → blur chain → comp).
5. **Cross-engine portability** (Winamp / projectM / Butterchurn / Stims) — no compatibility matrix exists anywhere.
6. **Aesthetics**: composition, palette, pacing. The masters demonstrably have this knowledge; none of it is written down.
7. **The remix→original progression** — the path every existing author actually took has never been documented.

### Why the gold standards work and MilkDrop docs don't

The Book of Shaders, Inigo Quilez's articles, and Shadertoy share four techniques MilkDrop docs have never used: **live editable examples with instant visual feedback**, **shaping-function intuition taught with interactive graphs**, **named reusable building blocks** (a cookbook), and **remix-first learning** (fork, tweak one line, watch). Ironically, remix culture *is* MilkDrop's native culture — the multi-author filename convention proves it — but the tooling never gave it a shareable link.

---

## Part 2 — Why Stims is the right substrate

Nobody else can build these docs, because the required infrastructure already exists here:

| Capability | Where (SHIPPED) |
|---|---|
| Deep-link an entire preset into a live visualizer, serverless | `#code=<base64>` — `src/js/frontend/url-state.ts:152` |
| Embed a live visualizer in a docs page and drive it | iframe postMessage protocol (`toil:load_preset` with `milkSource`, `toil:apply_tweak`, telemetry readback) — `src/js/frontend/agent-bridge.ts`, documented in `public/llms-full.txt` |
| Full-source live editor with autocomplete, hover docs, lint, sliders, AI fix/refine/explain, safety-net rendering | `src/js/milkdrop/overlay/editor-panel.ts` |
| Serverless "check my preset" | `POST /api/validate-preset` |
| Measured feedback: per-variable audio→motion verdicts, pixel-level reactivity verdicts | `scripts/preset-lab-reactivity.ts`, `scripts/preset-lab-visual.ts`, `src/js/milkdrop/reactivity-probe.ts` |
| 1,787-preset catalog, 388 authors, thumbnails, semantic search ("find a preset that does X") | `public/milkdrop-presets/`, `/api/visual-search` |
| A complete machine-readable language spec | `MILKDROP_DSL_SPEC` in `src/js/milkdrop/preset-prompt.ts` (currently read only by LLMs) |
| A pattern language of 13 named techniques | `docs/MILKDROP_CODING_GUIDE.md` |
| Per-preset OG images so every tutorial page unfurls with the preset it teaches | `functions/api/og-preset.ts` |
| Docs already agent-queryable via MCP | `search_docs` / `read_doc_section` in `scripts/mcp-server.ts` |
| CI that fails on broken doc links | `scripts/check-doc-references.ts` |

The one thing Shadertoy/Book-of-Shaders had that MilkDrop never did — run-it-in-the-browser-right-now — Stims already ships.

---

## Part 3 — Design principles

1. **Every example is alive.** No code block without a "Run this" affordance: either an embedded iframe stage or a one-click `#code=` link into the full app. A reader should be able to complete the entire curriculum without installing anything.
2. **Change one number first.** Each lesson opens with a working preset and a single value to change, before any explanation. Explanation follows the dopamine, not the reverse.
3. **Teach the mental model before the language.** The feedback loop gets taught with an interactive diagram before a single equation is written. Everything downstream (decay, trails, zoom blur, echo) becomes derivable instead of memorized.
4. **Remix is the front door, not the consolation prize.** The curriculum's Track 0 is editing existing presets — which is how every real author actually started — and the lineage/credit system (`preset-credit.ts`) makes remixing first-class rather than furtive.
5. **Honesty about the fragmented ecosystem.** Stims is one engine among Winamp/projectM/Butterchurn/MilkDrop3. Docs state per-feature compatibility plainly and never pretend Stims quirks are MilkDrop semantics.
6. **Reference is generated, prose is written.** Variable/function tables regenerate from `expression.ts` so they can't drift (they already have — see Prereq E1). Tutorials and essays are hand-written.
7. **Measured, not vibes.** Authors get the same instrument the agents get: reactivity verdicts and visual metrics, in the editor, while typing.
8. **Attribute everything.** Techniques are named after and credited to the authors who invented them (Flexi's edge-detect comp, Rovastar's borders trick…). The docs should read as a celebration of a 25-year-old community, not a replacement for it.

---

## Part 4 — The curriculum

Eight tracks. Each track is 3–7 short lessons; each lesson is one concept, one live example, one exercise, and one "see it in the wild" link (powered by visual/semantic search into the catalog).

### Track 0 — Play (no code, 15 minutes)
Browse → find a preset you love → open the editor → drag the 12 live sliders → understand you just edited MilkDrop source → Remix (credit lineage auto-preserved) → share your first `#code=` link. Exit: the reader has published a remix without writing a line.

### Track 1 — How MilkDrop thinks (the missing mental model)
1. The feedback loop: this frame is last frame, warped. Interactive diagram: a single bright dot, a zoom value, a slider; watch trails emerge.
2. The pipeline: per-frame equations → per-vertex mesh warp → warp shader → blur chain → waves/shapes drawn on top → composite shader → screen. One diagram used consistently across the entire curriculum.
3. `decay`, and why everything in MilkDrop either accumulates or fades.
4. Time: `time`, `frame`, `fps`, and why `sin(time)` is the heartbeat of everything.

### Track 2 — Motion (per-frame equations)
`zoom`, `rot`, `dx/dy`, `cx/cy`, `sx/sy`, `warp` — each taught as "what does the feedback loop do when…", with Book-of-Shaders-style shaping-function graphs beside the live stage. Ends with a dissection of a classic motion-only preset (modernizing the 2002 guide's best trick — the line-by-line dissection).

### Track 3 — Listening (audio reactivity)
1. The six bands: `bass/mid/treb` and the `*_att` versions — taught with a live meter next to the stage.
2. The idioms as named patterns (from `MILKDROP_CODING_GUIDE.md`): volume squaring + music-time, RC smoothing, adaptive beat threshold, beat-triggered state machines.
3. What "reactive" measurably means — introduce the reactivity meter (verdicts `reactive/autonomous/static/weak`) and have the reader instrument their own preset.
4. Stims extension signals (`inputX`, `gestureScale`, `motionX`… from `MILKDROP_PRESET_RUNTIME.md`) — clearly flagged as Stims-only.

### Track 4 — Per-pixel warp fields
`per_pixel` equations, `rad`/`ang`/`x`/`y`, radial zoom, the classic tunnel/spiral/ripple family. The interactive centerpiece: a vector-field visualizer showing what your per-pixel equations do to the mesh before you run them.

### Track 5 — Waves and shapes
88%/99% of catalog presets use wavecode/shapecode; no doc anywhere teaches them. Custom waves (per-point equations, `sample`), custom shapes (instances, `tex_ang/tex_zoom` for the shape-as-second-feedback-loop trick), q-vars as the bridge between pools — finally taught properly with a data-flow diagram, not just spec'd.

### Track 6 — Shaders (warp + comp)
The cliff, bridged: GLSL-in-Stims (note honestly: MilkDrop is HLSL; Stims compiles a GLSL 1.20 dialect; the matrix in Track 8 covers differences). Sampling `sampler_main`, the blur chain, noise textures, the darken-center rationale, edge detection, chromatic aberration — each as a live diff against a shaderless base preset. Source material: the shader patterns in `MILKDROP_CODING_GUIDE.md` + `docs/architecture/shader-support-inventory.md`.

### Track 7 — Taste (the never-written aesthetics literature)
Palette strategies, pacing and scene structure, restraint, the pro-vs-amateur checklist (already drafted in the coding guide), and 4–6 deep dissections of masterworks with the original authors credited — the modern successor to the 2002 guide's four dissections. Where possible, interview living authors (Flexi, Fletcher/ISOSCELES, the milkdrop.org maintainer) and incorporate.

### Track 8 — Shipping
- **The compatibility matrix** (does not exist anywhere; instant community-wide reference): feature × engine (Winamp MD2 / projectM / Butterchurn / Stims WebGL / Stims WebGPU / MilkDrop3), sourced from `compatibility.ts`, `parity.ts`, shader-support-inventory, projectM issues, sweep scripts.
- Performance and quality: mesh size, instruction budgets, the measured-fidelity loop (`lab:reactivity` / `lab:visual` with `--file` on your own preset).
- Publishing: export `.milk`, contribute to the Stims catalog (new CONTRIBUTING.md section), share to the community hubs.

### Reference (generated + curated)
- **Language reference**: every intrinsic, operator, literal form, and NS-EEL semantic quirk (`0.00001` close-factor falsiness, assignment-to-`megabuf()`) — generated from `expression.ts` + the block-type/variable tables from `MILKDROP_DSL_SPEC`, rendered for humans.
- **Variable reference**: per-context readable/writable tables (per_frame, per_pixel, wave per-point, shape init/frame), q/t-var lifetimes — the diagram the Geiss guide should have had.
- **Sampler/texture reference**: 16 samplers, alias table, blur chain, noise textures (from `shader-samplers.ts` + coding guide).
- **Stims signals reference**: the interaction/motion extension contract.
- **The cookbook**: every named pattern (seeded from the 13 in the coding guide + editor snippet libraries, grown by mining the catalog) as a standalone IQ-style page — problem, formula, live demo, presets in the wild that use it, credited originator.

---

## Part 5 — Product work the docs depend on

### Prerequisites (blockers)
- **E1 — Single source of truth for builtins. SHIPPED 2026-08-11.** The table lives in `src/js/milkdrop/builtin-docs.ts`; the compiler intrinsic sets, syntax highlighter, autocomplete, hover docs, and the generated reference all derive from it (drift is now test-guarded). Bonus findings: `beat_pulse`/`progress`/`treble` are runtime signal variables, and the editor had been hiding `q9–q32`/`t1–t32` even though the VM supports them.
- **E2 — Fix the lossy formatter. SHIPPED 2026-08-11.** `formatMilkdropPreset` now round-trips `[warp_shader]`/`[comp_shader]` byte-identically and preserves titles; slider/field upserts were hardened against writing into shader sections. Round-trip tests cover both the section and legacy backtick formats. Caveat: drafts saved before the fix had already lost their shaders and need re-import.

### High-leverage, non-blocking
- **E3 — Live reactivity meter in the editor**: wire `reactivity-probe.ts` (already in SynthesizePanel) into the editor rail; verdict chips per variable while you type.
- **E4 — Learn surface**: a `learn` panel alongside browse/capture/editor/settings, or an embed mode (`?embedded=1&lesson=…`) consumed by an external docs site via the existing postMessage bridge. Decision needed: in-app panel vs docs site with embedded stages (recommendation: **docs site with embedded stages** — indexable by search engines, which matters for rescuing newcomers from the dead-link SERPs; the in-app editor rail gets a compact "Learn" section linking into it at the relevant lesson).
- **E5 — Technique taxonomy in the catalog**: tag presets by pattern exemplified (`technique:radial-zoom`, `technique:beat-state-machine`, `difficulty:starter`…). Powers every "see it in the wild" link. Today the catalog has 4 collections and essentially no tags.
- **E6 — "Explain this line"**: the editor already has AI explain-whole-preset; a per-line variant that links to the relevant lesson/cookbook page closes the loop from code → docs.
- **E7 — Lesson-state deep links**: extend `#code=` with `#lesson=` / highlighted-line state so docs pages can restore an exact teaching moment.

---

## Part 6 — Archive rescue

The hobby's institutional memory is rotting behind dead DNS and Cloudflare walls. A modest rescue effort compounds the docs' authority:

1. **Winamp forum MilkDrop threads** (via Wayback): Rovastar's "Preset Tutorial" series, the beginners-guide dev threads, key author Q&A. Extract techniques into cookbook pages with attribution and archive links.
2. **wiki.winamp.com/MilkDrop_Preset_Authoring** (Wayback): cross-check our generated reference against it for spec details the Geiss HTML glosses.
3. **Preset-embedded comments** across the bundled 1,782 files + cream-of-the-crop: mine for named tricks and author commentary (scriptable; the corpus is already local).
4. **The ISOSCELES Patreon doc bundle**: identify provenance of its "Pixel Shader Guide" / "GPU Fundamentals" docs; re-home if orphaned.
5. Modernize the 2002 Beginners Guide's four dissections as Track 2/7 material, credited to Rovastar & Krash.

Licensing note: rescue means *link + attribute + teach the technique in our own words*, not wholesale republication.

---

## Part 7 — Phasing

**Phase 1 — Foundation. SHIPPED 2026-08-11** (pending deploy). E1 + E2 fixed. Generated reference: `docs/authoring/reference.md` via `bun run docs:authoring-reference` (freshness-gated in `check:quick`). Tracks 1–2 live at `docs/authoring/` with 13 compiled examples and `#code=` run links, all guarded by `bun run check:authoring-examples`. The `#code=` deep link — previously advertised but only half-implemented (it opened the editor without loading the source) — now applies the decoded preset through the editor session. Public docs IA and CONTRIBUTING.md updated. *Exit criterion met locally; run links go live with the next production deploy.*

**Phases 2–4 — SHIPPED 2026-08-12** (pending deploy). All eight tracks are live at `docs/authoring/`: 36 compiled example presets across 11 lesson files, all guarded by `bun run check:authoring-docs`.

- **Track 0 (Play)** covers the remix-first no-code path through the existing UI (browse → sliders → Remix with preserved credit lineage → share via `#code=`).
- **Tracks 3–5** (Listening, Warp fields, Waves and shapes) bridge the M-menu-to-equations cliff: audio smoothing (`_att` vs raw, RC filters, the volume-clock idiom), adaptive beat-threshold detection, per-pixel `rad`/`ang` fields, and the full custom-wave/custom-shape equation syntax (`wave_N_per_point`, `shape_N_per_frame`) — none of which any prior MilkDrop resource taught end-to-end.
- **Track 6 (Shaders)** is the tutorial that didn't exist anywhere: five progressively-built `warp_shader`/`comp_shader` examples, each verified to compile via the full AST path (not a silent heuristic fallback) before publishing.
- **Track 7 (Taste)** dissects five real catalog presets — Geiss's reaction-diffusion warp shader, Pieturp's parametric shape gradients, Rovastar's dual-threshold tempo tracker, Shifter's hand-rolled HSL→RGB, and a three-author mashup — chosen to each demonstrate a technique untouched by Tracks 1–6, credited and linked live.
- **Track 8 (Shipping)** ships the compatibility matrix — the first one anywhere covering Winamp MilkDrop 2, projectM, Butterchurn, and Stims's own WebGL/WebGPU backends, built from the compiler's own compatibility/parity code and clearly separating verified-from-source claims from inferred ones — plus grounded performance guidance and the publishing path.

*Exit criteria met locally: a newcomer can go from "never seen a preset" through shaders and cross-engine compatibility without leaving the browser, and the shader tutorial + compat matrix — the two things no MilkDrop resource on earth previously provided — exist and are linkable.* E3–E7 (in-editor reactivity meter, `learn` panel, technique taxonomy, explain-this-line, lesson deep links) and the archive-rescue sweep remain open follow-on work — see Part 5/6 above.

## Success criteria

- A person with zero shader background reaches "published an original preset" in one sitting, verified by user testing, not assertion.
- Searching "how to write milkdrop presets" surfaces a live, current resource above the dead links.
- The reference is generated from code and cannot drift; CI (`check-doc-references`) guards every link.
- Preset submissions from first-time authors arrive in the community catalog (D1 `presets.ts` already supports this).
- Other engines link to the compatibility matrix rather than re-deriving it in GitHub issues.

---

*Research provenance: web survey of the documentation landscape and full repo asset inventory, August 2026. Key sources: geisswerks.com authoring guide; milkdrop.org mirrors; projectM wiki/issues; Butterchurn repos; MilkDrop3 README; The Fulldome Blog; Winamp forum archives (Wayback); The Book of Shaders; iquilezles.org.*
