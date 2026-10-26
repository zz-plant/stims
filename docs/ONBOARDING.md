# Contributor onboarding

Start with [setup](../CONTRIBUTING.md#set-up) and a running session at `http://localhost:5173/?agent=true`. Play a preset, edit a parameter, and reopen a shared link before changing the workflow. Use [development](./DEVELOPMENT.md) for commands and [testing](./TESTING.md) to choose verification.

## Find the owner

| Area                                    | Location                            | First contribution                                                     |
| --------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| Workspace, panels, and URL state        | `src/js/frontend/`                  | A focused interaction or copy change with a browser check              |
| Runtime adapter                         | `src/js/frontend/engine/`           | Follow a shell action through the adapter before changing its contract |
| Audio, capabilities, settings, services | `src/js/core/`                      | Test local logic, then exercise the real input or browser API          |
| Preset lifecycle and renderers          | `src/js/milkdrop/`                  | Reproduce one preset through startup, frame execution, and shutdown    |
| Compiler, parser, interpreter, and JIT  | `packages/milkdrop-toolchain/`      | Capture the expected semantics and add a focused behavioral contract   |
| DSP, flash analysis, EEL cases          | `packages/`                         | Run the package's own suite and its app integration checks             |
| Preset authoring                        | [Curriculum](./authoring/README.md) | Apply a runnable example and compare the resulting motion              |
| Verification instruments                | `scripts/`                          | `bun run help --for "<symptom>"`                                       |

The [source map](./agents/src-map.md) explains ownership in more detail. The frontend owns React state and navigation; the runtime owns the imperative stage. The adapter owns runtime lifecycle crossing, while approved public modules expose editor and catalog helpers. The architecture guard enforces that distinction.

## Learn the difficult boundaries

### EEL and shader semantics

A `.milk` file combines parameters, EEL equations, and sometimes HLSL-flavored shaders. The toolchain parses those into structured representations and supports interpretation, JIT execution, GLSL shader emission, and EEL-to-WGSL lowering. These paths have distinct support limits; accepting source does not prove identical output across them.

Read [runtime contracts](./MILKDROP_PRESET_RUNTIME.md) and the toolchain README before editing execution. Use the tier differential tests to compare interpreter/JIT and CPU/GPU semantics. For native-renderer compatibility, obtain a reference capture with known inputs before deciding which result is correct. A focused unit test can preserve an established answer, but it cannot discover native behavior by itself.

### Rendering and lifecycle

WebGL is the baseline; WebGPU has separate materials, batching, and fallback behavior. A change can preserve compilation while changing pixels. Check both paths when changing feedback, blend order, shader lowering, or geometry. Read [architecture](./ARCHITECTURE.md), then follow one source from parser to VM, frame loop, and renderer adapter.

For capability and render-scale work, the [fallback study](./archive/fallback-state-machine.md) supplies design context; the current code and tests define implemented behavior. Exercise startup failure and teardown as well as steady-state frames.

### Audio and measurement

AudioWorklet analysis feeds signals into the preset runtime. Mocked audio proves control logic, not microphone permissions, capture routing, or timing on a device. Keep source, sample rate, smoothing, and capture timing controlled when comparing reactivity.

## Pick an instrument

Run `bun run scripts:list` for descriptions derived from source docblocks. Use `bun run help --for "my preset looks wrong"` or a similar symptom to find an instrument.

| Question                                     | Instrument                                    |
| -------------------------------------------- | --------------------------------------------- |
| Which signals can reach an output?           | `bun run lab:dataflow -- --preset <id>`       |
| Does numeric output react to audio?          | `bun run lab:reactivity`                      |
| Does rendered output react?                  | `bun run lab:visual`                          |
| Did VM semantics change?                     | `bun run lab:replay`                          |
| Do rendered backends agree?                  | `bun run lab:backend-diff`                    |
| Do VM execution tiers agree?                 | `bun run lab:gpu-differential`                |
| Does output match a reference capture?       | `bun run parity:diff`, `bun run parity:suite` |
| Which presets render blank or frozen?        | `bun run sweep:milkdrop-loops`                |
| What is the measured frame cost?             | `bun run perf:certification-corpus`           |
| What flashing is detected in sampled frames? | `bun run lab:flash-audit`                     |

Flash analysis is bounded by sampled output and the instrument's thresholds; it does not diagnose a viewer or certify universal safety. See [sensory research](./SENSORY_ACCESSIBILITY.md).

## A practical contribution sequence

1. Make one small workspace change and run `bun run check:quick` early.
2. Use [guardrails](./GUARDRAILS.md) to understand a failed check rather than bypassing it.
3. Follow one shell action into the adapter and runtime. Keep state and teardown ownership explicit.
4. Run the relevant browser flow, including keyboard and a narrow viewport for UI changes.
5. Before compiler or renderer work, complete a controlled capture-and-diff cycle. Preserve provenance and distinguish target membership, reference availability, and measured results.
6. Finish with the required gate, then report precisely which checks ran, skipped, or failed.

The [QA plan](./QA_PLAN.md) covers user-flow sign-off. The [roadmap](./ROADMAP.md) and [implementation status](./IMPLEMENTATION_STATUS.md) separate current capabilities from proposed work.
