# Decision models in Stims

Stims aims to make a preset worth playing, editing, and sharing. Its compiler, audio analysis, render captures, searchable catalog, and performance scenes already provide evidence and actions. Clef adds bounded judgments at those seams: visual labels, prompt checks, audio suggestions, and scene choices. Rendering, compilation, DSP, source edits, and side effects stay in code.

## Models and design choices

Research checked on 2026-10-17:

| Model | Useful here | Constraints |
| --- | --- | --- |
| [Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/) | Cheap text routing and image observations | Hosted context is 24,576 tokens; open model is 9B. Default for image/text tasks. |
| [Clef Omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/) | Explicit music clips and short rendered video | 30B MoE with about 3B active parameters; hosted context 64k. Selected whenever audio or video is supplied. |

Cloudflare describes the [decision-model approach](https://blog.cloudflare.com/clef-decision-models/) as typed probabilistic answers instead of generated text. Omni's [model card](https://huggingface.co/Cloudflare/clef-omni) documents WAV/MP3 audio and MP4/WebM video; video is sampled at two frames per second. That sampling cannot establish flash safety or beat synchronization. The hosted Flash contract used here accepts images; this integration sends video to Omni.

The System One / Typesafe guidance applies directly:

- Use [choice, noul, and score primitives](https://docs.typesafe.ai/primitives). Mutually exclusive actions are choices; overlapping motifs are independent nouls. Scores use concrete ordered descriptions rather than invented precision.
- Keep [state](https://docs.typesafe.ai/concepts/state) small and evidence-bearing. Offer a retrieved shortlist of real preset IDs or saved scenes. Treat titles, descriptions, and user text as untrusted data. The model never supplies an executable action or new source code.
- Include `hold`, `none`, `unclear`, and a sufficient-evidence question. Inspect [probability mass and confidence](https://docs.typesafe.ai/confidence), and measure calibration on local examples. Low certainty means review, not another automatic model call.
- Preserve component answers rather than hiding them in a [composite score](https://docs.typesafe.ai/patterns/composite-scoring). Stims keeps compilation, measured reactivity, and visual fit separate. A visual preference cannot compensate for a compile failure.

The initial policy requires decisive nouls (at most .2 or at least .8), evidence at least .8, and a choice with confidence/top probability at least .8 and a .2 lead. Catalog tags require .9 support. These are provisional application thresholds, not calibrated error guarantees. Wording and candidate changes require reevaluation; external benchmark results do not establish Stims accuracy.

## Implemented seams

| Seam | Entry point | Authority |
| --- | --- | --- |
| Observed catalog motifs/palette and local search tags | `catalog:decisions`, `lab:decisions --apply` | Reviewed offline promotion; only `look:` tags change |
| Writer routing | `/api/generate-preset` | Fixed Flash choice; deterministic fallback on uncertainty/failure; writer overrides bypass routing |
| Rendered prompt check | Generate → Check picture / Check animation; `prompt-match` task | Explicit one-frame upload (Flash) or bounded 1.5s canvas WebM clip (Omni); offers regeneration, keeps current preset |
| Music-to-preset shortlist | Preset Finder "By sound" & MCP `session_decide`, `audio-match` | Explicit clip and 1–12 supplied candidates; ranks and suggests best preset via Clef Omni |
| Slow performance choice | Performance runtime `autoSwitchScene`, palette action `auto-switch-scene`, MCP `session_decide` | Chooses among at most twelve saved scenes; explicit apply uses local four-second ramp |
| Capture review | `capture-review` in lab or MCP | Visibility/composition/artifact judgment, separate from measured evidence |

These seams support Stims' current pipeline without adding a model to the frame loop. Search/description retrieval narrows candidates first. The generation tournament still compiles and ranks real candidates. A human can request a picture check afterward. `lab:generation-bench --visual` and an autonomous visual repair loop remain unfinished capabilities.

## Service and consent

The optional [API](./api.md#post-apidecide) is `/api/decide` with the existing `AI` binding and optional `AI_RATE_LIMITER`. No new secret or package is required. Local Vite has no inference endpoint by default: configure `VITE_STIMS_API_BASE` for the browser, or pass `--endpoint` / `STIMS_DECISION_ENDPOINT` for tools. Failures leave playback and local edits usable.

The browser picture button sends one JPEG bounded to 640 pixels plus the prompt. MCP and CLI send only evidence explicitly requested by the operator. They never open a microphone, record live audio, or continuously upload frames. The runner saves context, hashes, model/question versions, probabilities, latency, and errors, omitting media bytes. State can contain user text; keep saved reports local unless reviewed for publication. The service does not log media or raw provider failures.

The envelope caps images, clips, body size, state, candidate count, and recursion. Workers AI validates actual media decoding and duration. Request and inference waits have deadlines, but an inference timeout cannot cancel already dispatched provider work. Use short clips and a bounded sample before a corpus run.

## Run a capture decision

Capture the actual preset before judging it:

```bash
bun run lab:visual -- --preset eos-ether --renderer webgl --viewport 1280x720
bun run lab:decisions -- \
  --visual-report scratch/preset-lab/eos-ether/visual/visual.json \
  --endpoint https://YOUR-PREVIEW/api/decide \
  --out scratch/decisions/eos-landscape.json
```

Add `--prompt "a blue tunnel with bright central rings"` for `prompt-match` instead of `visual-profile`. A visual report records the renderer, viewport, and SHA-256 of the actual preset response used across all three audio scenarios. If served sources differ or cannot be bound, there is no promotable hash. Promotion also requires every scenario to report the requested actual backend; a WebGPU request that falls back to WebGL cannot count as WebGPU evidence. Legacy captures remain reviewable but cannot acquire a current hash retroactively.

For arbitrary explicit evidence, save an item file (relative media paths resolve from that file's directory):

```json
{
  "id": "music-shortlist-01",
  "family": "held-out-family",
  "request": {
    "task": "audio-match",
    "state": {
      "candidates": [
        {"id": "eos-ether", "description": "slow, layered flowing forms"},
        {"id": "geiss-casino", "description": "bright, energetic geometric motion"}
      ]
    }
  },
  "audioFiles": ["music.wav"]
}
```

```bash
bun run lab:decisions -- --request items.json \
  --endpoint https://YOUR-PREVIEW/api/decide --out scratch/decisions/music.json
```

Files may contain one item, an array, or `{ "items": [...] }`. Supported fields include `imageFiles`, `audioFiles`, and `videoFiles`. Visual tasks need images or video; sound tasks need audio or video explicitly declared to have sound. Use `state.prompt` for prompt checks, `state.scenes: [{id, description}]` for scenes, and empty state for visual profiles/capture reviews. `model: "clef-omni"` can request Omni for images as an evaluation comparison.

Catalog preview sampling is explicit and does not imply cross-context evidence:

```bash
bun run catalog:decisions -- --ids eos-ether,geiss-casino \
  --previews path/to/previews \
  --endpoint https://YOUR-PREVIEW/api/decide
```

The default limit is 20 items; `--limit` permits up to 1,000. Duplicate IDs are rejected before requests. A 429 stops the run. Repeated `--visual-report` flags collect contexts into one report; use distinct output directories for landscape/portrait and WebGL/WebGPU captures so files are not overwritten.

## Review and promote visual labels

Before promotion, inspect the contact sheets and result probabilities. Supply a report containing the same captured source at WebGL portrait/landscape and WebGPU portrait/landscape. Every context must support the promoted label, and the source hash must still match the catalog file.

```bash
bun run lab:decisions -- --apply scratch/decisions/reviewed-contexts.json
bun run check:catalog-integrity
bun run check:catalog-fidelity
```

Promotion writes `look:` tags and a provenance manifest named decision-profiles.json alongside the catalog (NEW, created on the first promotion). Existing local catalog search consumes tags. Every apply also revalidates all saved profiles, including presets absent from the incoming report, and removes stale or missing-source profiles and their owned tags. Cleanup is saved even when no new profile qualifies. It does not edit categories, compatibility, parity, sensory risk, certification, or performance fields. A preview-only report, missing backend/aspect, stale source, uncertain result, or disagreement cannot promote a label. Operator-provided report files are trusted local artifacts, not signed attestations.

## Evaluate before expanding use

Keep related preset families and variations in one split; do not let near-duplicate images cross training/tuning and held-out groups. Label evidence without seeing model answers. Include black/fallback frames, unsupported media, ambiguous motifs, mismatched prompts, candidate `none` cases, and overlapping music styles. Compare Flash/Omni image tasks against current local retrieval and human review.

Label JSON/JSONL records use result question keys and actual primitive values:

```json
{"id":"p-webgl-1280-match","family":"held-out-p","expected":{"structure_match":true,"palette_match":false,"composition_match":true}}
```

```bash
bun run lab:decisions -- --report scratch/decisions/run.json --labels labels.jsonl
```

The evaluator reports accepted coverage/accuracy, binary Brier score over available nouls, failed items, family count, and p95 latency. Invalid keys/types and duplicate IDs fail. Missing expected answers count against accepted accuracy. It does not establish split independence: review family membership yourself. Preserve raw probabilities and provider usage to calculate actual cost; compare failure rates and latency before replacing a baseline or changing thresholds. No live held-out Clef result or corpus quality improvement is claimed by the implementation tests.

Safety remains the flash governor and `lab:flash-audit`; backend compatibility remains compile/render testing; parity remains certified reference capture/diff; performance remains measured frame instruments. A model may help prioritize a review, but cannot promote any of those claims.
