# Reference Documentation

## Core reference docs

- `docs/TOY_DEVELOPMENT.md` - Full toy development playbook.
- `docs/TOY_TESTING_SPEC.md` - Automated testing specification.
- `docs/ARCHITECTURE.md` - System architecture overview.

## High-signal code locations

- `assets/js/toys/` - TypeScript toy modules (library-loaded toys).
- `assets/js/toys-data.js` - Toy registry metadata (slugs, labels, caps).
- `assets/js/loader.ts` - Toy loader for `toy.html` (routes, query params).
- `assets/js/core/toy-runtime.ts` - Runtime scaffolding (audio + render loop).
- `assets/js/utils/start-audio.ts` - Audio unlock + demo audio controls.
- `toys/` - Standalone HTML toys (page-based).
- `public/` - Static assets served as-is.

## Config + project entry points

- `vite.config.js` - Build + dev server config.
- `package.json` - Scripts and Bun package manager config.
- `index.html` / `toy.html` - Entry points for the library and toy runner.

## Fast triage checklist

1. **Toy missing from UI?** Confirm it exists in `assets/js/toys-data.js`.
2. **Toy fails to load?** Check query params handling in `assets/js/loader.ts`.
3. **Audio not reactive?** Validate `startAudio` usage and runtime setup in
   `assets/js/core/toy-runtime.ts` and `assets/js/utils/start-audio.ts`.
