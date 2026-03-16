---
name: play-toy
description: "Launch and inspect a toy in the browser. Use when asked to run a toy locally, reproduce toy behavior manually, capture toy screenshots, or verify real browser behavior."
---

# Play a toy locally

Use this skill for real-browser inspection, not for broad repo validation.

## Fastest path

If you only need a scripted smoke run:

```bash
bun run play:toy <slug>
```

## Manual path

Start the dev server:

```bash
bun run dev
```

Open:

```text
http://localhost:5173/toy.html?toy=<slug>&agent=true
```

## What to verify

- The toy loads without obvious console/runtime failure.
- Demo audio or microphone entry works when applicable.
- The toy reacts visually after audio starts.
- Back-to-library and cleanup behavior still work.

## Notes

- Prefer demo audio for repeatable manual checks when the toy supports it.
- Use screenshots only when they add evidence for a visual or UX change.
- If the goal is broader regression coverage, switch to the `test-toy` or `ship-toy-change` capability.
