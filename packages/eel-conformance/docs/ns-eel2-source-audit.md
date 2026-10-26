# ns-eel2 source audit: what MilkDrop 2 actually does

Every provisional case in this corpus has now been checked against the two
authoritative implementations, and the audit overturned several *pinned* cases
along the way. This document records what the sources say, with citations, and
proposes a disposition for each affected case. Case ids are never silently
changed; where a pin's *value* is wrong the case should be corrected in place
and the correction recorded here.

## References

- **ns-eel2** — the EEL2 that MilkDrop 2 actually ships:
  `WACUP/vis_milk2` @ `de9625a89e724afe23ed27b96b8e48496095b6c`, directory
  `ns-eel2/`. Files cited below as `nseel-compiler.c`, `nseel-caltab.c`,
  `nseel-eval.c`, `nseel-cfunc.c`, `asm-nseel-x86-gcc.c`.
- **modern EEL2** — `justinfrankel/WDL` @ `master`, directory `WDL/eel2/`
  (`eel2.y`, `nseel-compiler.c`, `glue_port.h`, `asm-nseel-x86-gcc.c`).
  Cited as `WDL`.

An executable extraction of the ns-eel2 preprocessor
(`preprocessCode`, verbatim) was used to produce the rewriting evidence below;
the bison tables (`nseel-caltab.c`) were replayed with a driver to confirm the
reductions.

The two references agree on most things and disagree on one (unary minus vs
`^`). Where they disagree, this corpus must pick one dialect and say so.

## Confirmed answers to the three provisional questions

### 1. `while` condition truthiness — CLOSE FACTOR. The pin was wrong.

- ns-eel2: `nseel_asm_repeatwhile` calls the condition block, does `fabs`,
  then `fcomp` against `[g_closefact]` (`g_closefact = NSEEL_CLOSEFACTOR =
  0.00001`, `ns-eel-int.h:56`), continuing only while `|v| >= 1e-5`.
- WDL: the same loop stub, and where loops are inlined the condition is
  boolified by `nseel_asm_fptobool` / `EEL_BC_FPTOBOOL`:
  `p1 = fabs(fp_pop()) >= NSEEL_CLOSEFACTOR`.
- **Disposition**: `control-flow/while-condition-is-exact-zero` is wrong.
  Correct program semantics: `n = 0.000001` then `while (n) (n = 0; x = 1)`
  never enters the body — `x` stays 0, `n` stays 1e-6. Rewrite the case
  (name it for what it now pins, e.g. `while-condition-uses-close-factor`),
  set `status: pinned`, and delete provisional open question 1 from the
  README. The README's "rules that most often catch" list also needs this
  reversal: while is NOT different from other boolean contexts.

Related facts about `while`:
- **Arity 1 in both references.** ns-eel2 registers `while` with 1 parameter
  (`nseel-compiler.c:501`); WDL special-cases `parmcnt == 1` for `while`.
  The 2-argument `while(cond, body)` of this corpus is a dialect extension
  (ours), not ns-eel2. The corpus should either say that explicitly in the
  section description or re-express the two while cases in the ns-eel2 form
  (`while (exec2(side-effects, n))`).
- The statement form `while (cond) (body)` exists only in WDL, which rewrites
  it to `while ((cond) ? (body; 1) : 0)` (`WDL nseel-compiler.c:1398`).

### 2. `-2 ^ 2` — THE REFERENCES DISAGREE. The pin matches modern EEL2 only.

- ns-eel2: the preprocessor rewrites the expression first:
  `x = -2^2` → `_set(x , -pow(2,2))` (verified by running the extracted
  `preprocessCode`), and the bison table applies UMINUS to the whole
  `pow(2,2)` → **-4**.
- WDL: `eel2.y` puts `unary_expr` *inside* `pow_expr`'s operand
  (`pow_expr: pow_expr '^' unary_expr`), so unary minus binds tighter than
  `^` → **+4**.
- No preset in the bundled Butterchurn corpus depends on either.
- **Disposition**: keep the case provisional but rewrite the note — the
  honest state is "references disagree; ns-eel2 gives -4, modern EEL2 gives
  +4; this platform implements +4, matching modern EEL2". If the corpus
  declares MilkDrop 2.x as its reference, the expected value flips to -4 and
  our engines must change.

### 3. `2 ^ 3 ^ 2` — LEFT-ASSOCIATIVE, 64. The pin was right.

- ns-eel2: `2^3^2` → `pow(pow(2,3),2)` (preprocessor, verified).
- WDL: `pow_expr: pow_expr '^' unary_expr` is left-recursive → left-assoc.
- **Disposition**: flip `operators-arithmetic/pow-left-associative` from
  provisional to pinned with the citations above.

## Overturned pins (corrections required)

| Case | Old pin | Ground truth (both references) |
| --- | --- | --- |
| `operators-logical/equality-operator-is-exact` | `==` is exact | **`==` uses the close factor.** ns-eel2 lowers `==` to `_equal`, which receives `g_closefact` and does `fabs(a-b) fcomp [g_closefact]`. WDL's `FN_EQ`/`EEL_BC_EQUAL`: `fabs(a-b) < NSEEL_CLOSEFACTOR`. Exact comparison is WDL's separate `===` operator. The README's "== is exact" rule must be inverted. |
| `functions-utility/int-truncates-toward-zero` | `int()` truncates toward zero | **`int()` is an alias of `floor()`.** ns-eel2's `nseel_lookup`: `if (!strcasecmp(nptr,"int")) nptr="floor"` (`nseel-eval.c:277`). `int(-3.7)` is -4. |
| `functions-utility/floor-int-ceil-differ` | `int()` differs from `floor()` | Same alias; the case collapses. Retire or repin to assert the alias. |
| `functions-math/sqrt-negative-is-zero` | `sqrt(-4)` is 0 | **`sqrt(-4)` is 2.** ns-eel2's `nseel_asm_sqrt` is `fabs; fsqrt`. WDL registers `sqrt_fabs`. (Our WGSL tier's special-case note in the README stays relevant for equal-edge smoothstep only.) |
| `functions-math/log-zero-is-zero` | `log(0)` is 0 | **`log(0)` is -Infinity.** ns-eel2: `fldln2; fyl2x`. WDL: raw C `log`. |
| `operators-arithmetic/pow-overflow-clamps` / `functions-math/exp-overflow-clamps-at-store` | overflow clamps to 0 | **No overflow clamp exists.** Both references register the raw C `pow`/`exp`. These two pins (and the README's "non-finite values are clamped at the statement boundary" rule, plus `variables/nonfinite-clamped-at-store`) document *our* platform's guard, not MilkDrop's. Either re-scope them as documented platform extensions or move them out of the pinned set. |
| `buffers/negative-index-write-dropped` | negative-index write is dropped | **A -1 write lands in slot 0.** ns-eel2's index normalization adds EPSILON before truncating (`_getBufferIndex`, reproduced verbatim in eel-wasm with a comment calling it "a subtle bug that exists in Milkdrop's Eel implementation"). Index -1 → slot 0. |
| `variables/pi-and-e-default` / `pi-and-e-overwritable` | `pi`/`e` are prepopulated variables | **The spellings are `$pi`/`$e`, and they are preprocessor macros, not variables.** ns-eel2 expands `$pi` → `3.141592653589793` and `$e` → `2.71828183` (nine significant digits!) in `preprocessCode`; WDL compiles `$PI` → 3.141592653589793 and `$E` → **2.718281828459045** (full precision — the references disagree on `$e`'s value). Bare `pi`/`e` are ordinary zero-initialized variables, and being macros, `$pi` cannot be assigned. The cases need both a spelling fix and a semantics fix; our engines need `$pi`/`$e`/`$phi` macro support to run them. |
| `operators-arithmetic/mod-fn-is-float` | `mod()` is the float remainder | **ns-eel2 has no user-facing `mod()` at all** — `%` lowers to the internal `_mod`, which truncates both operands to i64 (the asm eel-wasm cites). Neither reference registers `fmod()`. Whatever this case pins, it is not MilkDrop 2 behaviour; it documents the projectM/butterchurn extension surface. |

## Extension surface (cases that pin behaviour beyond both references)

These functions do not exist in ns-eel2's `fnTable1` and are not registered by
MilkDrop 2's own code: `fmod`, `frac`, `clamp`, `mix`, `lerp`, `step`,
`smoothstep`, `randint`, and variadic `min`/`max` (both references register
`min`/`max` with exactly 2 parameters — WDL's even return by reference, making
`min(x,y) = 5` legal). `rand()` takes exactly 1 argument in both references
(`rand()` with none is a syntax error); ns-eel2's `rand(n)` is
`genrand_int32() * (1/0xFFFFFFFF) * max(floor(n) clamped to >= 1)` — a float
draw times an integral bound. `$phi` (1.61803399 / 1.6180339887498948) also
exists in both.

None of this means the cases are valueless — projectM-family engines
implement this surface, and the corpus legitimately specifies it — but the
section descriptions should not present it as MilkDrop 2 behaviour, and
implementations that target only ns-eel2 parity should be able to tell the
two layers apart. Suggested mechanism: keep one corpus but tag cases with
`scope: "ns-eel2" | "modern-eel2" | "extension"` so a runner can select.

## Correct as pinned (now with citations)

- `pow-left-associative` (see above).
- `mod-op-truncates-operands`: `%` truncates to i64 in both references
  (`_mod` asm; WDL's `EEL_BC_MOD` does `fabs` + i64 remainder).
- `mod-op-by-zero`, the truthiness threshold, short-circuiting, `loop()`,
  buffers' size and separation, case-insensitivity: consistent with both
  sources.
- `invsqrt`: both references ship the **Quake fast approximation**
  (ns-eel2's `nseel_asm_invsqrt` with `negativezeropointfive`/`onepointfive`;
  WDL's docs: "fast inverse square root approximation"). This corpus's exact
  reciprocal is a documented deliberate deviation — the note already says so.
- `sign`, `abs`, `sqr`, `sigmoid`, `band`/`bor` (evaluate both sides, unlike
  `&&`/`||`): all consistent.

## Fall-through to the engine

Our own tiers implement the overturned pins (`==` exact, `int()` truncating,
while exact-zero, `-2^2` as +4 with ns-eel2 claiming -4, `pi`/`e` as variables,
sqrt/log/pow/exp guards). Each corpus correction therefore lands with a
matching engine change, or the conformance suite goes red on purpose until it
does. That is the suite doing its job — but the two should ship together, and
this document is the checklist.
