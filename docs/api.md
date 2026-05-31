# Stims API

All endpoints are served from `https://toil.fyi/api/` as Cloudflare Pages Functions.

## POST /api/model-router

Classify a request and select the optimal AI model for the task.

**Body:** `{ description: string, task: 'generate' | 'refine' | 'explain' | 'vision' }`
**Response:** `{ model: string, tier: string, classification: { complexity: string, needsReasoning: boolean } }`

Uses classifier model (`@cf/ibm-granite/granite-4.0-h-micro`) to assess complexity and reasoning need, then routes to the best model for the job.

## POST /api/visual-search

Search for presets visually similar to a text description.

**Body:** `{ description: string, embedOnly?: boolean }`
**Response:** `{ results: Array<{ presetId: string, score: number }> }`

When `embedOnly: true`, returns `{ embedding: number[] }` instead.

## POST /api/generate-preset

Generate MilkDrop preset equations from a text description.

**Body:** `{ description: string, complexity?: 'simple' | 'moderate' | 'complex', model?: string }`
**Response:** `{ milkSource: string, cached?: true }`

The `model` param overrides automatic classification-based model selection. If the description matches a cached embedding (cosine > 0.88), returns cached result without generating.

## POST /api/refine-preset

Iteratively refine an existing MilkDrop preset using AI.

**Body:** `{ currentSource: string, instruction: string, history?: Array<{ role: string, content: string }>, model?: string }`
**Response:** `{ milkSource: string }`

The `model` param overrides the default refine model (Llama 4 Scout). Explain/describe instructions use the micro model (`@cf/ibm-granite/granite-4.0-h-micro`) regardless of `model`.

## POST /api/generate-thumbnail

Generate a thumbnail image for a preset via FLUX.

**Body:** `{ presetId: string, title: string, description: string }`
**Response:** `{ url: string }`

## POST /api/image-to-preset

Generate a MilkDrop preset from an uploaded image.

**Body:** `{ image: string }` (base64 encoded image)
**Response:** `{ description: string, milkSource: string, cached?: true }`

Uses Gemma 4 for vision description and Qwen 2.5 Coder for preset generation. Checks embedding cache to avoid redundant generation.

## POST /api/store-embedding

Store a preset embedding for visual search.

**Body:** `{ presetId: string, embedding: number[], description: string }`
**Response:** `{ ok: true }`

## GET /api/presets

List community presets with optional search, tag filtering, and sorting.

**Query:** `?search=&tag=&sort=newest|top&page=1&limit=20`
**Response:** `{ presets: PresetEntry[], total: number, page: number, limit: number }`

## POST /api/presets

Upload a new community preset.

**Body:** `{ title: string, author?: string, milkSource: string, tags?: string[], email?: string }`
**Response:** `{ id: string, title: string }`

## GET /api/presets/:id

Get a single community preset with its .milk source.

**Response:** `{ id: string, title: string, author: string, milkSource: string, tags: string[], rating: number, downloads: number }`

## POST /api/presets/:id/favorite

Toggle favorite status for a community preset.

**Response:** `{ favorited: boolean }`
