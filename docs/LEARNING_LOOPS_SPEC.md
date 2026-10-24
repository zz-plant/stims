# Learning loops for discovery, authoring, and performance

**Status: foundation shipped, 2026-10-23.** The loops below extend shipped retrieval, generation, decision, and measurement tools. The episode store (LL-00) and the retrieval half of [LL-01](#ll-01-reference-to-editable-preset) are implemented; the automatic visual repair loop, continuous conductor, and learned parameter surrogate are not. The [roadmap](./ROADMAP.md#learning-loops-for-authoring-and-discovery) owns priority; this document owns the proposed contracts and release criteria. [Decision models](./DECISION_MODELS.md) describes the current API.

The first deliverable is a reference-guided remix: find an editable starting point, propose a small change, compare it under matching conditions, and retain an explicit outcome. Each later loop must improve a studio task: browse, listen, edit, compare, save, share, or record. Shared storage and measurement work ships with that task.

## Existing capabilities and missing connections

| Capability | Existing seam | Gap the loops address |
| --- | --- | --- |
| Visual retrieval | [Preview vectors](../src/js/core/services/preset-visual-vectors.ts): local neighbors, diversity ranking, visual terms, vector search and blending | Arbitrary reference queries, multiple capture contexts, and retrieval of edits or failures |
| Description retrieval | [Hosted visual search](../functions/api/visual-search.ts) uses BGE description vectors | Richer descriptions and evaluation against direct multimodal retrieval; BGE and EmbeddingGemma vectors belong to separate spaces |
| Generation and edits | [Generation tournament](../src/js/milkdrop/preset-generator.ts), [refine](../functions/api/refine-preset.ts), [reviewable source diff](../src/js/milkdrop/overlay/source-diff.ts) | Retrieved examples, bounded render-and-repair, and durable accept/revert outcomes |
| Typed judgments | [Fixed Clef tasks](../src/js/core/decision-model.ts) and [decision endpoint](../functions/api/decide.ts) | Task-specific calibration and new server-owned schemas where the five existing tasks do not fit |
| Audio and animation checks | [By sound](../src/js/frontend/PresetFinderPanel.tsx), [Check animation](../src/js/frontend/SynthesizePanel.tsx), and [performance scenes](../src/js/frontend/live-performance.ts) | Repeated phrase-aware decisions with cancellation, look-ahead, and manual takeover |
| Deterministic evidence | [Visual lab](../scripts/preset-lab-visual.ts), [reactivity lab](../scripts/preset-lab-reactivity.ts), [dataset builder](../scripts/preset-lab-dataset.ts), and the [instrument index](./agents/tooling-and-quality.md) | Pair source changes with measured renders and user outcomes; the CPU VM dataset alone contains no rendered pixels |

The generation tournament already compiles and scores candidates. It does not retrieve successful edit episodes or run a full visual repair loop. `lab:generation-bench --visual` remains a stub. The existing one-shot Omni audio and scene actions do not establish musical fit or a continuous performance mode.

## Model roles

| Role | Proposed responsibility | Authority |
| --- | --- | --- |
| EmbeddingGemma 2 | Retrieve reference looks, source fragments, edit episodes, audio contexts, and related failures; retain separate representations for each evidence type | Supplies candidates, never a validity or safety verdict |
| Clef Flash | Text/image observations, candidate fit, and choosing a bounded next step | Typed advisory answers with hold/review paths |
| Clef Omni | Audio/video fit and broad motion judgments when those inputs are explicitly supplied | Same action limits; no timing or flash-safety verdict |
| Frontier writer or teacher | Difficult source patches, repair hypotheses, explanations, and occasional offline critiques | Produces a proposal; a teacher label stays distinct from a human outcome |
| Stims code and instruments | Bounds, source identity, compilation, rendering, measurements, review, and application | Own all side effects and hard gates |

Select writers by a frozen Stims benchmark through the existing provider abstraction. Record the exact provider/model revision and prompt version. Evaluate a stronger coding model for difficult repairs and a multimodal model for reference critique; do not assume one vendor or a general leaderboard winner wins every task. Teacher critiques can propose labels or examples for review, but cannot certify their own generated output or silently become training truth.

## LL-00: episode and index foundation

Ship the smallest store needed for LL-01. An episode connects an intent to a source change, its evidence, and an outcome. A search history entry or an embedding alone is insufficient.

### Episode record

| Field group | Required contract |
| --- | --- |
| Identity | Schema version, episode ID, parent episode, loop ID, creation time, local session ID, preset identity and remix-family/lineage identity |
| Intent | User request, explicit properties to preserve, reference artifact IDs, and whether each annotation came from the user, a model, or an instrument |
| Source | Before/after source hashes, source references, proposed diff, compiler/toolchain version, and source revision expected at apply time |
| Evidence | Content-addressed artifact references; requested and actual backend, viewport/aspect, engine revision, audio scenario or clip hash, seed, capture time and time window; unknown fields stay unknown |
| Measurements | Instrument/version, conditions, raw result reference, pass/fail/unmeasured status, and scope of each measured claim |
| Model receipt | Provider/model revision, question/prompt version, input digest, offered candidate IDs, component answers, disposition, latency, usage when available, and failure status |
| Outcome | Separate events for proposal shown, applied, explicitly accepted, rejected, and reverted; unreviewed is the default. Include the user-selected reason when supplied |
| Ownership | Local/private or reviewed-public origin, source license/credit, consent for retained artifacts, and retention policy |

Applying a diff does not imply satisfaction. Acceptance is an explicit outcome; a later revert remains linked to that acceptance. Dwell, skips, and model agreement are weak signals stored separately. Shared remixes keep their existing lineage; private prompts, clips, and episode history are excluded from exports and share URLs unless explicitly selected.

Proposed pilot limits: retain at most 100 episodes and 32 MiB of episode data per browser, including stored source and derived vectors. Raw captured media is transient by default. Retaining an original reference or clip requires a separate local save choice and counts toward the limit. Eviction removes the episode's owned artifacts and vectors; shared artifacts use reference counts. Deleting local history removes its derived preference state. A full or unavailable store must leave editing usable and show that the outcome was not saved. Schema migrations must be explicit and preserve the ability to delete old records.

### Representation and freshness contract

Keep independent vectors for intent text, source/code, before/after appearance, edit description, and optional audio/video context. Retrieve and combine ranked lists with a versioned policy; preserve each component score. Do not average all evidence into one vector or sum unrelated cosine scales without evaluation.

An index key includes the embedding model/checkpoint and export revision, modality, task prefix, dimension, normalization and quantization scheme, input hash, and relevant source/capture context. A source hash cannot be added retroactively to an unbound capture. Changed source, engine, capture conditions, embedding model, or encoding policy marks the affected representation stale; exclude it until rebuilt. Requested WebGPU that fell back to WebGL remains WebGL evidence.

EmbeddingGemma 2 supports text/code retrieval and image, audio, and video representations in a shared space. Follow its [model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2): use the appropriate text query/document or code-retrieval prefixes, omit prefixes on media, match dimensions, and L2-normalize after truncation. Start by evaluating the existing 256-dimensional representation; compare larger dimensions on the frozen workload before expanding the payload. Preserve per-vector quantization metadata and reject non-finite or zero-length vectors. New exports must verify inference precision against the reference implementation, including its warning against float16 inference.

Matching space does not imply matching thresholds. Calibrate image-neighbor, text-to-image, audio-to-visual, code, and edit-episode retrieval separately. The current image-neighbor cutoff is not a universal threshold. BGE fallback results may be combined by an evaluated rank-fusion policy, never by comparing their raw vectors with EmbeddingGemma 2 vectors.

Precompute public corpus vectors where possible. Any browser encoder is loaded on demand, with a measured memory/download budget and a cancellation path; playback and local search must remain available when it cannot load. A hosted embedding path needs an explicit indication of the text/media being sent. This spec does not require downloading the full multimodal model on first visit.

Foundation acceptance:

- A changed source or incompatible index revision cannot retrieve an apparently current episode; missing evidence stays visible.
- Round-trip, migration, quota failure, eviction, and delete tests cover source, vectors, and artifact references together.
- A local-only session causes no episode/media upload; normal share/export omits private history.
- LL-01 uses the stored episode to improve a second attempt; a storage-only milestone does not satisfy delivery.

## Shared execution and review contract

1. Capture the current source revision, intent, preservation constraints, and consent. Show which reference, audio, or video will leave the device before a hosted call.
2. Retrieve a diverse pool, exclude stale/ineligible candidates, and offer a bounded shortlist of real IDs. Respect the current server cap of twelve candidates/scenes and the current [media/body limits](../src/js/core/decision-model.ts); a future larger pool does not enlarge the API contract.
3. Ask one atomic judgment per question. Use `choice` for a strategy or supplied candidate with `none`/`hold`, `noul` for a clearly defined property, and anchored `score` levels for an ordered judgment. Evaluate evidence sufficiency separately and combine answers in code. [TypeSafe's primitives](https://docs.typesafe.ai/primitives) define these semantics.
4. Reuse existing task schemas only where their semantics match. New repair-strategy, preservation, or experiment-selection tasks require fixed server-owned questions, a new version, validated answer types/options/probabilities, explicit bounds, and labeled evaluation. The client cannot submit arbitrary executable actions or question schemas.
5. If a patch is needed, give the writer the selected examples, diagnostics, constraints, and bounded source context. Compile it, then run the applicable render and measurement checks in an isolated preview/harness before offering Apply. Failed candidates remain proposals with diagnostics; they never replace the working stage. Retrieved comments, captions, and source are evidence, not instructions that can change the allowed tools or policy.
6. Present the diff and comparable before/after evidence. Report model judgments separately from measured results and unmeasured conditions. Applying rechecks source revision, scene/candidate eligibility, and evidence freshness atomically. A stale result requires a fresh request.
7. Record the outcome and retain only consented evidence. Retry, accept, reject, revert, and delete remain explicit actions.

A pilot run permits one active loop per session, at most two writer drafts, and at most one escalation to a stronger writer, included within those two drafts. A repair is not an unbounded retry chain. Each run also declares its hosted-call count, time deadline, and token/media budget before starting; stop when any limit is exhausted. A provider timeout may leave a billed request running, so do not automatically repeat it. A 429 stops a batch. Cancel or a source/audio/scene revision change invalidates late responses. Failed inference, negative judgment, abstention, and missing evidence are distinct states.

No loop can overrule compiler, flash, performance, compatibility, or parity failures. A successful compile does not prove rendering; a sampled video does not prove synchronization or flash safety. Use a declared validation profile for each pilot and label contexts that were not measured. Catalog publication still uses the existing reviewed promotion paths. Performer automation is separately armed and bounded; it does not inherit permission from an editing request.

## Loop requirements

### LL-01: reference to editable preset

**Trigger:** a user supplies an image, short clip, or visual description and asks for a starting preset. Retrieve rendered examples with EmbeddingGemma 2; Clef selects a plausible supplied candidate or abstains. Offer the existing source first. If the user asks for changes, a writer proposes the smallest useful diff and Stims measures the result under matching conditions.

- Compare against existing visual-term search, local neighbors, and the current image-description generation path on held-out reference briefs. Include references with no suitable catalog match.
- Preserve source credit and lineage. Show why an example was retrieved and which requested properties are unsupported; a similarity score is not a claim of reproduction.
- Measure time to an explicitly accepted editable result, acceptance rate, number of drafts, and user effort. Include reference-encoding/download time in latency.
- Release requires offline/unavailable-service fallback, stale-source rejection, review/undo, and a complete retrieve → patch → render → outcome episode. Reusing an accepted episode must be exercised in the same workflow.

### LL-02: intent-preserving remix

**Trigger:** an edit such as “keep the tunnel and palette; make the bass response stronger.” Retrieve accepted before/after edits with related source structure and measured behavior. Clef judges each requested change and preservation property separately; the writer drafts a constrained patch.

- Explicitly list what must change and remain. Missing evidence or conflicting constraints produces review/clarification, not silent relaxation.
- Compare before/after with the same audio, seed, viewport, backend, and observation window. Use dataflow/reactivity evidence for audio coupling and captures for appearance; neither substitutes for the other.
- Test negative constraints and edits that improve the request while breaking a preserved property. Keep a working original and inspectable diff throughout.
- Primary metrics are accepted edits and unintended-change rate, compared with the existing refine action. Rejected/reverted patches must remain available as labeled counterexamples without being retrieved as successful edits.

### LL-03: repair memory

**Trigger:** a compile error, shader failure, blank/frozen result, NaN, or measured regression. Retrieve related diagnostics, source fragments, and verified repairs. Clef may select a diagnostic or repair strategy; a writer proposes a patch. Re-run the failing instrument and the checks that patch can break.

- Reuse replay, NaN sweep, backend diff, compiler/shader checks, visual/reactivity labs, and existing fixtures. Generalize a repair only after testing the related family or subsystem.
- Keep failures and repairs from the same remix family in one evaluation split. A successful repair must fix the original failure without a new measured regression; compile-only success is reported separately.
- After the draft budget is exhausted, return diagnostics, best reviewed proposal, and remaining uncertainty. Do not swap the working preset or weaken a guard to make a repair pass.
- Measure held-out-family repair rate, regressions, calls, elapsed time, and human review effort against the existing quick-fix/generation controls.

### LL-04: learn this effect

**Trigger:** a user asks how a visible or musical effect works. Retrieve a small source example plus the corresponding rendered effect. For an audio claim, deterministic dataflow must establish the audio → equation → drawn-control path. A writer explains it and offers one reviewed edit; Clef can flag mismatch between the example and request.

- Explanations link the actual variables and source lines, distinguish measured behavior from interpretation, and avoid inventing capabilities from a preset title.
- The learner can compare, apply, and undo the example in the current session. Large rewrites do not count as a small teaching edit.
- Measure the first successful independent edit and task completion against the existing authoring docs. Model agreement with its own explanation is not the outcome.

### LL-05: phrase-aware performance

**Trigger:** a performer explicitly arms assistance for a saved set. Extend the existing Omni shortlist/scene action with phrase/section context and a look-ahead window. Retrieve suitable scenes or bridge presets, then choose among `hold`, a supplied scene, or a supplied bridge. Local ramps and modulators execute movement.

- Hosted decisions operate at phrase scale; Stims retains beat timing. Gate proposed changes on local readiness, comfort settings, permitted parameter ranges, and current scene/audio revision.
- Declare a minimum dwell and maximum change rate in the armed policy. Discard late choices; manual takeover immediately disarms pending automation and restores direct control.
- Evaluate unfamiliar music, shuffled-audio controls, silence, repetitive picks, recording, and unavailable/slow inference. No audio permission or continuous upload follows from opening the panel.
- Measure listener/performer fit, repetition, override rate, transition failures, and latency against the current one-shot selector and local autoplay. Musical fit remains a pilot claim until tested.

### LL-06: choose the next experiment

**Trigger:** an authoring or repair pilot has a concrete evidence gap. Cluster related source/capture failures and model disagreement; use Clef to choose from a supplied menu of existing instruments and contexts, including `stop`. The lab runner owns the arguments, budget, and execution.

- Each proposed run names the studio question it resolves, the missing context, and the maximum capture/call cost. A disagreement alone is not proof of an engine defect.
- Prioritize representative uncovered families and failure clusters while reserving a fixed evaluation sample; do not repeatedly select only hard cases and report their rate as corpus prevalence.
- Measure confirmed failures per GPU-minute and coverage gained per capture against a fixed stratified schedule. Report CPU software-rendered correctness separately from hardware performance.
- Stop when the question is answered or the budget expires. New generic evidence infrastructure requires a separate studio need under the roadmap's maintained proof floor.

### LL-07: session taste

**Trigger:** an explicit save, accepted edit, rejection, or “less like this.” Build a local session preference from versioned episode representations; retrieve a diverse set with an explanation of the supporting actions. Clef may check stated constraints on the shortlist.

- Dwell/skip signals receive separate, weaker treatment and never imply a health, mood, or sensory-safety preference. Explicit exclusions override similarity ranking.
- Provide reset/delete and a way to explore outside the preference. No private listening or source history is uploaded automatically.
- Compare accepted discoveries, diversity, repetition, and overrides with current favorites/history ranking. Test a cold session, conflicting feedback, and the deletion of an episode that contributed to the preference.

### LL-08: catalog refresh

**Trigger:** a source, renderer, capture policy, or embedding revision changes. Invalidate affected representations, selectively recapture the contexts needed by the consuming workflow, generate richer descriptions/vectors, and submit proposed labels for review. Clef can flag description/capture mismatch.

- Retain backend, aspect, audio/time context and hashes for each representation; a landscape preview cannot stand in for portrait behavior. Sample multiple motion/audio contexts where a single frame misses the requested property.
- Refresh can run incrementally and resume without publishing mixed incompatible spaces. Old artifacts may remain inspectable with a stale label but cannot support current promoted claims.
- Compare retrieval relevance, stale-result rate, coverage, and duplicate-description collapse with the current static vectors and BGE description fallback. Publication uses deterministic index validation and existing catalog promotion rules.
- Start with LL-01's reference corpus and measured gaps; expanding to the whole catalog requires evidence of retrieval benefit within a declared capture budget.

### LL-09: measured parameter optimization

**Status: research.** Pair bounded source/parameter changes with actual render, reactivity, comfort, and frame-cost measurements. Train a small surrogate to propose the next local experiment; run that experiment and update the dataset. EmbeddingGemma can retrieve similar measured episodes; Clef can choose among supplied experiment types.

- CPU VM trajectories are useful features and stress cases, not visual labels. Obtain paired rendered outcomes with capture hashes before fitting a visual surrogate.
- Split by family and reserve unseen parameter ranges/audio/backend contexts. Report uncertainty and reject extrapolation outside the evaluated domain.
- Compare improvement per experiment against random bounded search and a simple local search. Check that any gain survives new seeds and actual devices; no performance conclusions from software rasterization.
- A predictor cannot apply a parameter change, mark it safe, or substitute for the real measurement. Enter the product roadmap only after a useful held-out gain and an interactive authoring workflow are demonstrated.

## Delivery sequence and release evidence

| Stage | Scope | Exit evidence |
| --- | --- | --- |
| A: reference-guided remix | LL-00 + LL-01, with LL-08 limited to their reference corpus | One reviewable workflow stores and reuses an outcome; a frozen baseline comparison measures accepted editable results and total latency |
| B: reliable edits and repairs | LL-02 + LL-03; LL-06 only for their measurement gaps | Preserved-property failures and held-out repairs are measured; bounded retries, cancellation, and stale-result tests pass |
| C: learning and session assistance | LL-04 + LL-07; LL-05 as a separately armed performance pilot | Task-specific benefit, privacy/deletion, diversity, takeover, and slow/unavailable-service behavior are measured |
| Research | LL-09 | Paired render dataset and held-out improvement over simple search before a product commitment |

Before tuning, freeze briefs, source/capture revisions, remix-family splits, baseline policies, evaluation budgets, success margins, and permitted regression rates. Use independently labeled references and blind user comparisons. The first pilot may be small, but its size and uncertainty must be reported; fixture correctness alone cannot demonstrate product benefit.

Evaluate retrieval and the final workflow separately. Report relevance/recall and diversity, explicit accept/reject/revert outcomes, preservation errors, repair regressions, calibration and abstention coverage, p50/p95 end-to-end latency, download/capture cost, and provider usage. Do not combine them into a score that lets preference compensate for failed hard gates. Tune thresholds on a separate calibration split and rerun held-out evaluation after model, question, shortlist, or embedding-policy changes.

Behavioral coverage must include missing/ambiguous matches, invalid model answers, wrong IDs, unavailable encoders, mixed/stale vector spaces, source edits during inference, quota failure, cancel/late completion, 429, failed render/shader checks, actual-backend fallback, media consent, and deletion. Add browser coverage for the [planned interaction contracts](./PAGE_SPECIFICATIONS.md#planned-learning-loop-interactions). Runtime implementations still require the repository's full gate and relevant browser/headless instruments.

Ship each stage behind an explicit pilot control with a kill switch. A failed quality or privacy gate disables the loop while ordinary playback, search, editing, and export remain usable. Expanding beyond the initial cohort requires its declared success margins and regression limits to be met; a successful API response or teacher preference cannot satisfy that gate.

## Source references

Model capabilities and task conventions checked on 2026-10-23: [EmbeddingGemma 2 model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2), [Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/), [Clef Omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/), and [TypeSafe primitives](https://docs.typesafe.ai/primitives). These support the model-role choices; the proposed loops, budgets, and product criteria still require Stims-specific evaluation.
