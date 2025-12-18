# Toy Development Playbook

Use this playbook when adding or modifying toys so new experiences integrate cleanly with the rest of the Stim Webtoys Library.

## Core Expectations

- Place new toy modules under `assets/js/toys/` and export a `start(options)` entry point.
- Register the toy in `assets/js/toys-data.js` with a unique slug, label, and any default parameters.
- Load toys through `toy.html?toy=<slug>` or a dedicated HTML entry point. Keep query string slugs in sync with `toys-data.js`.
- Keep assets (textures, JSON data, audio snippets) in `assets/data/` and reference them with relative paths.

## Starter Template

Use this skeleton for new toys to standardize lifecycle hooks and cleanup:
```ts
import { initRenderer } from '../core/renderer';
import { createAnalyzer } from '../core/audio';

export async function start({ canvas, audioContext }) {
  const { renderer, scene, camera, resize } = initRenderer({ canvas, maxPixelRatio: 2 });
  const analyzer = await createAnalyzer(audioContext);

  function tick(time) {
    const { frequency, waveform } = analyzer.sample();
    // update your objects using frequency/waveform data here
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  resize();
  requestAnimationFrame(tick);

  return () => {
    analyzer.dispose?.();
    renderer.dispose?.();
  };
}
```
Adjust imports to match the actual helpers you use.

## Audio Reactivity Tips

- Normalize microphone input: use the analyzer helpers in `assets/js/core/audio` to derive frequency bins, waveform data, and energy levels.
- Consider a short attack/decay envelope to smooth sudden spikes.
- Provide fallback visuals or an explicit "Enable mic" button when permission is missing.

## Rendering Patterns

- Keep animation state outside Three.js objects where possible; mutate them inside a `tick` loop driven by `requestAnimationFrame`.
- Throttle expensive operations on resize and use the `maxPixelRatio` option to keep frame times stable on high-DPI screens.
- Reuse materials and geometries instead of recreating them each frame. Dispose buffers and textures in the cleanup function.

## Mobile and Interaction

- Test on touch devices or emulators. Avoid interactions that depend solely on hover.
- For device motion input, gate logic behind feature detection (`window.DeviceMotionEvent`).
- Ensure important controls are keyboard-focusable and include visible focus states.

## Debugging Checklist

- If visuals are blank, confirm the canvas is attached and the renderer size matches `clientWidth`/`clientHeight`.
- When audio-driven behavior seems off, log the analyzer samples to verify data ranges and check microphone permissions in the browser.
- Validate new entries in `toys-data.js` by visiting `toy.html?toy=<slug>` and verifying the selection UI lists the new toy.

## Testing Guidance

- Add Jest specs for math and utility helpers in `assets/js/utils/` as they are shared by multiple toys.
- For toy-specific logic, prefer unit-testing pure functions (e.g., color pickers, motion curves) rather than WebGL rendering.
- Keep tests deterministic: mock `performance.now`, random seeds, and any time-based easing functions when needed.

## Documentation

- Update `README.md` and `CONTRIBUTING.md` if you introduce new scripts or global expectations.
- Describe user-facing controls or setup steps in the associated HTML entry point if they deviate from existing patterns.
- Include inline comments for novel shader parameters, math tricks, or input handling quirks.

