# Feature specifications (current build)

This document captures the **current, shipped feature set** of the Stim Webtoys Library as implemented in this repository. It is intended to be a baseline reference for audits, QA, and future planning.

## Audit snapshot

| Area | Current state | Primary sources in repo |
| --- | --- | --- |
| Library landing page | Intro hero, system check, search + filters, and toy grid are live. | `index.html`, `assets/js/library-view.js` |
| System readiness & performance | Readiness probes + performance controls + preflight dialog are wired. | `assets/js/readiness-probe.ts`, `assets/js/utils/init-system-check.ts`, `assets/js/core/capability-preflight.ts` |
| Toy runtime shell | Loader, toy nav, status/errors, audio prompt, and settings panel are live. | `assets/js/loader.ts`, `assets/js/toy-view.ts`, `assets/js/ui/*` |
| Audio input options | Mic, demo audio, tab capture, and YouTube capture are available. | `assets/js/ui/audio-controls.ts`, `assets/js/ui/youtube-controller.ts` |
| Renderer fallback | WebGPU preferred with WebGL fallback + compatibility mode. | `assets/js/core/renderer-capabilities.ts`, `assets/js/core/render-preferences.ts` |
| Personalization & persistence | Theme, quality presets, render/motion preferences, and search state persist. | `assets/js/library-view.js`, `assets/js/core/settings-panel.ts` |
| Gamepad navigation | Focus + input support is enabled on library and toy pages. | `assets/js/utils/gamepad-navigation.ts`, `assets/js/main.js`, `assets/js/toyMain.ts` |
| Toy catalog metadata | Registry includes titles, tags, moods, controls, and lifecycle stage. | `assets/js/toys-data.js` |

## Library landing page & discovery

### Global navigation
- **Brand + jump links**: “Intro”, “System check”, “Library”, and “Connect” anchors are shown alongside the brand mark.
- **Utilities**: Jump to the toy list, open GitHub, and toggle light/dark theme.
- **Theme toggle**: A dark-mode toggle persists preference in local storage and uses view transitions when available.

### Intro hero
- **Quickstart CTA**: “Open Halo Flow” deep-links to `toy.html?toy=holy`.
- **Readiness summary**: “Ready • <performance> • <compatibility>” reacts to performance settings and renderer compatibility.
- **System check entry**: “Adjust performance” button opens the preflight dialog and deep-links to the system check section.

### System check section
- **Live readiness panel**: Displays status for graphics acceleration, microphone, motion input, and reduced motion preference.
- **Details toggle**: Expands/collapses the system check description while syncing the URL hash.
- **Performance controls**: Inline settings panel with quality presets, compatibility mode (force WebGL), motion enable toggle, and sliders for resolution scale + pixel ratio.
- **Preflight dialog**: Modal with readiness badges for rendering, mic, and performance warnings.

### Search, filters, and sorting
- **Search**: Input supports keyword matching across toy title, slug, description, tags, moods, and capability terms.
- **Suggestions**: Datalist is populated from toy metadata (title, tags, moods, capability terms, WebGPU).
- **Filters**: Chips for moods (Calm/Energetic), capabilities (Microphone/Motion/Demo audio), and WebGPU feature.
- **Sort controls**: Featured, Newest, Most immersive, and A → Z.
- **Empty state**: If no matches, a reset button clears search + filters.
- **State persistence**: Search, filters, and sort persist in session storage and URL query params (`q`, `filters`, `sort`).

### Toy cards
- **Card content**: Icon, title, description, and capability badges.
- **Capability badges**:
  - WebGPU indicator (shows warning + fallback note if unsupported).
  - Mic / Demo audio / Motion badges.
- **Interaction**: Cards handle keyboard activation and standard click to open the toy.

## Toy runtime shell

### Loader & routing
- **Route entry**: `toy.html?toy=<slug>` loads the matching module from the toy registry.
- **Lifecycle**: Loader handles status states, disposal, and cleanup before switching toys.
- **WebGPU gating**: Toys can require WebGPU, optionally allow WebGL fallback, and show a capability error when unavailable.
- **Prewarming**: Renderer capabilities and microphone permissions are prewarmed before loading.

### Toy navigation bar
- **Now playing header**: Shows title + slug pill and “Press Esc” hint.
- **Renderer status**: Displays active renderer (WebGPU/WebGL) and fallback reason + retry when applicable.
- **Share link**: Copies the current URL to clipboard with status feedback.
- **Picture-in-picture**: Captures the toy canvas into a PiP video window when supported.
- **Back to library**: Returns to the library view.

### Audio controls
- **Primary options**: Live mic or curated demo audio.
- **Advanced options**:
  - Tab capture (share current tab audio).
  - YouTube capture (load a YouTube URL, then capture tab audio).
- **Status feedback**: Inline status area shows success/error states.
- **Preference persistence**: Stores last-used source in session storage (`stims-audio-source`), advanced panel state in `stims-audio-advanced-open`.

### YouTube capture
- **Iframe API loader**: Lazy-loads the YouTube API script.
- **Video parsing**: Accepts `watch?v=`, `embed`, `youtu.be`, and `shorts` formats.
- **Recent list**: Stores up to five recent video IDs in local storage (`stims_recent_youtube`).

### Settings panel (performance controls)
- **Quality presets** (stored under `stims:quality-preset`):
  - Battery saver
  - Low motion
  - Balanced (default)
  - Hi-fi visuals
- **Compatibility mode**: Force WebGL for older GPUs.
- **Motion toggle**: Enable/disable motion input on supported toys (`stims:motion-enabled`).
- **Resolution + pixel ratio controls**: Range sliders with live value labels.
- **Reset**: Clears custom overrides to match the active preset.

### Gamepad navigation
- **Focus movement**: D-pad/axes move focus through focusable elements.
- **Range input support**: Left/right updates sliders in the settings panel.
- **Back handling**: Gamepad “back” dispatches Escape or triggers back-to-library when available.

## Toy catalog metadata

The toy registry is sourced from `assets/js/toys-data.js` (with an optional JSON override loaded from `./toys.json` on the landing page). Each entry includes:

- **Identity**: `slug`, `title`, `description`.
- **Runtime**: `module` path and `type` (`module` or `page`).
- **Rendering**: `requiresWebGPU`, `allowWebGLFallback`.
- **Lifecycle**: `lifecycleStage` (featured/prototype/archived) and `featuredRank`.
- **Discovery**: `moods`, `tags`, and `controls` for search/filter suggestions.
- **Capabilities**: `capabilities` object with defaults (mic + demo audio on, motion optional).

## Persistence & storage keys

| Purpose | Storage | Key |
| --- | --- | --- |
| Library search state | sessionStorage | `stims-library-state` |
| Audio source preference | sessionStorage | `stims-audio-source` |
| Audio advanced panel | sessionStorage | `stims-audio-advanced-open` |
| YouTube recent list | localStorage | `stims_recent_youtube` |
| Quality preset | localStorage | `stims:quality-preset` |
| Compatibility mode | localStorage | `stims:compatibility-mode` |
| Max pixel ratio | localStorage | `stims:max-pixel-ratio` |
| Render scale | localStorage | `stims:render-scale` |
| Motion enabled | localStorage | `stims:motion-enabled` |
