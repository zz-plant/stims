# Visual Testing for Agents

Visual verification is a critical part of agent work on Stims. This guide covers browser-based testing, development tools, and validation approaches for confirming UI, animation, and preset behavior.

## Development server and agent-mode URL

Always start here:

```bash
bun run dev
```

This launches the Vite dev server at `http://localhost:5173/`. The key URLs for agent work are:

| URL | Purpose | When to use |
|-----|---------|------------|
| `http://localhost:5173/` | Canonical workspace route | Testing launch controls, preset browsing, and live session behavior |
| `http://localhost:5173/?agent=true` | Agent testing mode on the canonical route | Detailed QA, debugging, and state persistence checks |
| `http://localhost:5173/milkdrop/?agent=true` | Compatibility-alias verification | Confirming old links redirect into the same root workspace state |

### Agent testing mode (`?agent=true`)

The `?agent=true` query parameter activates a special testing mode designed for detailed agent verification:

**What changes**:
- State persists across page reloads (use ↻ to refresh without losing preset/settings)
- Cleaner debug UI overlay (if enabled)
- Console logging is more detailed
- Predictable behavior for visual regression testing

**When to use**:
- Testing a specific preset across multiple interactions
- Verifying UI state changes persist correctly
- Debugging animation or rendering issues
- Visual regression testing (comparing before/after)

**Example workflow**:
1. Load a preset in agent mode
2. Change settings (scroll, zoom, etc.)
3. Refresh the page (↻) and confirm settings persist
4. Use DevTools to inspect state

## Browser developer tools

Open DevTools in your dev server to debug visuals and performance:

```
Windows/Linux: F12
macOS: Cmd+Option+I
```

### Layers you can inspect

| Tab | Use for |
|-----|---------|
| **Elements** | Inspect DOM structure, verify CSS is applied, check layout |
| **Console** | View log messages, check for errors/warnings, execute debug commands |
| **Network** | Check asset loading, preset/texture fetch timing, data sizes |
| **Performance** | Record frame rate, identify rendering bottlenecks, check memory usage |

### Common checks

- **No errors in Console**: Look for red error messages (distinguish from warnings)
- **Frame rate**: Open Performance tab, start recording, play for 10 seconds, stop. Should maintain 60fps on modern hardware
- **Asset sizes**: Network tab → filter by Preset/Texture → confirm reasonable file sizes
- **Mobile layout**: Resize DevTools viewport to 375px width, test on `?agent=true` URL

## Testing by change type

### UI/styling changes

```bash
bun run dev
```

**Verification checks**:
1. Open `http://localhost:5173/` and exercise both launch and live-session UI on the same route.
2. Resize the browser to test responsive behavior:
   - Desktop: 1920px+ width
   - Tablet: 768-1024px width
   - Mobile: 375-480px width
3. Check both light and dark modes (usually toggleable in UI)
4. Open DevTools (F12) and confirm:
   - No layout errors or overlapping elements
   - Font sizes, spacing, colors match the design intent
   - Animations (if any) run smoothly

### Preset or animation behavior changes

```bash
bun run dev
```

1. Open `http://localhost:5173/`
2. Load a preset from the workspace browser
3. Wait for audio input to start (click play if needed)
4. Observe the visualization for:
   - Responsiveness to music/audio
   - No visual glitches or rendering errors
   - Smooth animation frame rate
5. Switch between 2-3 different presets and repeat
6. If behavior differs by preset, test multiple presets to confirm the pattern

**For deeper debugging**:
- Use `?agent=true` mode to persist state
- Check Console tab for errors related to the preset
- Use Performance tab to record and identify frame drops

### Audio reactivity or controls

1. Ensure your audio source is active (microphone, speaker output, uploaded file)
2. Open `http://localhost:5173/?agent=true`
3. Start audio (music, voice, etc.)
4. Verify:
   - Visualizer responds to bass/mid/treble frequencies
   - Volume changes are reflected in animation intensity
   - UI controls (if you added any) respond to audio input

### Preset loading/library changes

1. Open `http://localhost:5173/`
2. Verify:
   - Presets are listed and visible
   - Search/filter functionality works
   - Clicking a preset updates the live session and canonical route state
3. Open `http://localhost:5173/milkdrop/?preset=signal-bloom` and confirm the alias lands in the same root workspace state

## Automated visual regression testing

For visual changes that need to be tracked over time, refer to:

```
docs/MANUAL_SMOKE_BASELINE.md
scripts/capture-visual-reference-suite.ts
scripts/measured-visual-results.ts
```

These tools help you:
1. Capture a visual baseline of the current state
2. Compare future visual changes against the baseline
3. Detect unintended visual regressions

See the Parity docs for details:
- [`../../docs/MILKDROP_PROJECTM_PARITY_PLAN.md`](../../docs/MILKDROP_PROJECTM_PARITY_PLAN.md)
- [`../../docs/MILKDROP_PROJECTM_PARITY_BACKLOG.md`](../../docs/MILKDROP_PROJECTM_PARITY_BACKLOG.md)

## Quick mobile testing (no device needed)

DevTools in most browsers can simulate mobile devices without a phone. In Chrome/Edge/Firefox:

1. Press F12 to open DevTools
2. Look for the "Device Toggle" button (phone/tablet icon, usually top-left of DevTools)
3. Click it to simulate a mobile viewport
4. Choose a device preset or set custom width (375px for mobile)
5. Refresh the page and test interactions

## Troubleshooting visual issues

| Problem | Diagnostic | Solution |
|---------|-----------|----------|
| Page is blank or shows errors | Open DevTools Console (F12) | Check error messages; if build is stale, stop/restart `bun run dev` |
| Changes don't appear in browser | Dev server may be out of sync | Stop (Ctrl+C), run `bun run dev` again |
| Audio not detected | Check microphone/speaker permissions | Browser may need permission to access audio; confirm in browser settings |
| Preset won't load | Check Network tab in DevTools | Ensure preset file exists and is being fetched successfully |
| Frame rate is low | Check Performance tab; identify long tasks | May be rendering issue; compare with baseline or upstream |
| Mobile layout is broken | Use DevTools device simulator | Test at 375px, 768px, 1024px, 1920px widths |

## Next steps

- Use [`./test-visualizer.md`](./test-visualizer.md) for automated testing approaches
- Use [`./ship-visualizer-change.md`](./ship-visualizer-change.md) for the full implementation→visibility→PR workflow
- See [Tooling and Quality](./tooling-and-quality.md) for all available verification commands
