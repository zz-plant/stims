# Outstanding issues audit (2026-03-02)

## Scope

This audit consolidates currently outstanding work discovered from:

- quality-gate execution (`bun run check`),
- implementation backlog tracking docs,
- UX and SEO follow-up audits.

## Snapshot

- **Build health:** previously blocked by Biome duplicate-property lint errors in CSS; those blockers have now been resolved.
- **Product backlog:** onboarding, touch polish, and refactor milestones remain open.
- **Growth backlog:** SEO follow-ups are identified but not yet implemented.

## 1) Immediate quality-gate blockers

Command run:

```bash
bun run check
```

Status update:

- ✅ The previously reported CSS duplicate-property blockers were remediated:
  1. `.toy-canvas` duplicate `width` declaration removed (`assets/css/base.css`).
  2. `.toy-canvas` duplicate `height` declarations consolidated (`assets/css/base.css`).
  3. `.active-toy-container` duplicate `min-height` declarations consolidated (`assets/css/base.css`).
  4. `.search-field` conflicting `position` declaration removed (`assets/css/index.css`).
- ✅ `bun run check` now passes.

## 2) Open implementation work (tracked backlog)

From `docs/IMPLEMENTATION_STATUS.md`, notable outstanding queues include:

- **Active priorities:**
  - Toy onboarding quick wins (presets / first-time hints).
  - Toy-page touch polish.
- **Refactor milestones A-E:** all still unchecked.
- **Technical debt queue:** module splitting, deterministic generated-artifact validation, toy smoke coverage expansion, metadata drift checks.
- **UX delivery queue:** reduce first-view control density, de-duplicate first-step prompts, simplify preflight/error CTA structure.

## 3) UX friction still affecting first-session success

From `docs/USER_JOURNEY_CRITIQUE.md`, the highest-impact unresolved UX themes are:

- competing first-step CTAs during onboarding,
- filter-state visibility and reset-action consistency issues,
- preflight density before first interactive success.

These should remain high-priority because they directly affect activation and return probability.

## 4) SEO and discoverability follow-ups still open

From `docs/SEO_AUDIT.md`, the baseline is healthy, but follow-ups remain:

- add persistent static links from homepage to taxonomy hubs (`/toys/`, `/tags/`, `/moods/`, `/capabilities/`),
- add a minimal server-rendered top-toys list in homepage HTML,
- monitor section-level indexing/impressions in Search Console/Bing Webmaster Tools,
- consider per-toy OG card generation and image sitemap support.

## Prioritized next actions (proposed)

1. **Execute UX “Now (1 sprint)” queue** from implementation status.
2. **Ship homepage crawl-path improvements** called out in SEO audit.
3. **Increase toy smoke coverage for high-traffic toys** to reduce regressions while iterating UX/SEO.
4. **Add section-level indexing/impression dashboards** for `/toys/`, `/tags/`, and `/moods/` in search tooling.

## Audit references

- `docs/IMPLEMENTATION_STATUS.md`
- `docs/USER_JOURNEY_CRITIQUE.md`
- `docs/SEO_AUDIT.md`
- `package.json` (`check` script definition)
