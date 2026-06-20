# Page-level specifications

Detailed, testable requirements for the unified MilkDrop app route at `/` and the legacy alias at `/milkdrop/`.

## Unified app route (`/` via `index.html`)

| Section | Expected data and state | Layout and interaction expectations | Accessibility and status behaviors |
| --- | --- | --- | --- |
| **Route behavior** | Loads shared styles from `assets/css/base.css` and `assets/css/index.css`, uses `lang="en"`, preserves the saved theme before paint, and keeps the `index.html` document active for the root URL. Query params like `audio=demo`, `panel=browse`, `panel=editor`, `collection=cream-of-the-crop`, and `preset=eos-glowsticks-v2-03-music` tune the initial state. Legacy links using `preset=signal-bloom` should resolve to the same featured preset. | The root URL is both the product surface and the session entry surface. It should not require a separate launch route for normal use. | Theme toggle must keep `aria-pressed` and `aria-label` in sync for any visible shell controls. |
| **Crawl links** | The static homepage shell includes crawlable links to `/` and `/performance/`, and does not link to `/milkdrop/`. | Search engines should discover indexable canonical URLs from the homepage without treating the compatibility alias as a primary surface. | `bun run check:seo` verifies the crawl links and alias exclusion. |
| **Top nav** | Brand lockup plus links to `#main-content` and `#launch-panels`. | Nav stays compact and sticky without competing with the hero CTAs. | Links remain keyboard reachable and visible in mobile menu mode. |
| **Intro block** | Static copy introduces the visualizer. Demo audio auto-plays on load with the featured preset. | Short context block appears above the runtime controls. No CTA — visuals start immediately. | |
| **Audio control panel** | Three rows with fixed labels: microphone, demo audio, and YouTube/tab audio tooling. `#audio-status` communicates runtime status. When mic access is blocked or unavailable, demo audio is emphasized by default. | Buttons share CTA styling and fit narrow widths. Touch targets stay at least 44×44px. | Status element uses `role="status"` and visible focus is preserved for all controls. |
| **Quality controls** | Inline quality presets and render-scale controls persist to local storage before the renderer starts. | Controls stay adjacent to the audio panel so launch-time setup is localized to one route. | Labels describe performance tradeoffs clearly. |
| **MilkDrop session** | After a successful start, the unified route owns the viewport and the shell collapses redundant controls aggressively. The active session keeps presets primary while the editor stays one layer deeper inside the overlay. | Session UI remains focused on one visualizer instead of pretending to browse multiple products, and visible chrome should feel minimal by default. | Runtime updates continue to reuse the status region so screen readers hear later errors. |

## Legacy alias (`/milkdrop/` via `milkdrop/index.html`)

| Section | Expected data and state | Layout and interaction expectations | Accessibility and status behaviors |
| --- | --- | --- | --- |
| **Alias behavior** | Loads a lightweight HTML document that preserves the current query string and redirects to `/`. It is `noindex,follow` and canonicals to `https://toil.fyi/`. | Users and old links that open `/milkdrop/` should land in the same unified app route without losing launch intent. Search Console's "Alternate page with proper canonical tag" classification is intentional for this URL. | Redirect fallback link remains visible if scripting is unavailable. `bun run check:seo` verifies the alias canonical, noindex directive, and sitemap exclusion. |
