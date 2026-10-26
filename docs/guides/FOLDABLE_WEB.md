# Foldable web progressive enhancement

This small, dependency-free utility reads standards-style device posture and
viewport segments where exposed by the browser. It does **not** infer fold
posture from viewport width and does **not** simulate hardware.

```ts
import { observeFoldableViewport } from '../../src/js/utils/foldable-viewport';

const stop = observeFoldableViewport(window, ({ posture, segments }) => {
  // Use physical segment information only when actually available.
  // Prefer CSS grid and container queries for ordinary responsive layout.
  console.debug({ posture, segments });
});

// Invoke stop() on teardown.
```

Use `@media (horizontal-viewport-segments: 2)` and corresponding
`env(viewport-segment-*)` values only as progressive CSS enhancements.
Keep controls accessible on non-foldable browsers, preserve focus and playback
state on resizing, and provide a manual way to select an alternate layout.

Tests: `bun test tests/unit/foldable-viewport.test.ts`.

This is an API-reading primitive, **not** a guarantee of Safari or Samsung
Internet support. Test real hardware and browser versions independently.
