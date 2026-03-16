---
description: Launch a toy in a real browser and verify its runtime behavior
---

# Play a Toy

## 1. Choose the path

For a quick scripted smoke run:

```bash
bun run play:toy <slug>
```

For a manual inspection session:

```bash
bun run dev
```

Open:

```text
http://localhost:5173/toy.html?toy=<slug>&agent=true
```

## 2. Start the toy

1. Let the shell load.
2. Choose demo audio when the toy supports it and you want repeatable input.
3. Use microphone input only when the task specifically needs live audio behavior.

## 3. Observe

Check:

- toy loads without obvious errors,
- audio start path works,
- visuals react after audio starts,
- back-to-library flow still works.

## 4. Capture evidence when useful

Take screenshots only if they help explain a visual regression, UX issue, or before/after change.

## 5. Agent-mode helpers

`?agent=true` enables stateful hooks for automation and debugging. Use it when you need deterministic toy-load or audio-active checks.
