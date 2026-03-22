# Page-level specifications

Detailed, testable requirements for the two canonical site routes: the marketing homepage at `/` and the dedicated launch route at `/milkdrop/`.

## Homepage (`/` via `index.html`)

| Section | Expected data and state | Layout and interaction expectations | Accessibility and status behaviors |
| --- | --- | --- | --- |
| **Global frame** | Loads shared styles from `assets/css/base.css` and `assets/css/index.css`. Uses `lang="en"` and preserves the saved theme before paint. On load, the shared app runtime starts the MilkDrop session in place with demo-audio preference. | The home document now acts as an immediate launch shell rather than a separate first-step page. | Theme toggle must keep `aria-pressed` and `aria-label` in sync for any visible shell controls. |
| **Top nav** | Brand lockup plus links to `#experience`, `#presets`, `#lineage`, `/milkdrop/`, and GitHub. | Nav stays compact and sticky without competing with the hero CTAs. | Links remain keyboard reachable and visible in mobile menu mode. |
| **Hero** | Copy remains inline in `index.html`, but the active session takes priority once the runtime boots. Primary CTA still links to `/milkdrop/?audio=demo`, with a secondary link to `/milkdrop/` for explicit route navigation. | The hero remains as underlying page content, while the fullscreen visualizer session becomes the immediate first-run experience. | CTA focus treatment stays visible whenever the hero is exposed, and modified clicks should fall back to native navigation. |
| **Experience section** | Static explanatory cards only. No runtime setup widgets live here anymore. | Section clarifies the new information architecture and why setup moved off the homepage. | Cards keep headings in reading order and do not rely on color alone for meaning. |
| **Preset showcase** | Uses `initMilkdropShowcase` with `public/milkdrop-presets/catalog.json`. Requires `data-milkdrop-preset-count`, `data-milkdrop-preset-filters`, and `data-milkdrop-preset-list`. | Filters swap bundled preset groups in place. Cards open `/milkdrop/` and can preselect a preset. | Buttons and links are keyboard reachable; fallback copy remains useful if fetch fails. |
| **Lineage section** | Static copy credits Ryan Geiss&rsquo;s MilkDrop and clarifies that Stims is an independent browser-native project rather than an official continuation. | Two-card comparison is enough; keep it editorial, not encyclopedic. | Lists remain semantic and readable to screen readers. |
| **Footer** | Static links back into the homepage sections plus `/milkdrop/`. | Footer is brief and route-aware instead of acting like a secondary toy-library nav. | Links preserve focus styles and readable contrast. |

## Launch route (`/milkdrop/` via `milkdrop/index.html`)

| Section | Expected data and state | Layout and interaction expectations | Accessibility and status behaviors |
| --- | --- | --- | --- |
| **Intro block** | Static copy explains that this route owns compatibility checks, audio setup, quality tuning, preset browsing, and live editing. | Short context block appears above the runtime controls and links back to `/`. | Link text must be explicit and keyboard reachable. |
| **Audio control panel** | Three rows with fixed labels: microphone, demo audio, and YouTube/tab audio tooling. `#audio-status` communicates runtime status. When mic access is blocked or unavailable, demo audio is emphasized by default. | Buttons share CTA styling and fit narrow widths. Touch targets stay at least 44×44px. | Status element uses `role="status"` and visible focus is preserved for all controls. |
| **Quality controls** | Inline quality presets and render-scale controls persist to local storage before the renderer starts. | Controls stay adjacent to the audio panel so launch-time setup is localized to one route. | Labels describe performance tradeoffs clearly. |
| **Capability preflight** | `attachCapabilityPreflight` mounts against `document.body`, calls `startToyPage` when `result.canProceed` is true, and links back to `/` when blocked. | Preflight runs immediately on load, before audio prompts. | Failure copy stays visible until the user retries or navigates back. |
| **MilkDrop session** | After a successful start, the visualizer route owns the viewport and the shell can collapse redundant controls. Query params like `audio=demo`, `panel=browse`, and `panel=editor` tune the initial state. | Session UI remains focused on one visualizer instead of pretending to browse multiple products. | Runtime updates continue to reuse the status region so screen readers hear later errors. |
