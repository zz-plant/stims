---
name: create-toy
description: "Scaffold and register new toys in the Stim Webtoys Library. Use when asked to create a new toy module, add a toy entry, or set up a toy's files and registration."
---

# Create a new toy

## Quick scaffold

Use the scaffold script for the standard module layout:

```bash
bun run scripts/scaffold-toy.ts --slug <slug> --title "<Title>" --type module --with-test
```

## Register the toy

Add the toy metadata entry in `assets/data/toys.json` and point `module` to the new TypeScript file.

## Verify

```bash
bun run check:toys
```

## Manual creation (when scaffolding is not enough)

1. Create `assets/js/toys/<slug>.ts` and export `start({ container })`.
2. Add cleanup logic (remove canvas, cancel animation frame).
3. Register audio handlers with `registerToyGlobals`.
4. Add the toy entry in `assets/data/toys.json`.

## Local validation

```bash
bun run dev
```

Open `http://localhost:5173/toy.html?toy=<slug>` and confirm the toy loads.
