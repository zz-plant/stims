# eel-conformance

An executable specification of EEL2, the expression language MilkDrop presets are written in: the dialect of ns-eel that `per_frame`, `per_pixel`, `per_point` and `init` blocks use. Cockos documents EEL2 in prose. This corpus pins the MilkDrop dialect's behaviour as cases instead: each rule is a program, an input state and a required output state, so conformance is something you run rather than something you argue about.

The cases are plain JSON with a JSON Schema. Running them requires nothing from this package: a C++, Rust or JavaScript engine can read `cases/*.json` directly. The TypeScript loader and harness are a convenience for engines that live in that ecosystem.

Demo: the [corpus browser](https://zz-plant.github.io/stims/eel-conformance/) reads every case from the shipped `cases/*.json` and searches them by id, name, program text or note.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zz-plant/stims/main/packages/eel-conformance/docs/coverage-dark.svg">
  <img alt="82 cases in 9 sections, all pinned: operators-arithmetic 17, operators-logical 7, truthiness 7, functions-math 12, functions-utility 14, variables 6, buffers 10, control-flow 6, random 3" src="https://raw.githubusercontent.com/zz-plant/stims/main/packages/eel-conformance/docs/coverage-light.svg">
</picture>

## What is in the box

| Path           | What it is                                            |
| -------------- | ----------------------------------------------------- |
| `cases/*.json` | The corpus. Portable data; this is the specification. |
| `schema.json`  | JSON Schema (draft-07) for a case group.              |
| `src/index.ts` | Loader, the specification constants, and the harness. |
| `dist/cli.js`  | `eel-conformance`, a command-line view of the corpus. |

```
$ eel-conformance sections
section               cases  provisional  description
operators-arithmetic  17     -            Arithmetic operators, their zero-guards, and precedence.
operators-logical     7      -            Bitwise operators, comparisons, and the logical operators that are NOT bitwise despite their names.
truthiness            7      -            The close-factor truthiness threshold: a value is true when its magnitude EXCEEDS 1e-5.
functions-math        12     -            Transcendental and root functions, and the domain guards that keep them finite.
functions-utility     14     -            Rounding, clamping, interpolation, and the default arguments that fill omitted parameters.
variables             6      -            Variable initialisation, assignment as an expression, overwritable constants, and the finite clamp at the statement boundary.
buffers               10     -            megabuf and gmegabuf guest memory: indexing, truncation, bounds, and separation. Both buffers hold 1048576 f32 slots and start zero-filled.
control-flow          6      -            loop() and while() statements and their iteration cap. The two-argument while(cond, body) form is a dialect extension shared with projectM and Butterchurn; ns-eel2 registers while with one argument, so the same programs read while(exec2(body, cond)) there.
random                3      -            rand() and randint() under the fixed conformance RNG, which returns exactly 0.5 for every call (see README, Runner contract).

82 cases in 9 sections, 0 provisional
```

A case looks like this:

```json
{
  "id": "index-truncates",
  "name": "a buffer index truncates toward zero",
  "program": ["megabuf(2.9) = 4", "x = megabuf(2)"],
  "expected": { "x": 4 },
  "expectedMegabuf": { "2": 4 }
}
```

## Runner contract

A conforming runner executes one case like this:
1. **Start from zero.** Every variable is 0 until assigned. Reading an unknown name is legal and yields 0, never an error. Apply the case's `env` on top.
2. **Allocate both guest buffers** at 1,048,576 f32 slots each, zero-filled, then apply `megabuf` and `gmegabuf` from the case. `megabuf` is per-preset scratch; `gmegabuf` is shared across presets.
3. **Execute `program` as one block**, in order. It is a single program, not independent lines: state carries from each statement to the next.
4. **Use the fixed RNG.** Every `rand()` / `randint()` draw returns exactly `0.5`. Randomness is not what these cases test, and a fixed draw is what makes them portable.
5. **Compare.** For each entry in `expected`, the variable must be within `1e-12 + |expected| * 1e-9`. Same for `expectedMegabuf` / `expectedGmegabuf` against buffer slots. Absent variables read as 0, so `{"x": 0}` is a real assertion.

Buffer size is part of the contract, not an implementation detail. Bounds behaviour is only defined against a declared size, and a runner that allocates a short buffer will read past its end and produce garbage where the specification requires 0.

### Case status

Each case is `pinned` (the default) or `provisional`.
- **pinned**: derived from documented MilkDrop 2.x / ns-eel behaviour. A conforming implementation must produce this value.
- **provisional**: this corpus's _observed_ behaviour, not yet confirmed against ns-eel. A provisional case is a question, not a requirement. Enforcing it still has value, since silent drift is worse than a wrong-but-known value, but do not port one into another implementation without checking upstream first. The shipped corpus has none left: the three it was extracted with were resolved against the ns-eel2 source (see [Open questions](#open-questions)), and the status stays in the schema for the next case that needs it.

## Install

```sh
npm install eel-conformance
# or
bun add eel-conformance
```

## Running it against your engine

The harness does the seeding and the comparing; you supply the one thing that is yours, executing EEL. A runner receives the program lines, an `env` to mutate, both buffers to mutate, and the random draw to use.

```ts
import { conforms, formatReport, runConformance } from 'eel-conformance';
import { execute } from './my-eel-engine.js';

const report = await runConformance(
  ({ program, env, megabuf, gmegabuf, random }) => {
    execute(program.join('\n'), { env, megabuf, gmegabuf, rand: random });
  },
);

console.log(formatReport(report));
process.exit(conforms(report) ? 0 : 1);
```

`runConformance` records a thrown error as an error on that case and keeps going, because the useful output is the whole table, not the first crash. `conforms` is true when every pinned case passed; provisional failures are reported separately and never count against conformance. Variable names in `env` are lower-cased, matching the language's case-insensitivity.

Stims runs this corpus against the three CPU execution paths of [`milkdrop-toolchain`](https://github.com/zz-plant/stims/tree/main/packages/milkdrop-toolchain), single-statement evaluation, the CSP-fallback interpreter and the JIT, in [`tests/unit/eel-conformance-spec.test.ts`](https://github.com/zz-plant/stims/blob/main/tests/unit/eel-conformance-spec.test.ts), with [`spec/eel-conformance/reference-runner.ts`](https://github.com/zz-plant/stims/blob/main/spec/eel-conformance/reference-runner.ts) as the runner. It does not run the corpus against the toolchain's WGSL generator.

## What the corpus covers

Sections, in file order: arithmetic operators and precedence; bitwise and logical operators; the truthiness threshold and short-circuiting; math functions and their domain guards; rounding, clamping and interpolation helpers; variables and the finite clamp; `megabuf` / `gmegabuf` guest memory; `loop` / `while` control flow; and the random functions.

Rules that most often catch a new implementation:
- **Division by zero is 0**, but the guard is _exact zero_: `1 / 0.0000001` divides normally and yields ten million. A tolerance guard here silently zeroes results real presets depend on.
- **`%` truncates both operands to integers first**; float remainder is `mod()` / `fmod()`. They are different operators, not spellings of one.
- **Truthiness is `|v| > 1e-5`**, not `v != 0`, for `if`, `&&`, `||`, `!`, `bnot` and the `while` condition. A `while` condition that decays to `1e-6` exits; ns-eel2's loop stub compares `|cond|` against the same close factor every other boolean context uses.
- **`==` is exact; `equal()` uses the close factor.** Only one of them is tolerant.
- **`bor()` and `band()` are logical, not bitwise**, despite the names. The bitwise operators are `|` and `&`. `bor(2,4)` is 1, not 6.
- **`frac()` subtracts the floor**, so `frac(-0.25)` is `0.75`. Using `trunc` instead diverges on every negative input.
- **`step(edge, v)` takes the edge first.**
- **Unary minus binds looser than `^`**: `-2 ^ 2` is `-(2^2) = -4`, as in ns-eel2, whose preprocessor rewrites it to `-pow(2,2)`. Modern EEL2 (WDL) gives +4; an engine built on that grammar fails this case by design.
- **`^` is left-associative**: `2 ^ 3 ^ 2` is `(2^3)^2 = 64`, not 512, in both references.
- **`pi` and `e` are ordinary prepopulated variables**, and assignments to them stick. Around 74 presets in the Butterchurn corpus overwrite one.
- **Names are case-insensitive.** `contVol` and `contvol` are one variable.
- **Non-finite values are clamped to 0 at the statement boundary.** Expression state persists across frames, so one escaped Infinity would poison a variable for the preset's lifetime.
- **`smoothstep()` with equal edges** is defined here as `v < edge ? 0 : 1`. GLSL and WGSL leave that case undefined, so a GPU backend must special-case it rather than call the builtin.

## Open questions

None. The corpus shipped with three provisional cases, and [`docs/ns-eel2-source-audit.md`](https://github.com/zz-plant/stims/blob/main/packages/eel-conformance/docs/ns-eel2-source-audit.md) resolved each against the ns-eel2 source that MilkDrop 2 ships and against modern EEL2 (WDL). The ids are unchanged; each case's `note` cites the deciding source.
1. **`while` condition truthiness** (`control-flow/while-condition-is-exact-zero`): the pin was wrong. `nseel_asm_repeatwhile` compares `|cond|` against the close factor, so `while(n, …)` with `n = 1e-6` never enters its body. The expected value flipped from `x = 1` to `x = 0`.
2. **Unary minus versus `^`** (`operators-arithmetic/precedence-unary-minus-over-pow`): the references disagree, and the pin matched the wrong one. ns-eel2 reads `-2 ^ 2` as `-pow(2,2) = -4`; WDL reads it as `+4`. This corpus specifies MilkDrop 2's dialect, so the expected value flipped to -4. No bundled preset writes `-a^b`.
3. **`^` associativity** (`operators-arithmetic/pow-left-associative`): the pin was right. Both references are left-associative; 64 stays.

The audit also found eight _pinned_ cases that document this implementation rather than the references (`==` tolerance, `int()`, `sqrt` and `log` of out-of-domain inputs, overflow clamps, negative buffer indices, `pi`/`e`, `mod()`). Those are listed in the audit's "Overturned pins" table and are corrected separately, each with its matching engine change.

## Contributing a case

Add it to the appropriate group in `cases/`. Keep `id` stable: never reuse an id for different semantics, because other implementations track results by it. Say in `note` _why_ the value is what it is and what depends on it; a case whose expected value nobody can justify becomes unchangeable for the wrong reason. `eel-conformance validate` checks the shape, and `bun test` checks the invariants the schema cannot express.

Changing an existing pinned value is a platform-semantics decision. Check a preset corpus for content depending on the old behaviour before editing.

## Development

The code is developed in [zz-plant/stims](https://github.com/zz-plant/stims) under [`packages/eel-conformance`](https://github.com/zz-plant/stims/tree/main/packages/eel-conformance), next to the app that uses it, and released from there. [zz-plant/eel-conformance](https://github.com/zz-plant/eel-conformance) is a read-only mirror of that directory, updated on every change. Open issues and pull requests on zz-plant/stims.

Build and test from a clone of zz-plant/stims:

```sh
bun install --frozen-lockfile
bun --cwd=packages/eel-conformance run build
bun --cwd packages/eel-conformance test
```

## Provenance

Extracted from `spec/eel-conformance/` in [zz-plant/stims](https://github.com/zz-plant/stims), where the corpus was written to pin the EEL semantics that project implements. The cases and the schema are unchanged. The loader is the Stims loader with a `cases/` path that works from both `src/` and `dist/`; the harness and the CLI are new.

## License

[Unlicense](https://github.com/zz-plant/stims/blob/main/packages/eel-conformance/LICENSE). Public domain.
