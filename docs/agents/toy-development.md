# Toy Development (Agent Quick Reference)

## Core locations

- Toy modules: `assets/js/toys/`.
- Toy registry metadata: `assets/data/toys.json`.
- Legacy page-backed embed targets: `toys/`.
- Loader shell: `toy.html` + `assets/js/loader.ts`.
- Runtime/audio helpers: `assets/js/core/toy-runtime.ts`, `assets/js/utils/start-audio.ts`.

## Expected patterns

- Toy modules export `start(...)` and return a disposable cleanup handle.
- Canvas-heavy toys should prefer shared runtime scaffolding (`createToyRuntime(...)`) over bespoke setup.
- MilkDrop preset aliases should use `createMilkdropPresetToyStarter(...)` instead of re-implementing a scene.
- Behavior-backed MilkDrop aliases should keep interaction metadata in `assets/js/toys/milkdrop-behaviors/metadata.ts`; `bun run generate:toys` syncs that metadata back into `assets/data/toys.json`.
- Page-backed toys should use `startPageToy(...)` only when a legacy HTML implementation still needs to be embedded behind the `toy.html` shell.
- Audio-reactive toys should integrate with shared audio helpers and support demo-audio fallback when applicable.

## Change checklist for toy edits

1. Update module in `assets/js/toys/`.
2. Ensure `assets/data/toys.json` metadata matches slug/capabilities, or update `assets/js/toys/milkdrop-behaviors/metadata.ts` first if the toy is a behavior-backed MilkDrop alias.
3. Add/update a legacy embed page in `toys/` only if the toy still relies on `startPageToy(...)`.
4. Update tests for new behavior.
5. Run `bun run generate:toys` when metadata changes, then run `bun run check:toys` to validate schema, behavior-metadata parity, slug/entrypoint consistency, and generated artifact parity.
