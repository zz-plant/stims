# SEO Audit (2026-02-11)

## Scope

This audit reviews the current static SEO surface for the Stim Webtoys Library:

- Core homepage metadata (`index.html`)
- Programmatically generated landing pages (`public/toys`, `public/tags`, `public/moods`, `public/capabilities`)
- Discovery assets (`public/robots.txt`, `public/sitemap.xml`, `public/sitemap-1.xml`)
- SEO generation workflow (`scripts/generate-seo.ts`)

## Executive summary

The project has a **strong SEO baseline** for a static creative site:

- Canonical URLs and social metadata are present on the homepage and generated hub/detail pages.
- JSON-LD is implemented for `WebSite`, `CollectionPage`, `ItemList`, `FAQPage`, and breadcrumbs.
- Crawl directives and sitemap discovery are configured via `robots.txt` + sitemap index/chunk files.
- The SEO page surface is generated from toy metadata, which improves consistency and scale.

Primary opportunities are around **social preview robustness**, **richer crawl hints**, and **ongoing audit automation**.

## Strengths observed

1. **Homepage metadata completeness**
   - Includes canonical, Open Graph, Twitter, description, robots, and structured data graph.
2. **Programmatic SEO coverage**
   - Dedicated index pages exist for toys, tags, moods, and capabilities.
   - Toy detail pages include FAQs and breadcrumbs in both UI and JSON-LD.
3. **Crawlability**
   - `robots.txt` allows crawling and links the sitemap index.
   - Sitemap index references chunked sitemap files for scale.
4. **Deterministic SEO generation pipeline**
   - `bun run generate:seo` can regenerate OG images/pages/sitemaps from metadata.

## Risks and recommendations

### 1) Use PNG/JPG Open Graph images in addition to SVG

- **Why:** Some social/link unfurlers inconsistently render SVG OG assets.
- **Current state:** Generated SEO pages frequently point `og:image` to `.svg` assets under `/og/`.
- **Recommendation:** Generate PNG derivatives for each OG card and set:
  - `og:image` to PNG,
  - `og:image:type` to `image/png`,
  - dimensions (`og:image:width`, `og:image:height`) across generated pages.
- **Priority:** High (share-preview reliability)

### 2) Add `lastmod` to each URL entry in sitemap chunks

- **Why:** Per-URL freshness signals can help crawlers prioritize recrawls.
- **Current state:** Sitemap index has `lastmod`; chunk entries should also carry `lastmod` where possible.
- **Recommendation:** Extend `scripts/generate-seo.ts` to emit per-URL `lastmod` values in `sitemap-*.xml`.
- **Priority:** Medium

### 3) Validate canonical consistency between `/` and `/index.html`

- **Why:** Duplicate home URLs can split equity if canonical behavior diverges across hosts/CDNs.
- **Current state:** Canonical points to `/`; generated pages mostly link to directory-style canonicals.
- **Recommendation:** Keep strict redirects from `/index.html` → `/` at edge/server level and periodically verify in production.
- **Priority:** Medium

### 4) Add a repeatable SEO audit script/check

- **Why:** Prevents regressions as metadata/page templates evolve.
- **Current state:** SEO generation exists; automated SEO validation is not yet explicit.
- **Recommendation:** Add a lightweight `seo:check` script to verify:
  - required meta tags,
  - canonical presence,
  - structured-data JSON parseability,
  - sitemap URL validity,
  - robots sitemap pointer.
- **Priority:** Medium

### 5) Optional: Add image sitemap support for OG assets

- **Why:** Can improve image discoverability for rich cards/asset surfaces.
- **Current state:** Standard sitemap coverage exists.
- **Recommendation:** Evaluate image sitemap only if image search/referral becomes a KPI.
- **Priority:** Low

## Suggested implementation plan

1. Update SEO generator to produce PNG OG assets and enriched OG meta fields.
2. Add per-URL `lastmod` in sitemap chunks.
3. Add `seo:check` script and include it in CI or scheduled checks.
4. Run a production crawl sample (e.g., homepage + 3 toy pages + 3 taxonomy pages) after deploy.

## Validation commands run for this audit

- `bun run generate:seo`
- `sed -n '1,120p' index.html`
- `sed -n '1,220p' public/toys/index.html`
- `sed -n '1,220p' public/toys/cube-wave/index.html`
- `cat public/robots.txt`
- `sed -n '1,220p' public/sitemap.xml`
- `sed -n '1,260p' scripts/generate-seo.ts`
