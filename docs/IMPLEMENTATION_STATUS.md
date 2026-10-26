# Implementation status

Current capabilities are mapped to their implementation below. Source availability establishes an implemented path; it does not establish support on every browser, device, preset, or deployment. Run the relevant checks in [Testing](./TESTING.md) before making a release claim.

## Available in the app

| Capability                               | Implementation                                                                | Scope                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One workspace for play, browse, and edit | `src/js/frontend/App.tsx`, `src/js/frontend/url-state.ts`                     | `/` is canonical; `/milkdrop/` redirects with query and hash                                                                                                                              |
| Catalog discovery and preset selection   | `public/milkdrop-presets/catalog.json`, `src/js/milkdrop/catalog-store.ts`    | Search and collection browsing; catalog membership is not visual certification                                                                                                            |
| Live source editing and diagnostics      | `src/js/milkdrop/overlay/editor-panel.ts`                                     | Tune, source, shader, compatibility, and version tools depend on the loaded source                                                                                                        |
| Remix links and file import/export       | `src/js/frontend/url-state.ts`, `src/js/milkdrop/overlay/`                    | URL source has a size limit; local drafts are browser storage                                                                                                                             |
| Shared audio analysis                    | `src/js/core/audio-handler.ts`, `packages/audio-reactive/`                    | Demo, mic, local file, and supported capture sources; permission and browser limits apply                                                                                                 |
| Quality, motion, and flashing controls   | `src/js/core/state/`, `src/js/core/services/flash-safety.ts`                  | Controls reduce or tune output; they do not certify universal safety                                                                                                                      |
| MIDI mapping and automation              | `src/js/core/services/webmidi-controller.ts`, `scripts/mcp-server.ts`         | Persistent local mappings and reconnect handling; hardware support needs device verification                                                                                              |
| WebGPU and WebGL rendering               | `src/js/milkdrop/renderer-adapter.ts`, `src/js/core/renderer-capabilities.ts` | WebGPU where the browser ships it as stable, WebGL2 elsewhere ([selection rule](./ARCHITECTURE.md#rendering-backends)). Measured fidelity evidence exists for WebGPU only; WebGL has none |
| Preset frame-cost gating                 | `src/js/core/preset-cost-signal.ts`, `src/data/preset-frame-cost.json`        | Recorded hardware measurements inform low-tier autoplay and shuffle; unmeasured presets remain eligible, and the measurements are not a performance guarantee on every device             |
| Standalone libraries                     | [Packages](../packages/README.md)                                             | Workspace source, tests, builds, and demos; registry publication is a separate release step                                                                                               |

## Beta and deployment-dependent paths

- **Canvas video recording:** resolution choices and audio-track composition exist. Encoded resolution, synchronization, sustained frame pacing, and browser support need recorded-file evidence. See [OBS](./OBS.md) and [recording validation issue #1409](https://github.com/zz-plant/stims/issues/1409).
- **AI generation and refinement:** hosted Worker endpoints need configured bindings; local and OpenRouter providers need explicit setup. Generated source still needs compile and visual review. See [API](./api.md).
- **Semantic search and community services:** availability depends on hosted indexes, storage, and deployment configuration. Local catalog browsing and editing do not depend on them.
- **Visual fidelity:** certification targets, reference artifacts, and measured results are tracked separately in `src/data/milkdrop-parity/`. Dated scoreboards and historical pass labels do not replace a current controlled comparison.

## Not shipped

Stem-separation signal identifiers are reserved; no separation model supplies them. A unified composite shader IR is proposed work. Neither should be described as shipped functionality.

## Maintain this map

Update capabilities and limits when implementation changes; put priorities in the [roadmap](./ROADMAP.md) and executable follow-up in issues. The previous dated milestone checklist is preserved as a [historical snapshot](./archive/IMPLEMENTATION_STATUS_2026-10-10.md).
