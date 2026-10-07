# Packages

Standalone, publishable libraries extracted from Stims. Each directory is a
complete npm package with its own `package.json`, tests, README, changelog and
Unlicense file, and no dependency on the rest of this repository. The app
imports them; this directory is the only copy of their code. Each also has a
read-only mirror repository, github.com/zz-plant/<name>, and a site with a
live demo.

| Package | What it is | Tests |
| --- | --- | --- |
| [`eel-conformance`](./eel-conformance) | Executable specification of EEL2, the MilkDrop preset expression language: 82 portable JSON cases, a schema, a runner contract and a harness. | 22 |
| [`flash-guard`](./flash-guard) | WCAG 2.3.1 flash and red-flash analysis for frame sequences, plus a live governor that keeps a canvas under the threshold. | 74 |
| [`milkdrop-toolchain`](./milkdrop-toolchain) | Parser, EEL2 interpreter and JIT, IR, HLSL analysis with GLSL emission, EEL-to-WGSL, formatter, MilkDrop 2 exporter and dataflow analysis for `.milk` presets. | 510 |
| [`audio-reactive`](./audio-reactive) | AudioWorklet FFT with harmonic/percussive separation, per-band beat tracking, spectral features, reactivity metrics and packet interpolation. | 55 |

## Working on them

They are Bun workspaces (`"workspaces": ["packages/*"]` in the root
`package.json`), linked into `node_modules`, and the app depends on them as
`workspace:*`. It imports them by name: `audio-reactive`, `flash-guard`, and
`milkdrop-toolchain/src/<module>.ts` for the toolchain's internal seams (the
`src/*` export), which is how the renderer and editor reach the IR, the GLSL
emitter and the WGSL generator.

No build step sits between a change here and the app. Each `exports` entry
lists two source conditions ahead of the built `dist/`: `stims-source`, which
Vite (`resolve.conditions`) and TypeScript (`customConditions`) use, and
`bun`, which Bun applies on its own for tests and scripts. Consumers from npm
get `dist/`, or the TypeScript sources under Bun. Wrangler's bundler honours
neither condition, so code bundled for a Worker reaches the toolchain only
through its `src/*` subpath.

Each package's tests run on their own (TypeScript and `@types/bun` are the
only dev dependencies):

```bash
bun run check:packages            # typecheck + test every package
bun --cwd packages/flash-guard test
bun --cwd packages/flash-guard run build   # emits dist/ (gitignored)
```

Run `bun test` from inside a package directory, not the root: each package has
its own `bunfig.toml` so the root test preload (happy-dom, fake WebGPU) is not
loaded.

## Mirrors

| Package | Mirror |
| --- | --- |
| `eel-conformance` | [zz-plant/eel-conformance](https://github.com/zz-plant/eel-conformance) |
| `flash-guard` | [zz-plant/flash-guard](https://github.com/zz-plant/flash-guard) |
| `milkdrop-toolchain` | [zz-plant/milkdrop-toolchain](https://github.com/zz-plant/milkdrop-toolchain) |
| `audio-reactive` | [zz-plant/audio-reactive](https://github.com/zz-plant/audio-reactive) |

Each mirror holds only its package directory, with the history of every
commit that touched it. They are read-only: issues are off, Actions are off,
and changes land here. `.github/workflows/mirror-packages.yml` pushes to them
after a change to `packages/` reaches `main`.

The split is `bun run packages:split -- <name>` (`scripts/split-package.ts`),
which writes the branch `split/<name>`. It produces the same commits as
`git subtree split --prefix packages/<name>`, in under a second instead of
about five minutes, because it asks git only for the commits that touched the
directory. It is deterministic, so every run reproduces the mirror's existing
history and a push is always a fast-forward. To push one by hand:

```bash
bun run packages:split -- flash-guard
git push https://github.com/zz-plant/flash-guard.git split/flash-guard:refs/heads/main
```

The workflow needs a `PACKAGES_MIRROR_TOKEN` repository secret: a
fine-grained personal access token with "Contents: Read and write" on the four
mirror repositories. Until it exists the workflow warns and stops, and the
mirrors stay at the state they were last pushed in.

## Publishing

`.github/workflows/publish-packages.yml` publishes one package per tag of the
form `<name>@<version>` (for example `flash-guard@0.1.0`) with npm provenance.
It uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers),
which needs no token: register this repository and that workflow file as the
trusted publisher on each package's npm settings page once the package exists.
The first publish of a new name has to be done by hand, since trusted
publishing can only be configured on an existing package:

```bash
npm login
cd packages/flash-guard && bun run build && npm publish --access public
```

None of the four is on npm yet, and all four names are free.

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
live at `https://zz-plant.github.io/stims/<name>/`. It is the only deployment;
the mirrors do not run workflows.

## Relationship to the app

The app has no copies of this code. Its adapters are the only Stims-specific
layer: `src/js/core/services/flash-safety.ts` binds `flash-guard`'s controller
to the Reduce flashing preference, the render loop's frame notification and
the stage's brightness filter; `src/js/milkdrop/types.ts` adds the catalog,
renderer and runtime types to the toolchain's; `spec/eel-conformance/`
re-exports the corpus for the three-tier conformance run.

Tests follow the code. Each package's suite lives in its `tests/` and runs in
the full gate (`bun run check:packages`); `tests/` keeps only what needs the
rest of the repository, such as compiling the bundled preset corpus.
