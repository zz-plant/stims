# MilkDrop language reference (Stims)

<!-- GENERATED FILE — do not edit by hand.
     Source of truth: src/js/milkdrop/builtin-docs.ts
     Regenerate: bun run docs:authoring-reference -->

Every name below is derived from the same table the compiler, syntax
highlighter, autocomplete, and hover docs use — if it is listed here, it
compiles. For the guided course, start at [the curriculum](README.md).

## The expression language in ten lines

The equation language is NS-EEL, inherited from Winamp:

- A program is assignments separated by `;`. Assigning to any name creates it.
- Every value is a number (double). There are no strings or booleans.
- Comparisons and logic return 1 or 0, and any value within
  `0.00001` of zero is false — `if(x, a, b)`, `above`,
  `below`, `equal`, `band`, `bor`, `bnot` are the branching toolkit
  (`if` evaluates both branches; there is no short-circuit).
- Names are case-insensitive. `//` starts a comment.
- Operators: `+ - * / % ^` (power), comparisons `< <= > >= == !=`,
  logic `&& || !`.
- Numeric literals accept decimals, exponents (`1e-3`), and hex (`0x1f`).
- `megabuf(i)` / `gmegabuf(i)` read indexed storage; assigning to
  `megabuf(i) = v` writes it (per-preset vs global).

## Functions

| Function | Meaning |
|---|---|
| `sin(x)` | sine |
| `cos(x)` | cosine |
| `tan(x)` | tangent |
| `asin(x)` | arcsine |
| `acos(x)` | arccosine |
| `atan(x)` | arctangent |
| `atan2(y, x)` | angle of the vector (x, y) |
| `abs(x)` | absolute value |
| `sqrt(x)` | square root |
| `pow(x, y)` | x raised to the power y |
| `mod(x, y)` | remainder of x/y (0 when y is 0) |
| `fmod(x, y)` | alias of mod |
| `min(a, b)` | smaller of a and b |
| `max(a, b)` | larger of a and b |
| `mix(a, b, t)` | linear blend from a to b by t |
| `lerp(a, b, t)` | alias of mix |
| `floor(x)` | round down |
| `int(x)` | truncate toward zero |
| `ceil(x)` | round up |
| `sqr(x)` | x*x |
| `clamp(x, min, max)` | clamp(x, min, max) |
| `step(threshold, x)` | 0 when x is below threshold, else 1 |
| `smoothstep(min, max, x)` | smooth 0..1 ramp of x between min and max |
| `log(x)` | natural logarithm |
| `log10(x)` | base-10 logarithm |
| `exp(x)` | e raised to x |
| `sigmoid(x, k)` | logistic curve 1/(1+e^(-x*k)) |
| `sign(x)` | -1, 0, or 1 |
| `bor(a, b)` | logical OR, returns 1 or 0 |
| `band(a, b)` | logical AND, returns 1 or 0 |
| `bnot(x)` | logical NOT, returns 1 or 0 |
| `frac(x)` | fractional part |
| `if(cond, then, else)` | if(cond, then, else) |
| `above(a, b)` | 1 when a > b |
| `below(a, b)` | 1 when a < b |
| `equal(a, b)` | 1 when a and b are (almost) equal |
| `rand(scale)` | random 0-scale |
| `randint(max)` | random integer in 0..max-1 |
| `megabuf(index)` | per-preset shared value buffer |
| `gmegabuf(index)` | global value buffer shared across presets |
| `exec2(a, b)` | evaluate a then b; returns b |
| `exec3(a, b, c)` | evaluate a, b, c; returns c |

## Constants

| Constant | Meaning |
|---|---|
| `pi` | π (3.14159…) |
| `e` | Euler's number (2.71828…) |

## Signals (read-only inputs)

Fed by the runtime every frame. Audio bands are the heart of reactivity —
see Track 3 of the curriculum for how to use them well.

| Variable | Meaning |
|---|---|
| `bass` | bass energy |
| `mid` | mid energy |
| `treb` | treble energy |
| `treble` | alias of treb (Stims runtime signal) |
| `bass_att` | bass with envelope |
| `mid_att` | mid with envelope |
| `treb_att` | treble with envelope |
| `beat` | beat detector output |
| `beat_pulse` | beat intensity pulse (Stims runtime signal) |
| `rms` | overall signal level |
| `vol` | mean of the relative bands |
| `time` | seconds |
| `frame` | frame count |
| `fps` | frames per second |
| `progress` | frame count (ProjectM-compatible alias) |

Stims also exposes interaction and device-motion signals (`inputX`,
`gestureScale`, `motionX`, …) that are **not standard MilkDrop** — see the
[signal contract](../MILKDROP_PRESET_RUNTIME.md) before relying on them.

## Render state (read/write knobs)

Written by `per_frame`/`per_pixel` code to steer the feedback loop —
[Track 1](01-how-milkdrop-thinks.md) and [Track 2](02-motion.md) teach these.

| Variable | Meaning |
|---|---|
| `zoom` | zoom amount per frame |
| `rot` | rotation per frame |
| `warp` | warp intensity |
| `sx` | stretch along x |
| `sy` | stretch along y |
| `dx` | translation along x |
| `dy` | translation along y |
| `cx` | zoom/rotation center x |
| `cy` | zoom/rotation center y |

## Registers

- `q1`–`q32` — persistent globals: the bridge
  between variable pools. Set in `per_frame`, readable in `per_pixel`,
  custom wave/shape code, and as shader uniforms.
- `t1`–`t32` — per-slot temporaries for custom
  waves and shapes.

## Where code runs

| Block | Runs | Notes |
|---|---|---|
| `per_frame_init_N` / `per_frame_N` | once per frame | set knobs, read audio |
| `per_pixel_N` | per mesh point | also reads `x`, `y`, `rad`, `ang` |
| `wavecode_N_*` + `wave_N_per_point_N` | per custom-wave sample | reads `sample`, writes `x y r g b a` |
| `shapecode_N_*` (`init`/`per_frame`) | per shape instance | writes `x y rad ang sides r g b a …` |
| `[warp_shader]` / `[comp_shader]` | per pixel on the GPU | GLSL 1.20 — see the [coding guide](../MILKDROP_CODING_GUIDE.md#the-glsl-shader-era-2008present) |

Shader uniforms, samplers, and engine limits are documented in the
[coding guide](../MILKDROP_CODING_GUIDE.md#engine-limitations) and the
[shader support inventory](../architecture/shader-support-inventory.md).
