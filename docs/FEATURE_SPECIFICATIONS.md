# Feature specifications (current build)

This document captures the **current, shipped feature set** of Stims as implemented in this repository. Product framing for current public surfaces is MilkDrop-led: Stims is an independent browser-native visualizer in the lineage of Ryan Geiss's MilkDrop, with a broader collection of related audio-reactive toys.

## Audit snapshot

| Area | Current state | Primary sources in repo |
| --- | --- | --- |
| Homepage (`index.html`) | MilkDrop-led hero path, system check, broader toy-lab search + filters, and toy grid are live. | `index.html`, `assets/js/library-view.js` |
| System readiness & performance | Readiness probes + performance controls + preflight dialog are wired. | `assets/js/readiness-probe.ts`, `assets/js/utils/init-system-check.ts`, `assets/js/core/capability-preflight.ts` |
| Toy runtime shell | Loader, toy nav, status/errors, audio prompt, and settings panel are live. | `assets/js/loader.ts`, `assets/js/toy-view.ts`, `assets/js/ui/*` |
| Audio input options | Mic, demo audio, tab capture, and YouTube capture are available. | `assets/js/ui/audio-controls.ts`, `assets/js/ui/youtube-controller.ts` |
| Renderer fallback | WebGPU preferred with direct WebGL fallback plus an optional force-WebGL compatibility mode. | `assets/js/core/renderer-capabilities.ts`, `assets/js/core/render-preferences.ts` |
| Personalization & persistence | Theme, quality presets, render/motion preferences, and search state persist. | `assets/js/library-view.js`, `assets/js/core/settings-panel.ts` |
| Gamepad + remote navigation | Focus + input support is enabled on library and toy pages for gamepads and keyboard-style TV remotes. | `assets/js/utils/gamepad-navigation.ts`, `assets/js/app.ts` |
| Toy catalog metadata | Registry includes titles, tags, moods, controls, and lifecycle stage. | `assets/data/toys.json` |

## Homepage and discovery

### Global navigation
- **Brand + jump links**: MilkDrop/start and broader toy-lab discovery are shown alongside the brand mark.
- **Discovery hubs**: Static links to `/toys/`, `/moods/`, `/capabilities/`, and `/tags/` surface the generated browse pages directly from the main nav.
- **Utilities**: Open GitHub and toggle light/dark theme.
- **Theme toggle**: A dark-mode toggle persists preference in local storage and uses view transitions when available.

### Intro hero
- **Quickstart CTA**: One primary homepage launch CTA deep-links to `toy.html?toy=milkdrop` and sets expectation that a short system check opens first.
- **Readiness summary**: “Ready • <performance> • <compatibility>” reacts to performance settings and renderer compatibility.
- **System check entry**: “Adjust performance” button opens the preflight dialog and deep-links to the system check section.
- **Claim posture**: Copy uses careful lineage language and does not claim blanket legacy compatibility.

### MilkDrop flagship proof
- **Preset-led proof points**: Bundled presets, blend transitions, live editor flow, and import/export are presented as the flagship product path.
- **Lightweight showcase**: Homepage visuals remain lightweight and do not mount the full live runtime in-place.

### System check section
- **Live readiness panel**: Displays status for graphics acceleration, microphone, motion input, and reduced motion preference.
- **Details toggle**: Expands/collapses the system check detail state while syncing the URL hash.
- **Performance controls**: Inline settings panel with quality presets, compatibility mode (force WebGL), motion enable toggle, and sliders for resolution scale + pixel ratio.
- **Fast actions**: Visible homepage buttons open the system-check modal or reveal extra readiness detail without leaving the page.
- **Preflight dialog**: Modal with readiness badges for rendering, mic, and performance warnings.

### Search, filters, and sorting
- **Browse shortcuts**: A visible shortcut row links directly to the `/moods/`, `/capabilities/`, `/tags/`, and `/toys/` pages.
- **Search**: Broader toy-lab input supports keyword matching across title, slug, description, tags, moods, and capability terms.
- **Suggestions**: Datalist is populated from toy metadata (title, tags, moods, capability terms, WebGPU).
- **Filters**: Quick chips and disclosure-based refinement share one state model, with applied search/filter/sort chips rendered into a sticky rail while scrolling.
- **Sort controls**: Featured, Newest, Most immersive, and A → Z.
- **Canonical reset**: Discovery uses one consistent “Reset view” action for sticky rail recovery and empty-state recovery.
- **Empty state**: If no matches, a reset button clears the current discovery state and keeps suggestion chips secondary on narrow screens.
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
- **WebGPU gating**: Toys can require WebGPU, optionally auto-load with WebGL fallback, and only hard-stop when a WebGPU-only toy cannot run.
- **Prewarming**: Renderer capabilities and microphone permissions are prewarmed before loading.

### Toy navigation bar
- **Now playing header**: Shows title + slug pill and “Press Esc” hint.
- **Renderer status**: Displays active renderer (WebGPU/WebGL), fallback reason, and a recovery action when the preferred renderer can be retried.
- **Share link**: Copies the current URL to clipboard with status feedback.
- **Picture-in-picture**: Captures the toy canvas into a PiP video window when supported.
- **Back to library**: Returns to the library view.

### Audio controls
- **Primary options**: Live mic or demo audio, with one focused path visually emphasized at a time.
- **First-run hinting**: A single dismissible “Try this first” recommendation is synthesized from toy metadata (`firstRunHint`, `starterPreset`, `wowControl`, `recommendedCapability`).
- **Browser audio shortcuts**: A visible utility card exposes one-tap entry points for tab capture and YouTube capture before the advanced disclosure.
- **Advanced options**:
  - Tab capture (share current tab audio).
  - YouTube capture (load a YouTube URL, then capture tab audio).
- **Status feedback**: Inline status area uses the same launch/status vocabulary as the homepage and preflight flow.
- **Preference persistence**: Stores last-used source in session storage (`stims-audio-source`), advanced panel state in `stims-audio-advanced-open`.

### Capability preflight
- **Linear launch step**: The toy shell preflight is framed as “Step 1 of 2 · System check” with one primary CTA (`Continue to audio setup`) when the toy can run.
- **Progressive disclosure**: Diagnostics remain collapsed behind a disclosure by default.
- **Fallback path**: Blocking states surface one clear library return path and keep compatible-browsing recovery obvious.

### YouTube capture
- **Iframe API loader**: Lazy-loads the YouTube API script.
- **Video parsing**: Accepts `watch?v=`, `embed`, `youtu.be`, and `shorts` formats.
- **Recent list**: Stores up to five recent video IDs in local storage (`stims_recent_youtube`).

### Settings panel (performance controls)
- **Quality presets** (stored under `stims:quality-preset`):
  - Battery saver
  - Low motion
  - TV balanced
  - Balanced (default)
  - Hi-fi visuals
- **Compatibility mode**: Force WebGL for older GPUs.
- **Motion toggle**: Enable/disable motion input on supported toys (`stims:motion-enabled`).
- **Resolution + pixel ratio controls**: Range sliders with live value labels.
- **Reset**: Clears custom overrides to match the active preset.

### Gamepad and remote navigation
- **Focus movement**: D-pad/axes and Arrow keys move focus with spatial direction matching before fallback cycling.
- **Range input support**: Left/right updates sliders in the settings panel when a range control is focused.
- **Activation + back handling**: Gamepad A/Enter activate the focused control; gamepad back, Escape, or Backspace dispatch back-to-library/Escape behavior.


### TV mode defaults
- **Quality preset**: Adds a “TV balanced” preset tuned for lower DPI and steadier frame pacing.
- **Smart TV auto-default**: On Smart TV-class user agents, system controls default to the TV preset.
- **Conservative renderer defaults**: On first run in TV mode, compatibility mode is enabled and render scale / max pixel ratio are lowered unless user overrides already exist.
- **Audio startup bias**: TV mode prefers demo audio by default while keeping microphone/tab capture options available.

## Toy catalog metadata

The toy registry is sourced from `assets/data/toys.json` (with an optional JSON override loaded from `./toys.json` on the landing page). Each entry includes:

- **Identity**: `slug`, `title`, `description`.
- **Runtime**: `module` path and `type` (`module` or `page`).
- **Rendering**: `requiresWebGPU`, `allowWebGLFallback`.
- **Lifecycle**: `lifecycleStage` (featured/prototype/archived) and `featuredRank`.
- **Discovery**: `moods`, `tags`, and `controls` for search/filter suggestions.
- **First-run guidance**: optional `firstRunHint`, `starterPreset`, `wowControl`, and `recommendedCapability` fields let the shell surface faster time-to-delight onboarding.
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
