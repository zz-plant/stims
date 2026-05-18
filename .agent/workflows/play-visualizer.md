# Play visualizer workflow

Use this runbook when you need real-browser evidence for the flagship visualizer.

## 1. Start with the scripted smoke path

```bash
bun run play:toy milkdrop
```

Use this for a quick launch, render, and capture check.

## 2. Run a manual session when interaction matters

```bash
bun run dev
```

Open:

```text
http://localhost:5173/?agent=true
```

## 3. Inspect the product behavior

- the shell loads without visible runtime failure
- audio entry works through the intended path
- a preset starts and reacts visually
- changed controls, preset transitions, or editor flows work when relevant
- navigation and teardown remain stable

## 4. Capture evidence only when useful

Use screenshots or trace output when they prove a visual change, a regression fix, or a browser-only behavior.
