# SEO Audit (2026-02-18)

## Scope

This audit reviews the production SEO surface for [https://no.toil.fyi](https://no.toil.fyi):

- Homepage metadata and structured data (`/`)
- Representative toy landing page (`/toys/cube-wave/`)
- Discovery assets (`/robots.txt`, `/sitemap.xml`, `/sitemap-1.xml`)
- Generator/check workflow (`scripts/generate-seo.ts`, `scripts/check-seo.ts`)

## Executive summary

The site now has solid technical SEO defaults and the two highest-priority opportunities from the previous audit are addressed:

- **P0 complete:** generated SEO pages now use PNG social images (`og:image`) with explicit `image/png` type metadata.
- **P1 complete:** sitemap chunk entries include per-URL `lastmod` values.

Other foundations remain strong: canonical tags, robots directives, JSON-LD on major pages, and sitemap discovery via `robots.txt`.

## What changed in this cycle

### P0 — Improve social share reliability (completed)

- `scripts/generate-seo.ts` now publishes generated pages with PNG OG metadata using the existing site icon (`/icons/icon-512.png`).
- Generated pages now use PNG for OG/Twitter image references and metadata:
  - `og:image` points to a PNG asset
  - `og:image:type` is `image/png`
  - width/height metadata is present

### P1 — Strengthen crawl freshness hints (completed)

- `sitemap-*.xml` URL entries include per-URL `lastmod` values.
- `scripts/check-seo.ts` validates this behavior.

## Remaining recommendations (lower priority)

1. Generate dedicated 1200x630 PNG cards per toy instead of the shared 512x512 icon image.
2. Optionally add image sitemap support if image search becomes a KPI.
3. Continue periodic production checks for `/index.html` → `/` redirect behavior.

## Follow-up findings: potential search presence constraints (2026-02-21)

The technical SEO baseline is healthy, but these factors may still limit search visibility growth:

1. **Homepage crawl paths rely heavily on JavaScript-rendered cards.**
   The homepage keeps the primary library container empty in source (`<main id="toy-list" class="webtoy-container"></main>`), and the full toy grid links are injected client-side. Search crawlers that execute limited JavaScript can still discover URLs through the sitemap, but they may see weaker contextual internal-link signals from the most authoritative page (`/`).

2. **Static internal links on the homepage are sparse compared to inventory size.**
   In raw HTML, only a few direct toy launch links are present (`toy.html?toy=aurora-painter`, `toy.html?toy=holy`, and `toy.html?toy=seary`) while the full catalog lives under generated `/toys/`, `/tags/`, `/moods/`, and `/capabilities/` pages. That can reduce crawl depth reinforcement if bots prioritize HTML-discoverable links.

3. **Discovery pages are generated, but homepage emphasis favors app interaction over crawlable taxonomy hubs.**
   The generated SEO surfaces (`/toys/`, `/tags/*`, `/moods/*`, `/capabilities/*`) are included in sitemap artifacts and are indexable, but they are not prominently linked in static homepage nav. This may dampen topical clustering signals despite good metadata and structured data.

### Next actions for visibility growth

1. Add persistent static links from homepage chrome/footer to `/toys/`, `/tags/`, `/moods/`, and `/capabilities/`.
2. Add a minimal server-rendered "top toys" list in homepage HTML (in addition to JS rendering) to strengthen internal links on first crawl.
3. Track indexing and impressions in Google Search Console/Bing Webmaster Tools per page group (`/toys/`, `/tags/`, `/moods/`) to confirm which section is underperforming.

## Programmatic growth opportunities (next cycle)

1. **Automate first-party OG image generation per toy page**  
   Replace the shared icon fallback with generated 1200x630 cards that render toy title + key metadata, then wire those URLs into each generated page's `og:image` and `twitter:image` fields.
2. **Emit an image sitemap and validate it in `check:seo`**  
   Extend the SEO generator to emit image discovery metadata (`<image:image>` entries or a dedicated image sitemap index) and fail CI when required assets/entries are missing.
3. **Generate related-toy internal links from metadata graph**  
   Use shared tags/moods/capabilities from toy metadata to programmatically add "Related toys" sections on toy landing pages to strengthen crawl paths and topical clustering.

## Validation commands run for this audit

- `bun run generate:seo`
- `bun run check:seo`
- `curl -sS https://no.toil.fyi/ -o /tmp/no_toil_home.html`
- `curl -sS https://no.toil.fyi/toys/cube-wave/ -o /tmp/no_toil_cube_wave.html`
- `curl -sS https://no.toil.fyi/robots.txt -o /tmp/no_toil_robots.txt`
- `curl -sS https://no.toil.fyi/sitemap.xml -o /tmp/no_toil_sitemap.xml`
- `curl -sS https://no.toil.fyi/sitemap-1.xml -o /tmp/no_toil_sitemap1.xml`
- `curl -sSI https://no.toil.fyi/`
- `curl -sSI https://no.toil.fyi/index.html`
