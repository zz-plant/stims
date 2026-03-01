# Toy Development (Agent Quick Reference)

## Core locations

- Toy modules: `assets/js/toys/`.
- Toy registry metadata: `assets/data/toys.json`.
- Page-backed toy entry points: `toys/`.
- Loader shell: `toy.html` + `assets/js/loader.ts`.
- Runtime/audio helpers: `assets/js/core/toy-runtime.ts`, `assets/js/utils/start-audio.ts`.

## Expected patterns

- Toy modules export `start(...)` and return a disposable cleanup handle.
- Canvas-heavy toys should prefer shared runtime scaffolding (`createToyRuntime(...)`) over bespoke setup.
- Page-backed toys should use `startPageToy(...)` so launch panel behavior remains consistent.
- Audio-reactive toys should integrate with shared audio helpers and support demo-audio fallback when applicable.

## Change checklist for toy edits

1. Update module in `assets/js/toys/`.
2. Ensure `assets/data/toys.json` metadata (authoritative source) matches slug/capabilities.
3. Add/update standalone page in `toys/` if page-backed.
4. Update tests for new behavior.
5. Run `bun run generate:toys` when metadata changes, then run `bun run check:toys` to validate schema, slug/entrypoint consistency, and generated artifact parity.
