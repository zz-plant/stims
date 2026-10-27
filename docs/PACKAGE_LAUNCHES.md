# Standalone package launch drafts

Each library has a different audience and a working browser demo. Treat these as separate launches, each linking directly to its demonstration and source. These are prepared drafts; none has been posted.

On October 13, 2026, all four demo URLs returned HTTP 200. `eel-conformance`, `flash-guard` and `milkdrop-toolchain` were published to npm at 0.1.0 that day, by hand and without provenance; `audio-reactive` is private and its registry name returns HTTP 404. An HTTP response verifies reachability, not the demo's interactions.

The 0.1.0 READMEs on npm still say the packages are unpublished and point readers at a clone; the corrected READMEs reach npm when 0.1.1 is published. Add an installation command to a post only after that package's clean-consumer check passes. The publishing setup is in [Packages](../packages/README.md#publishing).

## milkdrop-toolchain: preset editors and renderer authors

Title: **A TypeScript compiler and EEL runtime for original MilkDrop presets**

> milkdrop-toolchain reads original .milk text, compiles equations into an IR, evaluates EEL2 with an interpreter or JavaScript JIT, and lowers supported equation blocks to WGSL. It also formats and exports presets and traces which audio signals reach each control.
>
> Try the compile playground with a preset, inspect its diagnostics, then change an equation. This is the compiler used by Stims; it does not render the picture. Successful compilation and agreement between execution tiers do not establish visual matching with native MilkDrop.
>
> Demo: https://zz-plant.github.io/stims/milkdrop-toolchain/
> Source and worked examples: https://github.com/zz-plant/milkdrop-toolchain
> Feedback: which preset constructs or editor tools would you need before adopting it?

Before posting: run the README compile example, check the diagnostic output in the playground, and show the input alongside its result. Publish a speed claim only with inputs, hardware, and a comparison benchmark.

## audio-reactive: creative coding and Web Audio developers

Held, not launched: the package is private and unpublished (2026-10-13). Keep this draft for if that changes.

Title: **AudioWorklet FFT, beat envelopes, and harmonic/percussive signals for visualizers**

> audio-reactive turns audio into signals a renderer can use: band energies, beat envelopes, spectral features, and harmonic/percussive estimates. Analysis runs in an AudioWorklet, with pure functions for offline use and interpolation between packets on the rendering side.
>
> The demo lets you inspect the signal changes rather than infer them from a visual effect. The README shows worklet bundling, packet buffer recycling, and an offline example. Harmonic/percussive separation is a signal estimate, not instrument identification or isolated vocal stems.
>
> Demo: https://zz-plant.github.io/stims/audio-reactive/
> Source and integration example: https://github.com/zz-plant/audio-reactive
> Feedback: which signals are useful in your visuals, and which bundlers make worklet setup difficult?

Before posting: test the worklet with user-started audio in a clean browser and check the documented asset-bundling path. Do not describe synthetic click tests as music-dataset accuracy.

## flash-guard: canvas authors and accessibility tooling

Title: **Analyze flash transitions in frame sequences and govern a live canvas**

> flash-guard provides frame-sequence analysis and a canvas luminance governor. Its demo exposes the measurements and mitigation, and its README describes sampling timing and how the governor observes its own brightness changes.
>
> It is a tool for investigating and reducing flashing under its sampling and threshold model. It does not certify a video, application, or viewing setup as safe. Sparse samples, unmeasured content, and transitions outside the capture remain limits.
>
> Demo: https://zz-plant.github.io/stims/flash-guard/
> Source and measured examples: https://github.com/zz-plant/flash-guard
> Feedback: reproducible false positives, missed transitions, and integration problems are useful reports.

Before posting: show a measured input and the output without autoplaying a strobe in a social preview. Retain the distinction between offline analysis of recorded frames and the live governor, which counts general and red flashes while a canvas is shown and dims it in response.

## eel-conformance: EEL implementers

Title: **A portable EEL2 conformance corpus with a runner contract**

> eel-conformance packages JSON cases, a schema, and a harness for testing EEL2 implementations. The runner contract specifies environment seeding, guest buffers, comparison tolerance, and deterministic random draws.
>
> Pinned cases define the corpus's required results; provisional cases remain questions awaiting upstream confirmation. Passing this corpus establishes agreement on those cases, not complete compatibility with every preset or native runtime.
>
> Demo: https://zz-plant.github.io/stims/eel-conformance/
> Source and runner contract: https://github.com/zz-plant/eel-conformance
> Feedback: independent runner results, upstream evidence for provisional cases, and small counterexamples.

Before posting: reproduce the corpus summary and run it against the intended engine. Include failures and the upstream version if comparing native behavior.

## Release and publication record

Track first npm publication, trusted-publisher setup, and clean-consumer verification separately for each library in [the release and launch issue](https://github.com/zz-plant/stims/issues/1410). Mirrors are read-only; route issues and pull requests to [zz-plant/stims](https://github.com/zz-plant/stims/issues).

After an actual post, record its date, destination URL, source revision, package version if released, and the example it demonstrates. Use the measurement instructions in [Launch material](./LAUNCH.md#measurement). GitHub visits and package downloads are not attributable stars or evidence that someone adopted the library.

## Clean-consumer verification, 2026-10-27

Checked from outside the Bun workspace: each tarball was installed into a new npm project (`"type": "module"`) in a temporary directory with no parent `package.json`. Two consumers per package: the repo's 0.1.1 tarball from `npm pack`, and the registry's 0.1.0 from `npm install <name>@0.1.0`. The README's TypeScript blocks were copied byte for byte from the installed `README.md` and run with Node's type stripping. Both consumers ran the 0.1.1 README's blocks; the 0.1.0 README's blocks differ only in line wrapping.

- Tools: Node 22.23.4 with npm 10.9.9. Node 24.11.1, the publish workflow's version, and Node 20.20.2, the `engines` floor, re-ran the examples: from the `.ts` files on 24 and from `tsc` output on 20. Bun 1.4.3. In the consumers, `typescript` 7.0.2 and `@types/node` 26.6.5 were pinned exactly; TypeScript 5.9.3 repeated the typecheck.
- Source revision: checks ran on `bfc3dceef`; the tarballs recorded below were packed from `9bde92cba`, which is `bfc3dceef` plus the two fixes listed at the end.
- Package gate: `typecheck`, `test`, `build` in each package directory, then `bun run check:dist-determinism -- <name>`. All passed: milkdrop-toolchain 561 tests in 27 files, flash-guard 119 in 5, eel-conformance 22 in 2. All three built deterministically.
- Typecheck: `strict`, `skipLibCheck: false` so the shipped `.d.ts` files are checked, once with `moduleResolution: "bundler"` and once with `"nodenext"`.
- Runtime dependencies: none. `npm ls --omit=dev` lists only the package itself.

| Package            | 0.1.1 tarball (shasum)                                           | README example, 0.1.1                                                                   | Typecheck, 0.1.1            | 0.1.0 from the registry                                                                  | Result |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| milkdrop-toolchain | 270 files, 478 KB (`4c9382bf`)                                    | All three blocks match the README output                                                | Pass, bundler and nodenext  | Same output for compile and evaluate; the WGSL block differs in `milkdropRand`           | Pass   |
| flash-guard        | 33 files, 80 KB (`a6e30b1f`)                                      | Audit block matches the README; governor block matches the README's table               | Pass, bundler and nodenext  | No `maxFlashLuminanceDelta`; the governor holds at `luminanceScale` 0.069, not 0.328     | Pass   |
| eel-conformance    | 26 files, 30 KB (`3033a659`)                                      | 82 passed, conforms; the CLI's `sections` output matches the README                     | Pass after the import fix   | Same corpus result and CLI output                                                        | Pass   |

### milkdrop-toolchain

- Packed: `dist/` (53 `.js` and 53 `.d.ts` files, each with a source map), `src/` (53 `.ts` files, which the maps point at), `data/parity-allowlist.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`. Nothing that should not ship: no tests, `site/`, `scripts/` or `bunfig.toml`.
- Example: compile printed `decay: 0.98 wave mode: 7`, 3 per-frame and 1 per-pixel statements, `fidelity: near-exact` and the `preset_expression_unknown_function` warning for `foo`. Evaluate printed `1.04`, `1` and `2`. The WGSL block printed `registers: [ 'q1' ]` (the README shows Bun's `[ "q1" ]`), 253 lines in all, ending in the two `state.` assignments the README shows.
- Registry 0.1.0: the WGSL is 248 lines; `milkdropRand` returns the unscaled draw and there is no `milkdropRandInt`.
- Limit: the `milkdrop-toolchain/src/*.ts` subpath does not run under Node. Node 22 refuses with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, because it does not strip types under `node_modules`. The README offers that subpath only to runtimes that execute TypeScript directly.

### flash-guard

- Packed: `dist/` (9 `.js` and 9 `.d.ts` files), `src/`, the two `docs/governor-trace-*.svg` figures the README embeds, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`. `demo/` is left out, as the README says. `flash-guard/worker` resolves to `dist/readback.worker.js`, and its types resolve from the sibling `.d.ts`.
- Example: the audit block printed the README's object field for field and `risk: high`; Node omits the trailing comma Bun prints. The governor block prints nothing. Adding one `console.log` every 15 frames reproduced the README's eight-row table exactly, ending at `hold=0.672 luminanceScale=0.328`. The canvas block needs a page (`canvas`, `draw`, `settings`), so in Node it was typechecked against ambient declarations, not run.
- Registry 0.1.0: the audit has no `maxFlashLuminanceDelta`, and the governor holds the same strobe at `hold=0.931 luminanceScale=0.069`, the multiply model the 0.1.1 README says was replaced.
- Limits: the packed README keeps "screen-content heuristics, not a medical device", "it is not a guarantee of safety for every viewer" and the timing table's hardware (M1 Max, 1280x720, headless Chromium).

### eel-conformance

- Packed: `cases/` (9 groups), `schema.json`, `dist/` (`index`, `harness`, `cli`; `cli.js` starts with `#!/usr/bin/env node`), `src/`, `docs/` (two coverage figures and `ns-eel2-source-audit.md`), `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`. The `./schema.json` and `./cases/*` exports load as JSON imports.
- CLI: `npx eel-conformance sections` printed the README's table and `82 cases in 9 sections, 3 provisional`; `validate` printed `82 cases in 9 sections: shape ok.`
- Example: the README imports `./my-eel-engine`, so the consumer supplied one. It used only the root exports of milkdrop-toolchain 0.1.1 (`parseMilkdropStatement`, `compileMilkdropProgram`), not Stims' reference runner. Result: `82 passed, 0 failed, 0 errored`, `conforms`. The same runner with milkdrop-toolchain 0.1.0 and eel-conformance 0.1.0 gave the same result. Control: a runner that executes nothing got 18 passed and 64 failed, and does not conform.
- Independent runner: the same README runner drove Butterchurn's EEL path, which shares no code with Stims. That path is `milkdrop-eel-parser` 0.0.4 converting each program to JavaScript, plus the helper block from `butterchurn` 2.6.7's `presetBase.js`, evaluated from the installed bundle. The runner made four adaptations: it ended each line with `;`, set every name the program reads to 0 (contract step 1), substituted the harness draw for `Math.random`, and copied the buffers to and from plain arrays. Result: 40 passed, 11 failed, 31 errored; 39 pinned cases failed. 17 errors are parser rejections (9 of them on `^`, the rest on `!` before a number literal, assignments inside expressions, `while(cond, body)`, and `rand()` with no argument), and 14 are missing functions (`mod`, `clamp`, `invsqrt`, `smoothstep`, `ceil`, `frac`, `mix`, `step`, `randint`). The 11 failures are value differences, among them out-of-range buffer writes kept, `pi` and `e` not prepopulated, `log(0)` and `exp` overflow left non-finite. This shows the harness reporting a foreign engine case by case; it is not a Butterchurn compatibility verdict.

### Problems found

- Fixed in `32fc81ed1`: under the pinned Bun 1.4.3, `bun --cwd <dir> run <script>` prints the `bun run` usage and exits 0 without running anything. `publish-packages.yml`'s typecheck and build lines were no-ops: with a type error added, the old line exited 0 and the new one exits 1. The documented `bun --cwd packages/<name> run build` built nothing. Every occurrence now uses `bun --cwd=<dir> run <script>`. Releases were still built, because `check:dist-determinism` and `prepublishOnly` run the scripts from inside the package directory.
- Fixed in `9bde92cba`: the eel-conformance runner example imported `./my-eel-engine` with no extension. That is TS2835 under `nodenext` with TypeScript 7.0.2 and 5.9.3, and `ERR_MODULE_NOT_FOUND` in Node. It now imports `./my-eel-engine.js`, which typechecks in both modes and runs on Node 20 and 22 once compiled. Running the `.ts` file directly under type stripping still needs a `.ts` specifier.
- Open, for the maintainer before tagging: the 0.1.1 changelog entries of milkdrop-toolchain and flash-guard say "Documentation only; no code changes", but their packed 0.1.1 differs from the published 0.1.0 in code. milkdrop-toolchain changed 27 files under `src/` with no changelog entry; the WGSL `rand` change above is one. flash-guard changed 8, listed under `## Unreleased`, including new exports and the governor's brightness model. The tarballs above would ship those changes under a heading that says there are none. Choose each version and move the entries before pushing a `<name>@<version>` tag.
- Not checked here: the trusted-publisher setup and provenance on the next workflow run, and the demo interactions. Both remain open in [#1410](https://github.com/zz-plant/stims/issues/1410).
