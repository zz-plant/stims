# QA plan

Run this checklist after changing the workspace, startup, routes, audio, settings, or the renderer. Commands, profiles and gates are in [Testing](./TESTING.md); run those first.

## Before the manual pass

```bash
bun run check
bun run test:integration   # real Chromium: boot, routes, audio, renderer
```

`tests/e2e/agent-integration.test.ts` is the integration test. For a narrower loop on the shell and its URL contract, run `tests/unit/app-shell.test.ts`, `tests/unit/app-shell-route-sync.test.ts`, `tests/unit/frontend-url-state.test.ts` and `tests/unit/settings-panel.test.ts` through `bun run test`.

## Manual checklist

Run it on `bun run dev` at `http://localhost:5173/?agent=true`, with demo audio unless the change is about another input.
1. **Boot**: open `/`. The workspace, launch controls and preset browser render.
2. **Demo audio**: start demo audio. The visuals respond without a reload and the address stays on `/`.
3. **Preset link**: open `/?preset=rovastar-parallel-universe&audio=demo`. That preset, not a default, is the one playing.
4. **Old alias**: open `/milkdrop/?preset=eos-glowsticks-v2-03-music&audio=demo`. It redirects to `/` with the same preset and audio.
5. **Play → Edit → Share**: open the editor, apply a visible change, share, and open the link in a fresh tab. The source and the visible effect both arrive. Undo the edit, then restore an earlier version from the editor's History tab.
6. **Settings**: while a preset plays, switch the quality preset to Battery saver, then to Hi-fi visuals. The picture changes and audio keeps playing without a reload. Reload and confirm the choice persisted.
7. **Keyboard and narrow screens**: Tab through the controls, close panels with Esc, and open the shortcut list with `?`. Repeat steps 1–5 at phone width and check the stage and controls for overflow.
8. **Renderer**: if the change touches renderer selection or fallback, repeat steps 1–3 with `?renderer=webgl` and in a browser that runs WebGPU.
9. **Stop**: choose "Stop audio and go back to start" from the dock's audio menu. The start page returns and nothing keeps playing.

## Before a release

Repeat steps 1–5 on the production build (`bun run build`, then `bun run preview` at `http://localhost:4173/`) and on the branch's Workers Builds preview URL, which also checks CDN caching and hashed asset paths. Use one real input there, a microphone or tab capture, to exercise permissions.

## Record the run

Put this in the PR description:

```md
Manual QA
- Date / commit:
- Browser, OS, backend (WebGPU or WebGL):
- Steps run, with pass/fail notes:
- Steps skipped, and why:
```

A skipped step is unverified, not passed.

## Recorded runs

### 2026-10-27: shared remix flow ([#1408](https://github.com/zz-plant/stims/issues/1408))

Step 5 on Krash & Rovastar "Cerebral Demons (Stars Remix)" (`krash-rovastar-cerebral-demons-stars`), as [discussion #1341](https://github.com/zz-plant/stims/discussions/1341) reported it: Play demo, Edit, Add a slow spin, Undo example, add it again, close the editor, copy the share link, open it in a fresh browser context, reload, then select the preset again. Production served `bfc3dceef`, the commit Workers Builds deployed that day; local ran the same commit on `bun run dev`. Host: macOS 27, Apple M1 Max, Playwright 1.64.1, 1280x720 at DPR 1, `?agent=true` unless noted. The script and its screenshots and reports stayed in the gitignored `scratch/1408/`.

A row passes when the cold open and the reload both restore the preset id and the full edited source (hash `13e5103182be21bd`), per-frame `rot` reads 0.12, demo audio is live, the requested backend runs, and there are no page errors or compiler diagnostics; Undo example restores the source and `rot` 0.1. The stage column is the screenshot's mean RGB over the stage a few seconds after the editor closed, with the flash governor's lowest and median brightness over the next six seconds.

| Browser | Backend | Production | Local | Stage after closing the editor (prod / local) | Governor min / median (prod / local) |
| --- | --- | --- | --- | --- | --- |
| Chromium 156.0.8078.4 | WebGL (ANGLE Metal) | pass | pass | 19,11,2 / 22,13,2 | 0.10, 0.21 / 0.10, 0.50 |
| Chromium 156.0.8078.4 | WebGPU (metal-3) | pass; the cold open waited for a Play demo click | pass | 21,13,2 / 44,28,4 | 0.10, 0.71 / 0.10, 0.30 |
| Chromium, without `?agent=true` | WebGL | pass | not run | 23,8,2 | 0.10, 0.21 |
| WebKit 27.2 | WebGL | pass | pass | 15,9,2 / 18,9,2 | 0.07, 0.26 / 0.09, 0.30 |
| WebKit 27.2 | WebGPU | pass | pass | 17,10,2 / 39,30,4 | 0.11, 0.28 / 0.10, 0.31 |
| Firefox (Playwright build 1555) | both | untested | untested | Playwright's Firefox did not launch on this host: its content process was killed (signal 9) headed and headless | — |
| Safari, Codex in-app browser | — | untested | untested | WebKit above is Playwright's build, not Safari | — |

What the run established:

- **The black stage reproduces on screen in every browser and backend above, and the flash governor makes it.** The canvas never went dark: its own mean luma (`captureStats`, which does not see CSS filters) stayed between 25 and 157 of 255 across about 2,000 samples. Reduce flashing, on by default, dimmed the stage with `brightness()` down to 0.06–0.1, and this preset is dark enough that the result reads as black while the dock still shows Demo. With Reduce flashing saved off, the same flow left the stage at 133,77,15 in Chromium and 132,44,10 in WebKit after the editor closed.
- **The preset strobes.** The catalog measures it `flashRiskLevel: high`, 38 transitions a second: `sx=flip` mirrors the picture every frame. Over 20-second samples the visible stage sat under 8/255 for 12–27% of the time, with and without the spin, at 120, 60 and 30 Hz.
- **Closing the editor is the darkest moment.** While the editor is open the drawing buffer is 1214x691; closing it restores 1265x720, the feedback restarts, the canvas luma halves for a few frames, and the governor clamped to about 0.1 in 3 of 3 probes. Pressing Add a slow spin did not deepen the clamp.
- **Add a slow spin changes nothing on this preset.** `per_pixel_11` assigns `rot` without reading it, so the per-frame `rot=rot+0.02` never reaches the warp; a 120-frame VM replay draws the same warp mesh for the original and the edit. A text scan finds the same per-pixel overwrite in 309 of 1,787 bundled presets.
- Selecting the preset again after the edit loads the saved draft ("with your saved edits"); Revert in the editor restores the original.

No renderer or compiler change followed: nothing in either produced the dark frames, and `bun run lab:backend-diff -- --preset krash-rovastar-cerebral-demons-stars` rated WebGL and WebGPU a match within noise. How far the governor may dim, whether a preset measured high should be featured, and whether a resize restart should count as a flash are product decisions left on #1408.
