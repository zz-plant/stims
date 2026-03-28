# Feature specifications (current build)

This document captures the **current, shipped feature set** of Stims as implemented in this repository. Product framing for current public surfaces is MilkDrop-led: Stims is an independent browser-native visualizer in the lineage of Ryan Geiss's MilkDrop, with a broader collection of related audio-reactive toys.

## Audit snapshot

| Area | Current state | Primary sources in repo |
| --- | --- | --- |
| Homepage (`index.html`) | Product-led homepage with cinematic hero, focused launch cards, preset showcase, and route-aware CTA structure is live. | `index.html`, `assets/js/bootstrap/home-page.ts`, `assets/js/utils/init-milkdrop-showcase.ts` |
| System readiness & performance | Launch-route preflight and setup tuning are wired. | `assets/js/readiness-probe.ts`, `assets/js/core/capability-preflight.ts`, `assets/js/ui/system-controls.ts` |
| Toy runtime shell | Loader, toy nav, status/errors, audio prompt, and settings panel are live. | `assets/js/loader.ts`, `assets/js/toy-view.ts`, `assets/js/ui/*` |
| Audio input options | Mic, demo audio, tab capture, and YouTube capture are available. | `assets/js/ui/audio-controls.ts`, `assets/js/ui/youtube-controller.ts` |
| Renderer fallback | WebGPU preferred with direct WebGL fallback plus an optional force-WebGL compatibility mode. | `assets/js/core/renderer-capabilities.ts`, `assets/js/core/render-preferences.ts` |
| Personalization & persistence | Theme, quality presets, render/motion preferences, and search state persist. | `assets/js/library-view.js`, `assets/js/core/settings-panel.ts` |
| Gamepad + remote navigation | Focus + input support is enabled on library and toy pages for gamepads and keyboard-style TV remotes. | `assets/js/utils/gamepad-navigation.ts`, `assets/js/app.ts` |
| Toy catalog metadata | Registry includes titles, tags, moods, controls, and lifecycle stage. | `assets/data/toys.json` |

## Homepage and routing

### Global navigation
- **Brand + jump links**: The homepage exposes launch options, preset showcase, the Why Stims section, and the launchpad.
- **Utilities**: Open GitHub and toggle light/dark theme.
- **Theme toggle**: A dark-mode toggle persists preference in local storage and uses view transitions when available.

### Intro hero
- **Primary CTA**: One homepage CTA deep-links to the live workspace with demo audio.
- **Secondary CTA**: One homepage CTA opens `/milkdrop/` as the immersive-first MilkDrop route.
- **Product framing**: Copy emphasizes browser-native playback, live editing, bundled presets, and multiple audio inputs before the route model appears lower on the page.

### Launch cards
- **Focused entry points**: Static cards give users three obvious first moves: demo playback, bring-your-own-audio setup, and live editing.
- **No in-place runtime boot**: Homepage visuals remain lightweight and do not mount the full live runtime in-place.

### Preset showcase
- **Curated entry points**: Bundled preset cards and collection filters are hydrated from `public/milkdrop-presets/catalog.json`.
- **Launch behavior**: Preset cards open the live workspace on `/milkdrop/` and can preselect a preset before playback begins.

### Why Stims section
- **Intentional split**: Static copy explains the roles of homepage, `/milkdrop/`, and the live overlay without turning the whole page into route documentation.
- **Lineage language**: Copy continues to credit Ryan Geiss&rsquo;s MilkDrop without implying official continuation.

## Toy runtime shell

### Loader & routing
- **Route entry**: `/milkdrop/` loads the flagship module, and `/milkdrop/?experience=<slug>` supports explicit deep links when needed.
- **Lifecycle**: Loader handles status states, disposal, and cleanup before switching toys.
- **WebGPU gating**: Toys can require WebGPU, optionally auto-load with WebGL fallback, and only hard-stop when a WebGPU-only toy cannot run.
- **Prewarming**: Renderer capabilities and microphone permissions are prewarmed before loading.

### Toy navigation bar
- **Minimal default chrome**: Live mode keeps visible chrome lean by default and reveals the fuller menu/tray on demand.
- **Renderer status**: Displays active renderer (WebGPU/WebGL), fallback reason, and a recovery action when the preferred renderer can be retried.
- **Session actions**: Share link, picture-in-picture, and back navigation remain available from the revealed session menu.

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
- **Linear launch step**: The toy shell preflight still guards startup, but demo playback can move directly into immersive mode once the check succeeds.
- **Progressive disclosure**: Technical details remain collapsed behind a disclosure by default.
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

### MilkDrop live overlay
- **Preset-first overlay**: Browsing and transport stay on the primary overlay surface.
- **Tools one layer deeper**: Editor and inspector remain available from a secondary tools surface and still honor deep-link entry.
- **Shortcut HUD + preset OSD**: Live mode can surface a transient preset announcement and a dedicated shortcut sheet without making them persistent chrome.

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
