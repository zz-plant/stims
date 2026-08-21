# EEL conformance specification

An executable specification of the expression language MilkDrop presets are
written in — the dialect of ns-eel/EEL2 that `per_frame`, `per_pixel`,
`per_point` and `init` blocks use.

There has never been a written specification for this language, only
implementations that disagree with each other. This corpus is an attempt at
one: every rule is a case with a program, an input state, and a required
output state, so conformance is something you run rather than something you
argue about.

The cases are plain JSON. Running them requires nothing from this repository.

## Layout

| Path | What it is |
| --- | --- |
| `cases/*.json` | The corpus. Portable data — this is the specification. |
| `schema.json` | JSON Schema for a case group. |
| `index.ts` | TypeScript loader and the shared constants (buffer size, RNG draw, tolerance). |
| `reference-runner.ts` | A conforming runner, written to be read as the worked example. |

Run it against this repo's tiers:

```bash
bun run spec:eel
```

`bun run check` enforces the same corpus through
`tests/unit/eel-conformance-spec.test.ts`.

## Runner contract

A conforming runner executes one case like this:

1. **Start from zero.** Every variable is 0 until assigned. Reading an unknown
   name is legal and yields 0 — never an error. Apply the case's `env` on top.
2. **Allocate both guest buffers** at 1048576 f32 slots each, zero-filled, then
   apply `megabuf` and `gmegabuf` from the case. `megabuf` is per-preset
   scratch; `gmegabuf` is shared across presets.
3. **Execute `program` as one block**, in order. It is a single program, not
   independent lines: state carries from each statement to the next.
4. **Use the fixed RNG.** Every `rand()`/`randint()` draw returns exactly
   `0.5`. Randomness is not what these cases test, and a fixed draw is what
   makes them portable.
5. **Compare.** For each entry in `expected`, the variable must be within
   `1e-12 + |expected| * 1e-9`. Same for `expectedMegabuf` /
   `expectedGmegabuf` against buffer slots. Absent variables read as 0, so
   `{"x": 0}` is a real assertion.

Buffer size is part of the contract, not an implementation detail: bounds
behaviour is only defined against a declared size, and a runner that allocates
a short buffer will read past its end and produce garbage where the spec
requires 0.

### Case status

Each case is `pinned` (default) or `provisional`.

- **pinned** — derived from documented MilkDrop 2.x / ns-eel behaviour. A
  conforming implementation must produce this value.
- **provisional** — this implementation's *observed* behaviour, not yet
  confirmed against ns-eel. A provisional case is a question, not a
  requirement. Enforcing it still has value (silent drift is worse than a
  wrong-but-known value), but do not port one into another implementation
  without checking upstream first.

## What the corpus covers

Sections, in file order: arithmetic operators and precedence; bitwise and
logical operators; the truthiness threshold and short-circuiting; math
functions and their domain guards; rounding, clamping and interpolation
helpers; variables and the finite clamp; `megabuf`/`gmegabuf` guest memory;
`loop`/`while` control flow; and the random functions.

Some rules that most often catch a new implementation:

- **Division by zero is 0**, but the guard is *exact zero* — `1 / 0.0000001`
  divides normally and yields ten million. A tolerance guard here silently
  zeroes results real presets depend on.
- **`%` truncates both operands to integers first**; float remainder is
  `mod()`/`fmod()`. They are different operators, not spellings of one.
- **Truthiness is `|v| > 1e-5`**, not `v != 0` — for `if`, `&&`, `||`, `!` and
  `bnot`. But see the open question about `while` below.
- **`==` is exact; `equal()` uses the close factor.** Only one of them is
  tolerant.
- **`bor()` and `band()` are logical, not bitwise**, despite the names. The
  bitwise operators are `|` and `&`. `bor(2,4)` is 1, not 6.
- **`frac()` subtracts the floor**, so `frac(-0.25)` is `0.75`. Using `trunc`
  instead diverges on every negative input.
- **`step(edge, v)` takes the edge first.**
- **`pi` and `e` are ordinary prepopulated variables**, and assignments to them
  stick. Around 74 presets in the bundled corpus overwrite one.
- **Names are case-insensitive.** `contVol` and `contvol` are one variable.
- **Non-finite values are clamped to 0 at the statement boundary.** Expression
  state persists across frames, so one escaped Infinity would poison a variable
  for the preset's lifetime.
- **`smoothstep()` with equal edges** is defined here as `v < edge ? 0 : 1`.
  GLSL and WGSL leave that case undefined, so a GPU backend must special-case
  it rather than call the builtin.

## Open questions

The three provisional cases are places where this implementation had to pick a
behaviour and the reference is unverified. Resolving them against ns-eel would
be the most useful contribution to this spec.

1. **`while` condition truthiness** (`control-flow/while-condition-is-exact-zero`).
   A `while()` condition is tested against exact zero, while every other
   boolean context uses the `|v| > 1e-5` threshold. A condition decaying to
   `1e-6` therefore keeps looping instead of exiting. Both CPU tiers agree, so
   no differential test can see it. If the close-factor rule turns out to be
   correct, a class of presets is currently spinning to the iteration cap
   (2097152) every frame.
2. **Unary minus vs `^`** (`operators-arithmetic/precedence-unary-minus-over-pow`).
   `-2 ^ 2` parses as `(-2)^2 = 4`, not `-(2^2) = -4`. Most languages that
   spell exponentiation as an operator bind unary minus more loosely. No
   bundled preset appears to depend on it.
3. **`^` associativity** (`operators-arithmetic/pow-left-associative`).
   `2 ^ 3 ^ 2` parses left-associatively as 64, not the more usual
   right-associative 512.

## Contributing a case

Add it to the appropriate group in `cases/`. Keep `id` stable — never reuse an
id for different semantics, because other implementations track results by it.
Say in `note` *why* the value is what it is and what depends on it; a case
whose expected value nobody can justify becomes unchangeable for the wrong
reason.

Changing an existing pinned value is a platform-semantics decision. Check the
preset corpus for content depending on the old behaviour before editing.
