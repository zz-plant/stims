# Stims API

The site Worker exposes `/api/` handlers from `functions/api/`. The site build bundles Functions-style routes for Cloudflare Workers; this is not a separate Pages deployment. `wrangler.site.jsonc` and [deployment guidance](./DEPLOYMENT.md) define bindings. The example production base URL is `https://toil.fyi/api`; an endpoint's presence in source does not establish that its optional services are configured on every deployment.

Playback, browsing, local editing, and file import/export do not require these endpoints. The [OpenAPI schema](../public/openapi.json) describes the preset endpoints below. Community and other routes under `functions/api/` have separate implementation contracts.

## Deterministic source operations

### POST /api/validate-preset

Compile source with the real preset compiler without rendering it.

**JSON body:** `{ milkSource: string }`

**Response:** `{ valid: boolean, fieldCount: number, sections: string[], errors: Diagnostic[], warnings: Diagnostic[] }`

A diagnostic has `severity`, `code`, `message`, and optional `line`. `valid` means the compiler produced no error diagnostics; unsupported features can remain warnings. Toolchain informational diagnostics map to route warnings. Compilation does not establish visible output, native parity, or support on every GPU backend.

```bash
curl -sS https://toil.fyi/api/validate-preset \
  -H 'Content-Type: application/json' \
  --data '{"milkSource":"[preset00]\nfDecay=0.98\n"}'
```

Malformed requests return 400; unsupported methods return 405. The handler also accepts CORS preflight requests.

### POST /api/patch-preset

Apply field overrides without a model or rendering.

**JSON body:** `{ milkSource: string, patch: Record<string, number | string> }`

**Response:** `{ milkSource: string }`

Existing assignments are replaced and unmatched keys are appended. This is a deterministic text patch, not compilation; validate and render the returned source before relying on it.

## Optional model-backed operations

Generation routes require an `AI` binding. Search also depends on configured embedding/index storage. Where `AI_RATE_LIMITER` is configured, model requests can return 429 with `Retry-After: 60`; an absent or unavailable limiter does not impose that limit. Provider failures can return 500. Error bodies are not uniform across handlers, so check HTTP status before decoding a success payload.

For routes accepting `model`, only names allowed by `functions/api/_ai-guard.ts` override server selection. An unknown name falls back to the route's default. Consult that policy and each handler for current model identifiers instead of treating a copied model name as a permanent API guarantee.

### POST /api/generate-preset

**JSON body:** `{ description: string, complexity?: 'simple' | 'moderate' | 'complex', model?: string }`

**Response:** `{ milkSource: string, title?: string }`

Generates source from a description. A typed Clef Flash choice routes between the existing writers when no allowed override is supplied. Uncertain, malformed, unavailable, or timed-out classification falls back to the deterministic description-length heuristic. An allowed writer override bypasses classification. Each request invokes generation rather than retrieving a cached preset.

### POST /api/decide

Optional fixed-question decision service, requiring the `AI` binding. See [decision workflows](./DECISION_MODELS.md) for question keys, examples, evaluation, and evidence limits.

**JSON body:** `{ task, state, model?, images?, audio?, videos? }`. Tasks are `visual-profile`, `prompt-match`, `audio-match`, `scene-choice`, and `capture-review`. `model` is `clef-flash` or `clef-omni`; audio/video selects Omni. Media entries are supported MIME data URLs. Arbitrary questions, model identifiers, and extra envelope fields are rejected.

**Response:** `{ version: 1, task, model, answers, disposition, provenance, usage? }`. Answers are typed `noul`, `choice`, or `score` objects with probabilities. `disposition` is `accepted` or `review`, using provisional thresholds; it is not a correctness certificate. Provenance carries the question version, evaluation timestamp, and normalized input SHA-256. No preset source is generated or applied by this endpoint.

Limits: four images (1 MiB each), two audio clips (2 MiB each), one video (4 MiB), 6 MiB total decoded media, 9 MiB JSON body, 16 KiB state, 4,096 characters per string, and at most twelve offered candidates/scenes. Use short clips; the provider decodes media and enforces format/duration constraints. Video-only sound tasks require `state.videoHasAudio: true`, a caller declaration checked by the evidence question rather than proof of a soundtrack.

Malformed input returns 400, oversized input 413, unavailable AI 503, configured rate limit 429, provider/malformed model output 502, and evaluation deadline 504. The body reader and inference wait have bounded deadlines. A timeout ends the request wait; Workers AI does not expose cancellation of already dispatched computation here. JSON responses use `Cache-Control: no-store`; media and provider error bodies are not logged by this handler. Check status before decoding success.

### POST /api/refine-preset

**JSON body:** `{ currentSource: string, instruction: string, history?: Array<{ role: string, content: string }>, model?: string }`

**Response:** `{ milkSource: string, explanation?: string }`

Instructions beginning with `explain` or `describe` return an explanation and the unchanged source through the explanation model. Other instructions return refined source. Returned source still needs compile and visual checks.

### POST /api/batch-generate

**JSON body:** `{ description: string, count?: number }`

**Response:** `{ presets: string[] }`

Count defaults to 3 and is bounded to 1–5. Supply an integer count. Variations use the handler's configured coding model and variation prompts.

### POST /api/blend-presets

**JSON body:** `{ sourceA: string, sourceB: string, instruction?: string }`

**Response:** `{ milkSource: string }`

Without an instruction, the prompt asks for wave patterns and motion from A with color and atmosphere from B. This describes the request to the model; it does not guarantee that every returned field follows that division.

### POST /api/image-to-preset

**Body:** multipart form data with an `image` file, or JSON `{ image: string, guidance?: string }` with base64 image data. Multipart requests can also include `guidance`.

**Response:** `{ description: string, milkSource: string }`

Guidance is trimmed to 500 characters. A vision model describes the image, then a coding model generates source. Similarity to the image requires visual review.

### POST /api/visual-search

**JSON body:** `{ description: string, embedOnly?: boolean }`

**Response:** `{ results: Array<{ presetId: string, score: number }>, source?: string }`, or `{ embedding: number[] }` when `embedOnly` is true.

Search uses a configured Vectorize index or D1 embeddings. Empty results do not prove there are no matching presets; they may reflect unavailable or incomplete index data. Catalog keyword search remains a local browser feature.

## Verify a consumer

Exercise the intended deployment with a small request and inspect its status and payload. Use the matching route tests under `tests/unit/` for local validation and patch behavior. Endpoint checks do not replace browser verification of a generated or modified visual.
