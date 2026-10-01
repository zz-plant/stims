# Public surfaces and messaging alignment

Every place a stranger can read what Stims is, where its text comes from, and what keeps it current. The wording itself (the pitch, what Stims contributes, and the phrases to avoid) is set in [`LINEAGE_AND_CREDITS.md`](./LINEAGE_AND_CREDITS.md); this page only says where that wording has to land.

## The message

- **The pitch**, for product copy: "Play and live-edit MilkDrop presets in your browser." It says what Stims does and makes no novelty claim.
- **What is new**, for surfaces that compare Stims with anything: the three contributions in [What Stims contributes](./LINEAGE_AND_CREDITS.md#what-stims-contributes), in that order. Running presets in a browser and editing them while they play are not among them: Butterchurn did the first, and MilkDrop 2 had the second.

## Surfaces

| Surface | Source | Says | Kept current by |
| --- | --- | --- | --- |
| `toil.fyi/` page title, description, link previews, JSON-LD | [`index.html`](../index.html) | The pitch | Hand-edited; `check:seo` checks the social tags are present |
| Home screen | [`NewHomePage.tsx`](../src/js/frontend/NewHomePage.tsx) | One claim: MilkDrop presets that move to the music. The first-run preset is chosen to prove it ([`first-run-preset.ts`](../src/js/milkdrop/runtime/first-run-preset.ts)) | `tests/unit/bundled-first-run-preset.test.ts` |
| Shared-preset previews | [`functions/_middleware.ts`](../functions/_middleware.ts), `functions/api/oembed.ts`, `functions/api/og-preset.ts` | The preset's title and credit | `tests/unit/oembed.test.ts`, `tests/unit/seo-middleware.test.ts` |
| `/learn/` (authoring course, reference, MilkDrop online, the comparison) | `docs/authoring/*.md`, `docs/learn/*.md` | The comparison page states what is new | `bun run generate:learn`; `check:seo` fails on a stale page |
| `/discover/<slug>` | [`functions/discover-slugs.ts`](../functions/discover-slugs.ts) | Presets grouped by look and by author | Hand-edited |
| `/performance/` | [`performance/index.html`](../performance/index.html) | Browser and device support | Hand-edited |
| `/llms.txt`, `/llms-full.txt` | [`public/llms.txt`](../public/llms.txt), [`public/llms-full.txt`](../public/llms-full.txt) | The pitch, what is new, URL flags, API routes, the embed protocol | Hand-edited; document only flags and messages that do something |
| `/openapi.json` | [`public/openapi.json`](../public/openapi.json) | The optional API routes | Hand-edited |
| `/mcp` | [`scripts/mcp-worker.ts`](../scripts/mcp-worker.ts), [`scripts/mcp-shared.ts`](../scripts/mcp-shared.ts) | Server instructions and tool descriptions | Hand-edited |
| Installed app | [`public/manifest.json`](../public/manifest.json) | The pitch | Hand-edited |
| GitHub README | [`README.md`](../README.md) | The pitch, then what is new | [`check-readme-claims.ts`](../scripts/check-readme-claims.ts) for counts and fidelity wording |
| GitHub repository description and topics | GitHub settings, not the repo | The pitch | `gh repo edit` when the pitch changes |

## When the message changes

1. Change [`LINEAGE_AND_CREDITS.md`](./LINEAGE_AND_CREDITS.md) first.
2. Update every surface in the table that states the changed part. A pitch change reaches at least `index.html`, `manifest.json`, the README, both `llms` files and the repository description; a contribution change reaches the README, both `llms` files and the comparison page.
3. Regenerate what is generated (`bun run generate:learn`) and run `bun run check:quick`.
