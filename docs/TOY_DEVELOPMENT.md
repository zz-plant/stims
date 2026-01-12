# Toy Development Playbook

Use this playbook when adding or modifying toys so new experiences integrate cleanly with the rest of the Stim Webtoys Library.

## Core Expectations

- Place new toy modules under `assets/js/toys/` and export a `start(options)` entry point.
- Export `start({ container, canvas?, audioContext? })`. `container` is the preferred target for rendering.
- Register the toy in `assets/js/toys-data.js` with a unique slug, label, and any default parameters. Keep the module path under `assets/js/toys/`.
- Load toys through `toy.html?toy=<slug>` or a dedicated HTML entry point. Keep query string slugs in sync with `toys-data.js`.
- Keep assets (textures, JSON data, audio snippets) in `assets/data/` and reference them with relative paths.
- Run `bun run check:toys` before committing to confirm every module in `assets/js/toys/` is registered and iframe-backed toys have matching HTML entry points.
- Run `bun run check:quick` to validate types and code quality with Biome before opening a PR.

## Add-and-test checklist (fast path)

Use this sequence when you want to stand up a fresh toy quickly (you can also run `bun run scripts/scaffold-toy.ts --slug my-toy --title "My Toy" --type module --with-test` to automate steps 1–3):

1. **Create a module** in `assets/js/toys/<slug>.ts` using the starter template below. Export `start({ container, canvas?, audioContext? })`. Use `container` to scope your DOM operations (settings panels, etc.) and `WebToy` to handle the canvas and resize logic within that container.
2. **Register the slug** in `assets/js/toys-data.js` with a short title/description. Set `requiresWebGPU` or `allowWebGLFallback` if you depend on WebGPU features. The scaffold script validates that metadata entries live under `assets/js/toys/` and that slugs remain unique.
3. **Create entry points**: module-based toys use `toy.html?toy=<slug>`; iframe-backed toys also need an HTML page (`<slug>.html`). The scaffold script writes a starter iframe page if one does not already exist.
4. **Launch locally** with `bun run dev` and visit `http://localhost:5173/toy.html?toy=<slug>` to verify the manifest entry resolves and the loader shows your toy card.
5. **Run quick tests** before opening a PR:
   - `bun test tests/loader.test.js` (loader + capability checks)
   - `bun test tests/app-shell.test.js` (library shell wiring)
   - Add a focused spec for any pure helpers you introduce (e.g., easing/color math) in `tests/`.
   - `bun run check:toys` (ensures metadata, modules, and iframe entry points stay in sync)
   - `bun run check:quick` (Biome linting and TypeScript check)

   The scaffold script can also generate a minimal Bun spec for you (`--with-spec`) that asserts the module exports `start`, and it will create a placeholder HTML page for iframe-based toys when one is missing.

6. **Manual spot-checks**:
   - Confirm the Back to Library control returns to the grid and removes your DOM nodes (cleanup).
   - Verify microphone permission flows (granted, denied, and sample-audio fallback) if you request audio.
   - For WebGPU toys, confirm the fallback/warning screen appears on non-WebGPU browsers.

7. **Document any special controls** inside your module (inline comments) or in a short note in `README.md` if they differ from other toys.

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
- When you wrap an existing HTML page for use in `toy.html`, expose it through `startIframeToy` (see `assets/js/toys/*`) and add the slug to `assets/js/toys-data.js` so the loader can surface it in the library view.
