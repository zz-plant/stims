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
3. Open `http://localhost:5173/milkdrop/?preset=eos-glowsticks-v2-03-music` and confirm the alias lands in the same root workspace state

## Measured preset lab (no eyes required)

Prefer measured evidence over eyeballing whenever the question is "does this
preset look right / react to audio?". The preset lab produces numeric verdicts
that work for agents without vision or hearing, plus PNG contact sheets for
agents that can see:

```bash
bun run lab:reactivity -- --preset <id> --baseline   # headless VM, ~15s, deterministic
bun run lab:visual -- --preset <id> --baseline       # headless Chromium pixels
# …edit the preset or runtime…
bun run lab:reactivity -- --preset <id> --compare    # ▲ improved / ▼ REGRESSED
bun run lab:visual -- --preset <id> --compare
```

Reports land in `scratch/preset-lab/<id>/` (gitignored). The full loop and
metric interpretation guide live in
[`.agent/skills/improve-preset-fidelity/SKILL.md`](../../.agent/skills/improve-preset-fidelity/SKILL.md).

## Cloud/sandboxed agents without a GPU

Playwright's default headless Chromium launches the real Chrome binary,
which needs a real GPU for WebGL/WebGPU. On a GPU-less host (most cloud
agent sandboxes) that silently produces a black canvas — no error, just a
blank capture that looks like a rendering bug.

- `bun run ctl` (`scripts/stims-ctl.ts`) and `bun run mcp` (`scripts/mcp-server.ts`)
  default to **software rendering (SwiftShader)** for exactly this reason —
  deterministic and works with no GPU, at some speed cost. Set
  `STIMS_GPU_RENDER=1` to use the host GPU instead, when you know one is
  available and want the speed.
- `bun run lab:visual`, `bun run sweep:milkdrop-loops`, and the corpus/parity
  suites default the **other** way (real GPU, since they run mostly on
  developer machines) — set `STIMS_SOFTWARE_RENDER=1` to force SwiftShader
  there.
- Every capture records the actual WebGL renderer string
  (`rendererString` in `stims-ctl` output, `probeCaptureBackend` in lab/sweep
  artifacts). Check it before trusting a result — SwiftShader and real-GPU
  captures are not pixel-comparable, and `lab:visual --compare` refuses to
  diff across a backend mismatch.
- **"Executable doesn't exist" is usually an environment mismatch, not a
  broken repo.** Cloud containers pre-install Chromium under
  `PLAYWRIGHT_BROWSERS_PATH` and forbid `playwright install`, but Playwright
  only looks for the exact revision its own version pins — a Playwright bump
  leaves every browser tool dead on arrival. `bun run setup:browsers`
  (`scripts/link-preinstalled-browsers.ts`) links the shipped build into the
  layout the pinned Playwright expects; `bun run setup` runs it automatically,
  and `bun run doctor` reports which binary resolved. The linked build is not
  the pinned one, so read an unexplained protocol error as version skew.
- **The e2e suites decide headed-vs-headless by the display, not by `CI`.**
  `tests/e2e/headless-environment.ts` treats a Linux box with no `DISPLAY` the
  same as CI: headless, SwiftShader, and skip the suites that need a real GPU
  or a headed window. Keying on `CI` alone sent cloud containers down the
  headed path, where Chromium exits with "Missing X server or $DISPLAY" before
  the first assertion.
- `bun run lab:reactivity` needs no browser or GPU at all — it drives the
  MilkDrop VM directly in-process. Prefer it when you only need to know
  "does this preset respond to audio," not "what does it look like."
- `session_describe_frame` (MCP) returns numeric image metrics (brightness,
  colorfulness, near-black detection) alongside the screenshot path, so an
  agent without vision can tell a real render apart from a blank one.
- For anything where a screenshot isn't enough evidence — GPU-specific
  behavior, WebGPU, anything you want a human to actually click around in —
  `bun run preview:deploy` (`scripts/deploy-preview.ts`) builds and deploys a
  real Cloudflare Worker version preview and prints the live URL (`-- --json`
  for a parseable `{ url, versionId }`). This is a real deploy, not a
  screenshot: it needs `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
  credentials (locally via `wrangler login`, or as repo secrets for the CI
  step below), and it's the strongest fallback a cloud agent with no local
  browser/GPU has — hand the URL to a human, or drive it yourself with a
  Browser-pane-style tool.
- The `visual-evidence` GitHub Actions job (`workflow_dispatch` only, see
  `.github/workflows/ci.yml`) runs `ui:diff` + `lab:visual`, uploads the
  results as build artifacts, and — if `CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_ACCOUNT_ID` repo secrets are configured — deploys a live
  preview and writes the URL to the job summary. It asserts nothing on pixel
  content, so it can't reintroduce the SwiftShader-timing flakiness the old
  e2e visual-regression test had; trigger it from a pushed branch to get
  evidence without running a browser locally at all. **The Cloudflare
  secrets are not currently configured in this repo's CI** — until they are,
  that one step is skipped and everything else in the job still runs.

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

For coordinated successor work, keep browser QA aligned with [`docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md`](../MILKDROP_SUCCESSOR_WORKSTREAMS.md) so proof, parity, and product claims stay synchronized.

For the bundled shipped presets, test them in the same order used by the parity corpus so evidence stays easy to compare:

- `eos-glowsticks-v2-03-music`
- `rovastar-parallel-universe`
- `eos-phat-cubetrace-v2`
- `krash-rovastar-cerebral-demons-stars`

For each one, confirm the capture, reference import, and measured-result promotion steps complete before treating the preset as certified in docs or catalog labels.

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

- Use [`../../.agent/workflows/test-visualizer.md`](../../.agent/workflows/test-visualizer.md) for the repo-local testing workflow
- Use [`../../.agent/workflows/ship-visualizer-change.md`](../../.agent/workflows/ship-visualizer-change.md) for the full implementation→validation→PR-ready workflow
- Use [`./custom-capabilities.md`](./custom-capabilities.md) when you need to choose the right repo-local skill or workflow first
- See [Tooling and Quality](./tooling-and-quality.md) for all available verification commands
