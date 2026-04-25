# Verification Matrix

This page collects the short-form guidance for renderer support and test
selection. Keep it aligned with `ARCHITECTURE.md` and `DEVELOPMENT.md` when
those workflows change.

## Rendering support

| Path | Use for | Notes |
| --- | --- | --- |
| `Three.js` / imperative MilkDrop runtime | The actual visualizer engine, preset compilation/execution, renderer backends, audio response, and overlay/editor composition. | This is the product-critical path under `assets/js/milkdrop/*` and `assets/js/core/*`. |
| React Three Fiber scene layer | Small React-managed scene pieces used by the workspace shell for decorative or staging visuals. | Keep this layer small and isolated; it should not become a second visualizer runtime. |
| WebGL | Baseline rendering path. | Use this as the default compatibility target for visual verification. |
| WebGPU | Optional enhancement path. | Treat it as an additive path that must not break WebGL behavior. |

## Verification by layer

| Layer | Primary command | When to use |
| --- | --- | --- |
| Unit / logic | `bun run test` or `bun run test tests/path/to/spec.test.ts` | Pure function coverage, state transitions, and non-browser behavior. |
| DOM-sim / environment | `bun run test` | Loader, shell, and environment behavior that can run in `happy-dom` or similar simulated DOM tests. |
| Browser integration | `bun run test:integration` | Real page, router, audio, and renderer behavior that needs a browser. |
| Compatibility / preset parity | `bun run test:compat` or `bun run test:legacy-frontend` | Legacy shell coverage, preset compatibility, and renderer parity paths. |
| Visual/parity proof | `bun run dev` plus the parity capture commands in `DEVELOPMENT.md` | Manual browser confirmation and reference capture for visual regressions. |

## Default rule

If a change touches the runtime, renderer, audio, shell, or route behavior,
validate it in a browser. If it only changes pure logic, keep the first pass
to the narrowest test file or `bun run test`.
