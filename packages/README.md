# Packages

Standalone, publishable libraries extracted from Stims. Each directory is a
complete npm package with its own `package.json`, tests, README, changelog and
Unlicense file, and no dependency on the rest of this repository, so any of
them can be moved to its own repository with `git subtree split -P packages/<name>`
without changes.

| Package | What it is | Tests |
| --- | --- | --- |
| [`eel-conformance`](./eel-conformance) | Executable specification of EEL2, the MilkDrop preset expression language: 82 portable JSON cases, a schema, a runner contract and a harness. | 22 |
| [`flash-guard`](./flash-guard) | WCAG 2.3.1 flash and red-flash analysis for frame sequences, plus a live governor that keeps a canvas under the threshold. | 65 |
| [`milkdrop-toolchain`](./milkdrop-toolchain) | Parser, EEL2 interpreter and JIT, IR, HLSL analysis with GLSL emission, EEL-to-WGSL, formatter, MilkDrop 2 exporter and dataflow analysis for `.milk` presets. | 510 |
| [`audio-reactive`](./audio-reactive) | AudioWorklet FFT with harmonic/percussive separation, per-band beat tracking, spectral features, reactivity metrics and packet interpolation. | 55 |

## Working on them

Every package runs with the repository's root `node_modules` (TypeScript and
`@types/bun` are the only dev dependencies):

```bash
bun run check:packages            # typecheck + test every package
bun --cwd packages/flash-guard test
bun --cwd packages/flash-guard run build   # emits dist/ (gitignored)
```

Run `bun test` from inside a package directory, not the root: each package has
its own `bunfig.toml` so the root test preload (happy-dom, fake WebGPU) is not
loaded.

## Publishing

`.github/workflows/publish-packages.yml` publishes one package per tag of the
form `<name>@<version>` (for example `flash-guard@0.1.0`) with npm provenance.
It uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers),
which needs no token: register this repository and that workflow file as the
trusted publisher on each package's npm settings page once the package exists.
The first publish of a new name has to be done by hand with `npm publish`
from the package directory, after `bun run build`, since trusted publishing
can only be configured on an existing package.

The versions in each `package.json` are the source of truth. The workflow
refuses a tag whose version does not match.

## Sites

Every package has a static site under `site/` with a working demo on the
real library: a corpus browser for `eel-conformance`, an in-browser video
flash checker and the live governor for `flash-guard`, a compile playground
for `milkdrop-toolchain`, and a live worklet demo for `audio-reactive`. They
share one stylesheet (`site/styles.css`, kept identical in each package) and
need no build tooling beyond Bun.

```bash
bun --cwd packages/flash-guard run site:build     # one site, into packages/flash-guard/_site/
bun --cwd packages/flash-guard run site:preview   # ...served on http://localhost:8787
bun run site:packages                             # all four plus an index, into ./_site/
bun run site:packages -- --serve                  # ...served on http://localhost:8788
```

`.github/workflows/pages-packages.yml` deploys `./_site` to this repository's
GitHub Pages on every push to `main` that touches `packages/`, so the sites
live at `https://zz-plant.github.io/stims/<name>/` once Pages is enabled with
"GitHub Actions" as the source. Each package also carries its own
`.github/workflows/pages.yml`, which takes over after a subtree split and
publishes the same site from the package's own repository.

## Relationship to the app

Stims still runs on its own copies of this code under `src/js/`. The
`eel-conformance` corpus is the one exception: `spec/eel-conformance/` now
re-exports the package, so there is a single set of cases. Switching the app
to depend on the published packages is a follow-up; the point of the split is
that the public API is now fixed and tested on its own.
