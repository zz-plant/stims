---
name: play-visualizer
description: "Launch and inspect the flagship visualizer in a real browser. Use when reproducing runtime behavior manually, checking audio-reactive playback, or capturing visual evidence from the canonical workspace route."
---

# Play the visualizer locally

Use this skill for real-browser verification of the main visualizer product.

## No browser, or no GPU?

This skill assumes a GUI browser and eyes on the screen. If you're in a
headless/cloud sandbox instead:

| Your environment | Use this instead |
| --- | --- |
| No browser at all | `bun run lab:reactivity -- --preset <id>` — drives the MilkDrop VM directly, numeric verdicts, no browser |
| Headless browser, no confirmed GPU | `bun run ctl -- --preset <id> --screenshot out.png` or `bun run mcp` (`session_describe_frame`) — both default to software rendering (SwiftShader) for exactly this case; see [`../../docs/agents/visual-testing.md`](../../docs/agents/visual-testing.md#cloud-sandboxed-agents-without-a-gpu) |
| Headless browser + vision, need pixel fidelity | `bun run lab:visual -- --preset <id>` |

## Fastest path

For scripted smoke coverage:

```bash
bun run play:toy milkdrop
```

## Manual path

Start the dev server:

```bash
bun run dev
```

Open:

```text
http://localhost:5173/?agent=true
```

## What to verify

- the shell loads without obvious runtime or console failure
- audio entry works through the intended path
- a preset starts and reacts visually after audio begins
- preset browsing or shell controls still work when relevant
- navigation and teardown remain stable

## Notes

- Prefer demo audio for repeatable checks unless live input is the point of the task.
- Use screenshots only when they add evidence for a visual or UX change.
- If the goal is broader regression coverage, switch to `test-visualizer` or `ship-visualizer-change`.
