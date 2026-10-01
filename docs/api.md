# Stims API

All endpoints are served from `https://toil.fyi/api/` as Cloudflare Pages Functions.

## POST /api/visual-search

Search for presets visually similar to a text description.

**Body:** `{ description: string, embedOnly?: boolean }`
**Response:** `{ results: Array<{ presetId: string, score: number }> }`

When `embedOnly: true`, returns `{ embedding: number[] }` instead.

## POST /api/generate-preset

Generate MilkDrop preset equations from a text description.

**Body:** `{ description: string, complexity?: 'simple' | 'moderate' | 'complex', model?: string }`
**Response:** `{ milkSource: string, title?: string }`

The `model` param overrides automatic classification-based model selection. Every request invokes the generation model — this route has no embedding cache. Includes an auto-generated preset title from the micro model.

## POST /api/batch-generate

Generate multiple preset variations from a single description.

**Body:** `{ description: string, count?: number }` (count defaults to 3, max 5)
**Response:** `{ presets: string[] }`

Generates `count` variations in parallel via qwen2.5-coder, each with a unique variation seed. Use for exploring different interpretations of a description.

## POST /api/blend-presets

Combine two presets into one — take wave patterns from A, color scheme from B.

**Body:** `{ sourceA: string, sourceB: string, instruction?: string }`
**Response:** `{ milkSource: string }`

Without an instruction, defaults to: "blend the wave patterns and motion from preset A with the color scheme and atmosphere of preset B". The micro model auto-names the result.

## POST /api/refine-preset

Iteratively refine an existing MilkDrop preset using AI.

**Body:** `{ currentSource: string, instruction: string, history?: Array<{ role: string, content: string }>, model?: string }`
**Response:** `{ milkSource: string }`

The `model` param overrides the default refine model (Llama 4 Scout). Explain/describe instructions use the micro model (`@cf/ibm-granite/granite-4.0-h-micro`) regardless of `model`.

## POST /api/image-to-preset

Generate a MilkDrop preset from an uploaded image.

**Body:** FormData with `image` file OR JSON `{ image: string }` (base64); either form takes an optional `guidance` string (trimmed to 500 characters)
**Response:** `{ description: string, milkSource: string }`

Accepts both `multipart/form-data` (file upload from browser) and `application/json` (base64 for programmatic use). Uses Gemma 4 for vision description and Qwen 2.5 Coder for preset generation. Every request generates fresh source.
