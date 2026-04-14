---
description: Launch the flagship visualizer in a real browser and verify runtime behavior
---

# Play the visualizer

## 1. Choose the path

For a quick scripted smoke run:

```bash
bun run play:toy milkdrop
```

For a manual inspection session:

```bash
bun run dev
```

Open:

```text
http://localhost:5173/?agent=true
```

## 2. Start playback

1. Let the shell finish loading.
2. Choose demo audio for repeatable checks unless live input is required.
3. Start a preset and keep the affected UI surface visible.

## 3. Observe

Check:

- shell loads without obvious errors
- audio start path works
- preset playback reacts visually
- changed controls or browser flows still work
- navigation and cleanup remain stable

## 4. Capture evidence when useful

Take screenshots only when they help explain a visual regression, UX issue, or before/after change.

## 5. Agent-mode helpers

`?agent=true` enables stateful hooks for automation and debugging. Use it when you need deterministic load or audio-active checks.
