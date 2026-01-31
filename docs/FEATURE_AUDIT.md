# Feature audit vs docs

This audit maps product features to their current documentation so we can spot gaps and keep references aligned with the live experience.

## How to use this audit

1. **Pick the feature you are changing** and confirm the primary docs below already describe it.
2. **Update the docs** listed in the coverage map when behavior, UX copy, or data contracts change.
3. **Note gaps** in the follow-ups section so future work tracks missing guidance.
4. **Refresh cross-links** in `docs/README.md` if a new guide is introduced.

## Coverage map

| Feature area | Primary docs | Notes |
| --- | --- | --- |
| Library landing page layout, hero, and feature bands | [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md) | Page-level expectations live here, including accessibility notes. |
| Library discovery, search, and empty states | [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md), [`USABILITY_AUDIT.md`](./USABILITY_AUDIT.md) | The audit captures UX issues that are still open. |
| Toy catalog metadata and registry | [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md), [`TOY_SCRIPT_INDEX.md`](./TOY_SCRIPT_INDEX.md), [`DEVELOPMENT.md`](./DEVELOPMENT.md) | Registry guidance and required fields are documented. |
| Toy loader flow + runtime composition | [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Includes loader steps, services, and lifecycle cleanup. |
| Audio input flows (mic, demo, YouTube) | [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md), [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md), [`QA_PLAN.md`](./QA_PLAN.md) | UI spec + implementation guidance + QA coverage. |
| Renderer and WebGPU fallback | [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md) | Rendering capabilities and preflight are documented. |
| Quality controls and presets | [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md), [`DEVELOPMENT.md`](./DEVELOPMENT.md), [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md) | UI specs, default preset values, and custom preset authoring guidance are documented. |
| Settings panel behavior | [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md) | Runtime wiring and UI expectations are covered. |
| Testing & QA expectations | [`QA_PLAN.md`](./QA_PLAN.md), [`TOY_TESTING_SPEC.md`](./TOY_TESTING_SPEC.md) | Includes automation and toy-specific testing patterns. |
| User critiques and assessment findings | [`stim-user-critiques.md`](./stim-user-critiques.md), [`stim-assessment.md`](./stim-assessment.md) | Use these to validate UX intent against feedback. |
| Deployment & hosting | [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Covers Vite builds and Cloudflare worker setup. |
| MCP server + external tooling | [`MCP_SERVER.md`](./MCP_SERVER.md) | Documents the stdio server and tools. |

## Gaps & follow-ups

1. **Library badges for mic/motion requirements** — Documented for the primary JS grid in `PAGE_SPECIFICATIONS.md`. ✅
2. **Quality preset semantics** — Documented in `TOY_DEVELOPMENT.md` with preset mapping guidance for toy authors. ✅
3. **Feature discovery copy** — Search copy and filter behavior are now documented together in `PAGE_SPECIFICATIONS.md`, and the usability audit reflects the current haystack behavior. Keep them in sync when the filter logic changes. ✅
4. **Settings panel extension points** — Documented in `TOY_DEVELOPMENT.md` with a toy-facing checklist. ✅

## Prioritized to-do list

1. **Document library capability badges in the primary JS grid** — Completed in `PAGE_SPECIFICATIONS.md`. ✅
2. **Define quality preset guidance for toy authors** — Completed in `TOY_DEVELOPMENT.md`. ✅
3. **Add a settings panel checklist for toys** — Completed in `TOY_DEVELOPMENT.md`. ✅
4. **Reconcile search copy with filtering behavior** — Documented in `PAGE_SPECIFICATIONS.md` and reflected in `USABILITY_AUDIT.md`. ✅
