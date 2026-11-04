# Foldable web support

Stims changes layout when the browser reports a hinge through the Viewport
Segments API. It never infers a fold from viewport width or a device name.

| Hinge                             | Media query                        | Layout                                                                                         |
| --------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Across the screen (laptop pose)   | `vertical-viewport-segments: 2`    | The live stage takes the upper half, at that shape. Every panel fills the lower half.          |
| Down the screen (book pose)       | `horizontal-viewport-segments: 2`  | One canvas spans both halves. Panels take the right half, and the dock and toasts stay left.   |
| None, or the window is on one side | neither                            | The ordinary layout for the window's size.                                                     |

The stylesheets key on the media queries: `shell/fold-layout.css`,
`SidePanel.module.css` and `StageControls.module.css`. Scripts that have to agree with
them, such as whether a panel is a bottom sheet, use `currentFoldLayout()` from
`src/js/utils/foldable-viewport.ts`, which reads the same segments.

Opening a panel never resizes the canvas, because a resize restarts the
preset's feedback. In a laptop pose the stage is already above the panel, and in
a book pose the canvas moves left. Only the hinge itself changing resizes it.

## Browser support

Checked November 2026.

- **Chrome and Edge:** Viewport Segments from 138. Device Posture from Chrome 132.
- **Samsung Internet:** MDN's compatibility data lists Device Posture from 16.2.
  Samsung's Android release notes stop at November 2023, so confirm current
  behaviour on a device.
- **Safari 27.1 on iPhone Duo:** both APIs are behind feature flags, so these
  layouts reach only people who turned the flags on. Everyone else gets the
  ordinary layout at Duo's window sizes, which is why
  `tests/fixtures/responsive-scenarios.ts` carries them.
- **Firefox:** neither.

Safari does not draw pages behind its side controls on Duo's outer display, and
fills that space with the page's background colour. `html` and `body` name the
stage's dark colour for that reason.

## Testing

`tests/e2e/foldable-layout.test.ts` reports a real hinge to the page through
Chromium's DevTools protocol. Use `Emulation.setDeviceMetricsOverride` with
`displayFeature` and `devicePosture`: `setDisplayFeaturesOverride` answers ok but
leaves one segment, and `page.screenshot` resets the override, so capture with
`Page.captureScreenshot` while emulating.

```bash
bun run test tests/e2e/foldable-layout.test.ts
```

This proves the layout follows the hinge it is told about. Sources do not say
exactly when real devices report two segments, so check on hardware before
trusting a change here. iPhone Duo needs Xcode 27.1 or later for its simulator.

`bun run telemetry:report` counts audible starts on a half-folded screen. A
foldable held flat reports one segment, so this measures half-folded use, not
how many visitors own a foldable.
