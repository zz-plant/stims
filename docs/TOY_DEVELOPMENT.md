# Toy Development Playbook

Use this playbook when adding or modifying toys so new experiences integrate cleanly with the rest of the Stim Webtoys Library.

## Core Expectations

- Place new toy modules under `assets/js/toys/` and export a `start(options)` entry point.
- Export `start({ container, canvas?, audioContext? })`. `container` is the preferred target for rendering.
- Register the toy in `assets/js/toys-data.js` with a unique slug, label, and any default parameters. Keep the module path under `assets/js/toys/`.
- Load toys through `toy.html?toy=<slug>` or a dedicated HTML entry point. Keep query string slugs in sync with `toys-data.js`.
- Keep assets (textures, JSON data, audio snippets) in `assets/data/` and reference them with relative paths.
- Run `bun run check:toys` before committing to confirm every module in `assets/js/toys/` is registered and page-backed toys have matching HTML entry points.
- Run `bun run check:quick` to validate types and code quality with Biome before opening a PR.

## Toy lifecycle and featured rotation

Treat toys like live game content and keep their status explicit in metadata:

- **Lifecycle stages** live in `assets/js/toys-data.js` as `lifecycleStage`:
  - `prototype`: new or experimental toys that need fast iteration.
  - `featured`: curated experiences that get the most attention and polish.
  - `archived`: stable toys that stay available but are not actively promoted.
- **Featured curation** uses `featuredRank` (lower = higher priority) to drive the default “Featured” sort in the library. Keep the set intentionally small (roughly 5–8 toys) so the landing grid stays focused.
- **Rotation cadence**: revisit the featured set on a regular schedule (every 4–6 weeks). When rotating, update `featuredRank` and `lifecycleStage` in `assets/js/toys-data.js` so the UI reflects the new lineup.
- **Polish passes**: schedule periodic quality passes on `featured` toys (monthly) and `prototype` toys (as needed). Each pass should include performance verification, accessibility checks, and a quick review of controls/labels against the latest UI conventions.

## Quality preset mapping (toy author guidance)

Quality presets are global and persist across toys, so toys should respond consistently when the user changes them:

- **Honor the shared settings**: call `toy.updateRendererSettings()` (or `handle.applySettings()` if you are managing a pooled renderer handle directly) when the settings panel broadcasts a change.
- **Avoid hard-coded pixel ratios**: use the preset-provided `maxPixelRatio` and `renderScale` as the baseline; override only if a toy has a documented performance need.
- **Scale expensive effects**: map presets to particle counts, post-processing strength, or shader iterations. Keep the “Battery saver” preset under ~65% of default costs, and let “Hi-fi visuals” increase costs modestly (around 135%) without exceeding target frame times.
- **Persist in the session**: rely on the shared settings panel to persist choices so users do not have to reconfigure on every toy switch.
- **Match default preset intent**: align with the baseline values documented in `docs/DEVELOPMENT.md` so renderer settings stay consistent across toys.

## Authoring custom quality presets

Use custom quality presets only when a toy needs additional fidelity tiers or different particle scaling than the shared defaults.

- **Define the preset list explicitly** using the `QualityPreset` shape (`id`, `label`, `description`, `maxPixelRatio`, `renderScale`, optional `particleScale`). Keep `id` values stable so stored selections remain valid.
- **Wire presets into the settings panel** by passing them to `createToyQualityControls({ presets, defaultPresetId })` or `createRendererQualityManager({ presets })` so the shared panel renders the correct options and persists the active preset.
- **Map presets to toy-specific knobs** with `getRendererSettings` or an `onChange` callback if you need to scale shader iterations, particle counts, or effect intensity beyond `maxPixelRatio` and `renderScale`.
- **Avoid clobbering global state**: if a toy truly requires its own preset list, set a `storageKey` to keep it separate from the shared `stims:quality-preset` setting, and explain the divergence in the toy’s inline description.
- **Keep copy concise**: use the `description` field to explain the trade-off (performance vs. fidelity) so the control panel stays scannable.

## Settings panel checklist (toy-facing controls)

When exposing toy-specific controls, align them with the shared panel patterns so the UI stays predictable:

- **Quality controls**: ensure the toy responds to the shared presets and exposes any additional performance toggles only when necessary.
- **Audio controls**: surface mic/demo audio status and avoid conflicting with the shell-level controls; if you add per-toy audio toggles, keep labels concise and defer to the shared audio UI when possible.
- **Performance cues**: note performance-impacting toggles with short helper text (e.g., “Lower GPU load”).
- **Accessibility**: keep controls keyboard-focusable, label every toggle, and maintain visible focus styles to match the shared panel conventions.

## Add-and-test checklist (fast path)

Use this sequence when you want to stand up a fresh toy quickly (you can also run `bun run scripts/scaffold-toy.ts --slug my-toy --title "My Toy" --type module --with-test` to automate the setup steps).

### Add a new stim (step-by-step)

Use the scaffold script whenever possible; it wires up metadata, docs, and optional tests for you. If you prefer manual edits, follow the checklist below and keep the file paths aligned.

1. **Pick a slug**: choose a short, kebab-case slug (for example `pocket-pulse`) that will become the `toy.html?toy=<slug>` route.
2. **Scaffold the module** (recommended):
   ```bash
   bun run scripts/scaffold-toy.ts --slug pocket-pulse --title "Pocket Pulse" --type module --with-test
   ```
   The script creates `assets/js/toys/<slug>.ts`, appends the metadata entry in `assets/js/toys-data.js`, updates `docs/TOY_SCRIPT_INDEX.md`, and generates a minimal test in `tests/`.
3. **Manual alternative** (if you skipped the scaffold):
   - Create `assets/js/toys/<slug>.ts` and export `start({ container, canvas?, audioContext? })`.
   - Add the entry to `assets/js/toys-data.js` (include `title`, `description`, `module`, `type`, and any `lifecycleStage` metadata).
   - Add the slug row to `docs/TOY_SCRIPT_INDEX.md` so the loader docs stay in sync.
   - Create `toys/<slug>.html` only if the toy uses a standalone page.
4. **Wire the runtime**: use `createToyRuntimeStarter` or `createToyRuntime` so audio, renderer, input, and settings panel behavior matches the rest of the library. Keep all DOM work scoped to the provided `container`.
5. **Verify locally**: run `bun run dev` and load `http://localhost:5173/toy.html?toy=<slug>` to confirm the new card loads, starts audio, and cleans up on exit.
6. **Run quality checks** before opening a PR:
   - `bun run check:toys` (ensures metadata, modules, and HTML entry points stay in sync)
   - `bun run check` (Biome + typecheck + tests)

   The scaffold script can also generate a minimal Bun spec for you (`--with-spec`) that asserts the module exports `start`, and it will create a placeholder HTML page for page-based toys when one is missing.

7. **Manual spot-checks**:
   - Confirm the Back to Library control returns to the grid and removes your DOM nodes (cleanup).
   - Verify microphone permission flows (granted, denied, and sample-audio fallback) if you request audio.
   - For WebGPU toys, confirm the fallback/warning screen appears on non-WebGPU browsers.

8. **Document any special controls** inside your module (inline comments) or in a short note in `README.md` if they differ from other toys.

## Starter Template

Use this skeleton for new toys to standardize lifecycle hooks and cleanup:

```ts
import WebToy, { type WebToyOptions } from '../core/web-toy';
import type { ToyStartFunction } from '../core/toy-interface';

export const start: ToyStartFunction = async ({ container, canvas, audioContext }) => {
  const toy = new WebToy({
    container,
    canvas,
    cameraOptions: { position: { z: 50 } },
  });

  // Example: Add a mesh
  // const mesh = new Mesh(geometry, material);
  // toy.scene.add(mesh);

  function animate(time: number) {
    if (!toy.renderer) return;
    
    // Update logic here
    
    toy.render();
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);

  return {
    dispose: () => {
      toy.dispose();
      // Clean up other resources
    },
    // Optional: add methods to control the toy
    // updateOptions: (options) => { ... },
  };
}
```

Adjust imports to match the actual helpers you use.

## Audio Reactivity Tips

- Normalize microphone input: use the analyzer helpers in `assets/js/core/audio` to derive frequency bins, waveform data, and energy levels.
- Consider a short attack/decay envelope to smooth sudden spikes.
- Provide fallback visuals or an explicit "Enable mic" button when permission is missing.

### Microphone permission flow

- Reuse the centralized UI helper in `assets/js/core/microphone-flow.ts` to request mic access, surface denial/timeout states, and reveal a "Load demo audio" fallback.
- Wire the helper to your toy by passing callbacks that start microphone audio and demo audio (e.g., `startToyAudio` with `fallbackToSynthetic: true`).
- Optional analytics/logging hooks let you forward `microphone_request_started`, `microphone_request_succeeded`, and `microphone_request_failed` events to any telemetry client.

Example snippet:

```ts
import { setupMicrophonePermissionFlow } from '../core/microphone-flow';

setupMicrophonePermissionFlow({
  startButton: document.getElementById('start-audio-btn'),
  fallbackButton: document.getElementById('use-demo-audio'),
  statusElement: document.getElementById('audio-status'),
  requestMicrophone: () => startToyAudio(toy, animate),
  requestSampleAudio: () =>
    startToyAudio(toy, animate, { fallbackToSynthetic: true }),
});
```

Manual scenarios to verify:

- **Granted**: Start audio shows a success status and keeps the sample-audio action hidden.
- **Denied or timed out**: Status switches to error, the sample-audio action becomes visible, and retrying succeeds after updating browser permissions.

## Rendering Patterns

- Keep animation state outside Three.js objects where possible; mutate them inside a `tick` loop driven by `requestAnimationFrame`.
- Throttle expensive operations on resize and use the `maxPixelRatio` option to keep frame times stable on high-DPI screens.
- Reuse materials and geometries instead of recreating them each frame. Dispose buffers and textures in the cleanup function.

## Mobile and Interaction

- Test on touch devices or emulators. Avoid interactions that depend solely on hover.
- For device motion input, gate logic behind feature detection (`window.DeviceMotionEvent`).
- Ensure important controls are keyboard-focusable and include visible focus states.
- For custom control-panel buttons, use `.control-panel__mode` (or the shared control-panel button styles) to guarantee 44x44 touch targets and visible focus treatment.
- Normalize pointer handling with `assets/js/utils/pointer-input.ts` so toys share the same multi-touch pan/zoom/rotate gestures and hit detection. Prefer passing a canvas or container element so pointer math uses its exact bounds.
- Apply the `.toy-canvas` class to fullscreen canvases and include `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` in HTML heads to keep sizing consistent on mobile safe areas.
- Sanity-check layout at common breakpoints (e.g., 320x568, 375x812, 768x1024) to confirm controls remain tappable and canvases stay clipped to the viewport.

## Debugging Checklist

- If visuals are blank, confirm the canvas is attached and the renderer size matches `clientWidth`/`clientHeight`.
- When audio-driven behavior seems off, log the analyzer samples to verify data ranges and check microphone permissions in the browser.
- Validate new entries in `toys-data.js` by visiting `toy.html?toy=<slug>` and verifying the selection UI lists the new toy.

## Testing Guidance

- Add Bun specs for math and utility helpers in `assets/js/utils/` as they are shared by multiple toys.
- For toy-specific logic, prefer unit-testing pure functions (e.g., color pickers, motion curves) rather than WebGL rendering.
- Keep tests deterministic: mock `performance.now`, random seeds, and any time-based easing functions when needed.
- Use the Bun test runner with the shared happy-dom preload in `tests/setup.ts` and the import map in `tests/importmap.json` along with the stub helpers in `tests/toy-test-helpers.ts` (see `tests/sample-toy.test.ts`) to spin up a toy container, fake audio context/analyzer, or mock renderer. Follow that pattern to ensure `start` returns a cleanup function and disposes DOM nodes and audio handles.

## Documentation

- Update `README.md` and `CONTRIBUTING.md` if you introduce new scripts or global expectations.
- Describe user-facing controls or setup steps in the associated HTML entry point if they deviate from existing patterns.
- Include inline comments for novel shader parameters, math tricks, or input handling quirks.
- When you wrap an existing HTML page for use in `toy.html`, expose it through `startPageToy` (see `assets/js/toys/*`) and add the slug to `assets/js/toys-data.js` so the loader can surface it in the library view.
