# EEL guest memory: one model for every execution tier

Status: compute-VM increment landing 2026-08-18/19; field-path increment designed, not yet implemented.
Part of the EEL consolidation program (presets = ROM corpus, EEL = guest ISA); sibling of the
platform-profile spec (`tests/unit/eel-conformance-spec.test.ts`) and the declarative op table
(`src/js/milkdrop/compiler/eel-function-table.ts`).

## The model

EEL "guest memory" is everything a program can address beyond scalar locals:

| Region | Backing store (canonical) | Size | Lifetime / sharing |
| --- | --- | --- | --- |
| `megabuf(i)` | `MilkdropVm.megabuf: Float32Array` (vm.ts) | `MILKDROP_MEGABUF_SIZE` = 1,048,576 f32 (4 MiB) | Per VM; zeroed on every preset `reset()` |
| `gmegabuf(i)` | module-level `sharedGlobalBuffer` (vm.ts) | `MILKDROP_GMEGABUF_SIZE` = 1,048,576 f32 | One per process, lazily allocated, **never** reset — shared across presets, matching MilkDrop |
| `q1..q32` | `MilkdropVm.registers` (prototype-chains to `state`) | 32 scalars | Reset per preset; per-frame → per-pixel/per-wave bus |
| `t1..t8` | `registers` / per-wave `locals` | 8 scalars | Per-wave working set |
| per-frame user vars (incl. `regNN`-style names) | `MilkdropVm.state` | unbounded map | Persist across frames |

Access semantics (the platform profile; identical on every tier):

- Index: `Math.trunc` (`milkdropTruncInt` in WGSL — non-finite → 0 via its finite guard, but a
  NaN/±Inf index must miss the bounds check like the CPU, see "index guard" below).
- Bounds: half-open `[0, size)`. Out-of-range read → `0`; out-of-range write → dropped.
- Stored values are finite-clamped (`Number.isFinite(v) ? v : 0` / `milkdropFinite`).
- f32 vs f64 index precision: CPU computes indices in f64; GPU tiers in f32 (exact integers only
  up to 2^24, which covers both 1M-entry buffers with ~16x headroom).

The CPU Float32Arrays are the **canonical copy**. Every other representation (GPU storage
buffers) is a mirror that must be re-synchronized at defined points. This is forced by the
frame structure: `per_frame` may run on the GPU compute VM while `per_pixel`, custom waves and
shapes still run on the CPU JIT *in the same frame*, and all of them share megabuf.

## Tier-by-tier implementation

### Interpreter and CSP fallback
`expression.ts` owns no storage; reads/writes go through injected helpers
(`MilkdropExpressionHelpers.megabuf/gmegabuf/megabufWrite/gmegabufWrite`). The VM provides
helpers closing over the same Float32Arrays the JIT receives.

### CPU JIT
`expression-jit.ts` — compiled programs receive `(env, state, registers, locals, megabuf,
gmegabuf, nextRandom)`; `compileBufferRead`/`compileStore` inline the trunc/bounds/clamp
semantics. This tier defines the reference behavior for buffers (the interpreter's conformance
spec currently stubs the helpers).

### GPU compute VM (per-frame programs) — landed by this increment
`compiler/wgsl-generator.ts` + `vm-gpu.ts`:

- Bind group 0 grows two conditional bindings:
  - `@binding(2) var<storage, read_write> megabuf: array<f32, 1048576>` when the program
    touches megabuf;
  - `@binding(3) var<storage, read_write> gmegabuf: array<f32, 1048576>` when it touches
    gmegabuf.
  (`@binding(0)` state struct and `@binding(1)` signals are unchanged. The pipeline layout is
  explicit; `layout: 'auto'` prunes bindings unreachable from the entry point and silently
  breaks the dispatch — same trap the gpu-differential harness documents.)
- Reads compile to `milkdropMegabufRead(index)` / `milkdropGmegabufRead(index)`; statement
  targets `megabuf(expr) = v` compile to `milkdropMegabufWrite(index, value)`. The helpers are
  emitted by the generator (not `wgsl-eel-helpers.ts`, because they reference module-scope
  storage variables the field emitter cannot declare) and implement exactly the CPU semantics:

  ```wgsl
  fn milkdropMegabufRead(index: f32) -> f32 {
    // Index guard: NaN must MISS the bounds check (CPU: Math.trunc(NaN) is NaN,
    // NaN >= 0 is false) — milkdropTruncInt alone would collapse NaN to slot 0.
    let finite = index == index && abs(index) < 3.402823e38;
    let i = milkdropTruncInt(index);
    if (finite && i >= 0 && i < 1048576) { return megabuf[u32(i)]; }
    return 0.0f;
  }
  fn milkdropMegabufWrite(index: f32, value: f32) {
    let finite = index == index && abs(index) < 3.402823e38;
    let i = milkdropTruncInt(index);
    if (finite && i >= 0 && i < 1048576) { megabuf[u32(i)] = milkdropFinite(value); }
  }
  ```
- Buffer-using programs are now `gpuExecutable: true`; `WgslProgramCompilation` grows
  `writesMegabuf`/`writesGmegabuf` so the executor can skip readback for read-only programs.
- Coherency protocol in `vm-gpu.ts` (`createGpuVmRunner`):
  1. `init(..., guestMemory)` receives the VM's Float32Arrays, allocates the storage buffers
     (+ COPY_DST|MAP_READ readback staging buffers), uploads initial contents.
  2. `syncState()` (called before each dispatch, per MilkDrop reload semantics) re-uploads the
     CPU mirrors — CPU-tier programs may have written them since the last dispatch.
  3. `dispatch()` appends storage→staging copies to the same command submission, then maps the
     staging buffers and copies GPU writes back into the CPU arrays. The CPU copy is canonical
     again before any CPU-tier program runs.

  Cost note: this is up to 4 MiB up + 4 MiB down per buffer per frame, paid only by presets
  that actually use the buffers. The optimization path (dirty-range tracking, or leaving the
  buffer GPU-resident when no CPU-tier block references it — statically knowable from the
  compiled IR) is deliberately deferred until profiles show it matters.

### GPU field path (per-pixel/per-point programs) — next increment
`compiler/gpu-field-planner.ts` + `renderer-backends/webgpu-procedural-materials.ts` today pack
per-frame register inputs positionally into `registersA..H` vec4 uniforms (32-scalar cap) and
bail lowering entirely on `megabuf`/`gmegabuf`/unknown reads. Per the GPU-lowering census, the
remaining non-lowerable per-pixel presets are mostly per-frame user-variable readers plus
gmegabuf/randint users (61 of 1,619).

Planned shape:

1. **Register bus → storage buffer.** Replace the positional vec4 packing with a single
   `array<f32>` storage binding holding the register file: q1..q32, then the program's
   per-frame-assigned user variables in `registerInputs` sort order. The planner's
   `MAX_FIELD_REGISTER_INPUTS = 32` cap disappears (the census shows q33+ never exists, but
   user-variable inputs regularly blow the 32 cap once generalized). The slot map is part of
   the lowered program descriptor; `syncProceduralFieldUniforms` writes a Float32Array once per
   frame instead of 32 uniform slots.
2. **Buffer reads.** The same storage-binding mechanism then carries megabuf/gmegabuf
   (read-only in the field stages: per-pixel writes to megabuf are per-vertex-local on the CPU
   tier only in theory — in practice per_pixel megabuf *writes* do persist on CPU, so
   write-bearing per-pixel programs stay CPU-lowered until we accept the divergence or add
   atomics; reads are the census blocker and are safe).
3. Three.js TSL constraint: the field emitters are `wgslFn` value-parameter functions with no
   binding declarations. The storage binding has to come in as a TSL `storage()` node passed
   through the material, or the transform function has to be generated as a raw WGSL compute
   pass. Decision deferred to the increment itself; the register-bus slot map is designed to be
   emitter-agnostic.

## Invariants (enforced by tests)

- `tests/unit/eel-conformance-spec.test.ts` — scalar platform profile (buffer semantics to be
  added there as the interpreter helpers stop being stubs).
- `tests/unit/eel-csp-fallback.test.ts` — JIT vs interpreter buffer parity.
- `tests/unit/wgsl-generator.test.ts` — buffer programs emit bindings/helpers and are
  `gpuExecutable`.
- `tests/unit/milkdrop-vm-gpu.test.ts` — runner allocates/binds/reads back guest memory.
- `bun run lab:gpu-differential` — real-GPU differential incl. buffer programs (final buffer
  contents diffed against the CPU JIT, not just VmState).
- `tests/unit/vm-golden-traces.test.ts` — `alien-fish-pond` is the megabuf witness preset.

## Bug found and fixed while landing this increment

Verifying the compute VM's per-frame dispatch end-to-end (via `lab:replay --tier gpu` on
`martin-the-bridge-of-khazad-dum`, which uses `megabuf`) surfaced a correctness bug unrelated to
guest memory itself but blocking its validation: **signal-named variable reassignment**.

MilkDrop presets commonly reuse a signal name as an ordinary variable, e.g. `vol = (bass + mid +
treb) / 1.5; vol_ = vol_ * dec + (1 - dec) * vol;`. On the CPU tiers, every statement mirrors its
result into the env object (`e[target] = _v` in `expression-jit.ts`), so once `vol` is assigned,
every later read in the same frame sees the computed value — the assignment becomes an own
property that shadows the signal in the prototype chain. The WGSL generator had no equivalent:
`vol` always compiled to `signals.vol`, unconditionally, so a per-frame program that reassigned a
signal name silently read stale/wrong audio data on GPU instead of its own computed value. This
was **not specific to guest memory** — it affects any per-frame program using this idiom, which is
common corpus-wide, and was unverified because per-frame GPU dispatch had no differential coverage
against real presets before this increment.

Fixed by extending the existing `pi`/`e` "overwritten constant" mechanism
(`compiler/wgsl-generator.ts`) to cover signal names too, and making it **order-sensitive** — built
incrementally per-statement as the program compiles, not precomputed over the whole block, so a
read *before* the first assignment still correctly resolves to the raw signal (matching the CPU's
env, which has no own property until the assignment statement executes). Regression tests in
`tests/unit/wgsl-generator.test.ts` pin both directions (read-after-assign, read-before-assign).

Also fixed in the same pass: `med`/`att`/`med_att` are CPU-side legacy signal aliases
(`vm/shared.ts`) that were missing from `MILKDROP_WGSL_SIGNAL_ALIAS_MAP`.

## Known divergences / open questions

- CSP-fallback read helpers skip index truncation (`mb[2.7]` → `undefined → 0` vs JIT `mb[2]`);
  unpinned by tests. Fix belongs with moving buffer semantics into the conformance spec.
- gmegabuf process-lifetime persistence means GPU runs are order-dependent across preset
  switches by design; replay/differential harnesses must seed it explicitly.
- Field-path megabuf **writes** (see above): parked until reads land and the corpus shows
  write-bearing per-pixel programs matter.
