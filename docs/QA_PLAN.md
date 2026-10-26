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
