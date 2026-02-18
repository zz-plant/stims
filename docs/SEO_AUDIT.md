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
