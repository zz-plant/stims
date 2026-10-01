# Training and evaluating models with Stims

Stims is not a model, but its preset runtime is a deterministic program that
maps audio to motion and colour. That makes it a data generator and an
evaluator for models about audio-reactive visuals. This guide lists what
exists, what each tool is honest about, and what still needs hardware or a
model this repo does not ship.

Every tool below is headless, needs no GPU, and writes plain files (NumPy
`.npy`, JSONL, JSON), so the training stack can be anything. `bun run help`
has the one-line purpose of each; the docblock atop each script is its full
reference.

**Findings so far**, each detailed below:

- Score on **audio R²**, not R². About a third of presets run the same
  function of time on every song, and a clock-only model scores near 1 on
  them.
- For a preset you have the code for, **the equations are the exact model**:
  running them on a new song is perfect, and `lab:dataflow` reads which
  audio reaches what without running anything. Learning earns its place
  where there are no equations yet: writing, editing, fixing and remixing
  presets.
- On known presets, **gradient-boosted trees beat every network** (audio R²
  0.60 against 0.48 for the best, a selective recurrence), because presets
  are threshold programs.
- On presets from unseen families, nothing learned from other presets
  transfers. The preset's own equations help more than a network: feeding
  each control only the signals it reads gains +0.12.
- **Stateful controls** (beat counters, toggles) defeat every regression, so
  they are scored on when they change. A classifier that predicts *when* a
  jump happens times them (event F1 0.44, against 0 for every value model).
- **Song-aware preset picking** beats a fixed ranking within a musical
  style, but not across styles.
- **Equations can be recovered from behaviour**: 41% of memoryless audio
  controls come back exactly, most in 4 terms or fewer.

## The tools

| Goal | Command | Output |
| --- | --- | --- |
| Audio → per-frame preset state, for the whole corpus | `bun run lab:dataset` | `inputs/`, `signals/`, `states/` `.npy` + `index.jsonl` + `manifest.json` |
| Same, from real music | `bun run lab:dataset -- --audio song.wav` | one `audio-<stem>` scenario per WAV |
| Smaller files | `bun run lab:dataset -- --dtype float16 --every 2` | `<f2` arrays, every 2nd frame |
| One preset's trace, replayable bit for bit | `bun run lab:replay -- --preset <id> --record t.json [--audio song.wav]` | `TraceFile` JSON |
| What each human remix changed | `bun run lab:remix-pairs -- --sources` | JSONL of (parent, child, changes) |
| Score a preset-editing model | `bun run lab:edit-eval -- --export tasks.jsonl`, then `--score answers.jsonl --out edit-report.json` | summary on stdout, including audio edits read from the equations (recall of the human remix's audio dependency changes); report JSON with `--out` |
| Behaviour embeddings, neighbours, 2-D map | `bun run lab:preset-map -- --dataset <dir>` | `embeddings.npy`, `neighbors.json`, `map2d.json` |
| Which audio signals reach each column and drawn program, from the equations alone | `bun run lab:dataflow -- --all --out labels.json` | per-preset labels: tier, audio columns and their signals, history |
| Check a dataset's measured labels against the equations | `bun run lab:dataflow -- --dataset <dir>` | column and preset confusion tables, soundness violations |
| How long each preset control remembers the audio | `bun run lab:memory-probe -- --audio song.wav` | `probe.jsonl`: memory class and linearity per (preset, column) |
| The bar an audio → controls model must clear | `bun run lab:vj-baseline -- --dataset <dir> [--features leaky] [--memory <probe dir>]` | audio R² beyond the clock, per preset and per memory class; event F1 of jumps (model and clock oracle) |
| Score a shader-fixing model | `bun run lab:shader-fix-bench -- --export tasks.jsonl`, then `--score answers.jsonl --out shader-report.json` | summary on stdout; report JSON with `--out` |
| Flash risk of rendered output (needs a browser) | `bun run lab:flash-audit` | per-preset WCAG 2.3.1 counts |

## Splits: always by family

MilkDrop presets were remixed for two decades; a remix and its parent often
differ by a few lines. `lab:dataset` assigns `train` / `val` / `test` per
remix family (`src/js/milkdrop/preset-lineage.ts`), and `lab:edit-eval`
draws its tasks from the held-out families. If you build your own split, split
on the `family` field. A per-preset random split puts near-copies on both
sides and inflates every score.

## Reading the equations: `lab:dataflow`

A preset is a small program, so which inputs each value can depend on is a
question for program analysis, not for a model.
`src/js/milkdrop/preset-dataflow.ts` interprets a compiled preset's
equations over dependency sets instead of numbers. It follows the VM's own
rules:
- built-in controls reset every frame, while `q`/`t`/user variables and
  `megabuf` persist;
- `init` runs with silent audio;
- a conditional write depends on its condition;
- waves, shapes and per-pixel code feed the shared `q` bank back to the
  next frame;
- one `rand()` stream serves every program, so a single audio-gated call
  makes all of them follow the audio.

For every canonical column it reports:
- the audio signals that can reach it;
- whether it carries history or accumulates;
- whether it is constant, clockwork or audio-driven.

For every drawn program (the per-pixel mesh, enabled custom waves and
shapes, shader uniforms) it reports the audio signals that reach what that
program draws.

How far to trust it, measured against `lab:dataset` exports:

| Export | Soundness (differs by song, but no path found) | Precision (audio path found, and it differs by song) |
| --- | --- | --- |
| 158 presets × 32 songs | 0 of 14,004 cells | 932 of 980 |
| same presets, 4 unfamiliar-style songs (one per style) | 0 | 922 of 980 |
| 2,445 held-out presets × 4 probes | 1 of 215,160 (a documented 5e-4 wobble) | 11,797 of 13,532 |

It is conservative by design:
- a path the audio never exercised on those songs still counts, which is
  the precision gap;
- shaders count only by the audio uniform names they read.

Uses:

- **Labels with no rendering.** `lab:dataflow --all` sorts all 2,679 presets
  in 22 s:
  - driven: the audio moves something drawn (2,232);
  - waveform-only: only a drawn waveform shows the audio (374);
  - none (73).

  The catalog's quality score and its `collection:audio-reactive` tag both
  read these tiers.
- **Checking measured labels.** `lab:dataflow --dataset <dir>` compares the
  analysis with what an export measured. No preset measured as reactive
  lacks an audio path. The measured-clockwork presets that do have one (8 of
  158, 160 of 2,445) have an effect under the 10% threshold on those songs.
- **Scoring edits.** `lab:edit-eval` turns each preset's dependencies into
  edges (`zoom ← bass`, `shader ← beat`). It scores an answer on the share
  of the human remix's audio edits it reproduces.
- **Choosing model inputs.** The code-conditioned models below feed each
  column only the signals it reads.

## Recipe: audio–visual sync pairs

A sync pair is a window of audio and the visual response it caused. The
dataset gives it to you frame-aligned:

1. Export with real music, keeping the synthetic probes as controls:

   ```bash
   bun run lab:dataset -- --out scratch/sync --audio music/ --scenarios bass-pulse,full-mix --frames 1800
   ```

   Every WAV runs through the live audio stack offline, so `inputs/` holds the
   bytes the visualizer's analyser would have produced (512 spectrum bins then
   1024 waveform samples per frame at 60 fps) and `signals/` the merged band
   levels the VM stepped with.

2. Row `f` of `inputs/<scenario>.npy`, `signals/<scenario>.npy` and every
   `states/<id>__<scenario>.npy` is the same frame. Positive pairs are aligned
   windows; negatives are the same preset's states against a time-shifted or
   different scenario's audio. Keep shifts longer than the smoothing: the
   `_att` bands trail the raw ones, so a shift of a few frames still
   correlates and makes a hard negative, not an easy one.

3. Load them (NumPy only):

   ```python
   import json, numpy as np
   from pathlib import Path

   root = Path("scratch/sync")
   manifest = json.loads((root / "manifest.json").read_text())
   rows = [json.loads(line) for line in (root / "index.jsonl").read_text().splitlines()]

   def load(row):
       audio = np.load(root / "inputs" / f"{row['scenario']}.npy")
       signals = np.load(root / "signals" / f"{row['scenario']}.npy")
       states = np.load(root / row["file"])
       columns = row.get("columns", manifest["states"]["columns"])
       return audio, signals, states, columns

   train = [r for r in rows if r["split"] == "train" and r["status"] == "ok"]
   audio, signals, states, columns = load(train[0])
   assert len(audio) == len(signals) == len(states)
   ```

   `--shard k/n` writes `index-<k>-of-<n>.jsonl` and `manifest-<k>-of-<n>.json`
   instead; concatenate the index files. float16 exports load the same way
   (`np.load` reads `<f2`); rows whose values exceeded ±65504 carry a
   `float16Clamped` count.

4. Measure a baseline before training, and score it on what the audio does.
   About a third of the corpus is clockwork: those presets run the same
   function of time on every stimulus, so plain R² rewards memorising the
   clock (a clock-only model scores near 1 on them). `lab:vj-baseline`
   therefore reports **audio R²** as its headline. On columns whose variance
   is at least 10% audio-driven (the part that differs between stimuli at
   the same frame), it measures the share of a held-out stimulus's departure
   from the clock oracle (the training stimuli's mean trajectory) that the
   model predicts: 0 is the clock, 1 is perfect. Clockwork presets are
   counted and left out.

   Measured so far:

   | Training audio | Model | Audio R² |
   | --- | --- | --- |
   | The four built-in probe scenarios (whole corpus, 1714 audio-reactive presets, 787 clockwork) | clock + lagged audio (`lab:vj-baseline`) | −0.04 |
   | 24 varied synthetic songs, 4 held out (158 presets) | clock + lagged audio | 0.19 |
   | same | leaky integrators, spectrum bands and onsets, per-preset ridge | 0.33 |
   | 11 real-music clips of 30 s, each held out in turn (115 presets, 73 audio-reactive) | clock + lagged audio | −0.02 |
   | same | clock + lagged audio + leaky integrators (`--features leaky`) | 0.02 |

   Each probe isolates one band, so a model fitted on three cannot say
   anything about the fourth. Use the probes for smoke tests, and many
   varied songs (`--audio`) to learn or evaluate audio mappings. A learned
   model has to beat the linear rows on the same songs.

   Real music scored far below the synthetic songs. The two runs differ in
   more than realism: the real clips trained on 10 songs per fold rather than
   20, eight of the 11 come from one DJ mix, and `--features leaky` lacks the
   spectrum bands and onsets of the 0.33 model. Do not quote a synthetic-song
   score as a real-music one. The unfamiliar-styles column in the next
   section points the same way (ridge+ falls from 0.33 to 0.17), and the
   memory section after it shows why the pooled linear number sits near zero.

## Learned models so far

[`experiments/neural-vj/`](../../experiments/neural-vj/README.md) trains and
scores models on CPU against the baselines above: 158 presets (115
audio-reactive) on 24 varied synthetic training songs, scored on 4 held-out
songs and on 4 songs in styles the song generator never makes. The raw
results are in `experiments/neural-vj/results/`. Audio R² throughout.

**Known presets, songs they have never heard:**

| Model | Held-out songs | Unfamiliar styles | Per preset vs ridge+ (95% CI) |
| --- | --- | --- | --- |
| lagged audio, ridge | 0.19 | 0.15 | −0.04 |
| ridge+: leaky integrators, spectrum bands, onsets | 0.33 | 0.17 | — |
| dilated TCN, ridge readout | 0.37 | 0.18 | ≈ 0 |
| diagonal state space, ridge readout | 0.35 | 0.11 | ≈ 0 |
| minGRU (selective recurrence), ridge readout, 2 seeds | 0.48 | 0.26 | +0.02 [+0.00, +0.05] |
| LightGBM on the ridge+ features | 0.60 | 0.46 | +0.05 [+0.03, +0.09] |

Gradient-boosted trees on the same inputs as ridge+ beat every network, most
of all on unfamiliar music. Scored against another song's audio, they fall to
−0.63, so the gain is real use of the audio. Presets behave like threshold
programs (`if(bass > x, …)`), which trees represent and linear readouts
cannot. Among networks, a selective recurrence (minGRU) does best and
transfers best. Refitting a network's readout in closed form (per-preset
ridge) beat the readout trained with it every time. Pretraining the trunk on
240 audio-only songs added about 0.04. Feedback and border columns stay near 0
for every model. Border columns are audio-driven all the same: the memory
probe below moves 33 border cells, 60% of them for more than four seconds, so
what defeats the models there is long-lived state, not missing inputs.

**Presets from families the model never saw**, fitted from a few calibration
songs (26 audio-reactive of 38):

| Method | 4 calibration songs | 1 calibration song |
| --- | --- | --- |
| no calibration (the average preset) | −0.43 | −0.58 |
| learned features, readout shrunk toward the training presets' mean | −0.00 | −0.29 |
| average of that and the same on hand features | +0.11 | −0.13 |
| learned features with all 20 of the preset's songs (ceiling) | 0.18 | — |

A new preset's audio response cannot be predicted from other presets'
behaviour alone, and four songs of its own only just beat the clock.

**Conditioned on the preset's equations.** `run_codecond.py` gives each
column only the signals `lab:dataflow` says it reads, plus quartile hinges
and onsets for each, and leaky integrals of them when the column carries
history. Same split, songs and metric as above:

| Method | 4 calibration songs | 1 calibration song |
| --- | --- | --- |
| hand features, all signals (the row above's baseline) | −0.12 | −0.27 |
| the same new basis over every signal | −0.13 | −0.28 |
| **the basis restricted to the column's own signals** | −0.03 | −0.23 |
| average of that and the learned features | **+0.12** | −0.20 |
| restricted, with all 20 of the preset's songs (ceiling) | 0.10 | — |

Restriction alone gains +0.12 over the hand baseline at four songs, 95% CI
[+0.05, +0.26], and matches the learned features with no network. The
basis without the restriction gains nothing. Averaged with the learned
features it edges the previous best (+0.12 against +0.11). With one song
every method stays below the clock. A prior averaged over training columns
with the same dependency signature is worse than the global one with no
calibration at all (−0.76 against −0.60): the equations say which signals
matter, not a column's sign or scale.

The larger point: a preset's equations *are* its exact model. Running them
on the new song (the VM does it in real time) gives audio R² 1. A learned
model of an unseen preset is useful only where the equations are
unavailable or too slow, and the structure they expose is worth more than
the network trained on top.

Caveats: four test songs (the intervals resample presets, not songs),
synthetic audio, one configuration per model.

## Memory: two kinds of audio-driven behaviour

A preset is a program of its audio signals and the clock, so how much audio
history a model of it needs can be measured rather than guessed from which
architecture trains best. `lab:memory-probe` re-runs each preset with one
signal (bass, mid, treb, their `_att` smoothings, level, beat) bumped for three
frames and records how long each control's response lasts. A zero bump
reproduces the run bit for bit, so the difference is the bump's alone.
`lab:dataflow` answers the static half from the equations: which signals a
column can depend on, and whether it carries history at all.

On 120 presets sampled from the corpus and driven by two real-music clips, a
bump moved 423 (preset, column) cells in 67 presets. 61% of them forget it
within four seconds (22% the moment the bump ends); 40% remember it for longer
or until the end of the run. 31 of the 67 presets have at least one such
column. The long memories are beat-detector counters and toggles
(`index = mod(index + is_beat, 4)`) and accumulated phase
(`x = x + 0.01*bass`): a text search of the 2,686 bundled `.milk` files finds
the adaptive-threshold beat detector in 389 and a per-frame variable that adds
audio to itself in 524.

Scored with `lab:vj-baseline -- --memory <probe dir>` on the 11-clip dataset
(median audio R² per preset column; cell counts differ between targets because
a column's per-frame change can be audio-driven when its value is not):

| Memory | lags, value | leaky, value | leaky, per-frame change |
| --- | --- | --- | --- |
| Bounded: instant | 0.38 (61) | 0.39 (61) | 0.09 (82) |
| Bounded: seconds | 0.34 (26) | 0.45 (26) | 0.74 (115) |
| Stateful: long (over 4 s) | −0.05 (32) | −0.03 (32) | 0.08 (33) |
| Stateful: persistent | −0.05 (128) | −0.02 (128) | −0.04 (133) |
| Stateful: gated (audio-driven, but no bump moved it) | −0.10 (200) | −0.08 (200) | 0.01 (224) |

"Gated" columns are mostly threshold-driven counters: a half-standard-deviation
bump rarely crosses an adaptive threshold, yet different songs leave the
counter in different states.

What follows:

- **Score the two groups separately.** Bounded columns are a well-posed
  regression, and the linear model already explains 0.39 of an instant
  column's audio-driven motion and 0.74 of a seconds column's per-frame
  change. A learned model has to beat those rows, on the same cells.
- **Do not score stateful columns on their value.** One missed or extra beat
  changes a counter's value for the rest of the song, so a model that toggles
  on exactly the right beats but starts from the other state scores worse
  than the clock, and every linear variant lands near 0. These are 360 of the
  452 cells scored on value, so they decide any pooled headline. Trees
  represent thresholds, so they are the model to test on these cells, but
  score them on when the cells change. `lab:vj-baseline` now reports event
  F1 for every audio-driven cell: a jump over a quarter of the cell's
  range is an event, a predicted one within 3 frames counts. On the
  160-preset, 32-song set, 501 cells jump. The linear model times them well
  (F1 over 0.5) on 108 (the clock oracle on 31): cells that jump with
  the audio directly. On the other ~340, counters and gated toggles, neither
  times a single jump. A LightGBM event classifier clears that bar (event
  F1 0.44 on cells with history; see the next section).
- **Ask the probe before sizing a model's memory.** Leaky integrals lift the
  seconds columns (0.34 → 0.45), and their per-frame change is predictable
  (0.74). Neither helps the persistent columns (−0.05, −0.02, −0.04): their
  difficulty is thresholds and counters, not how far back the model can
  see.

## Beyond imitation: timing, matching, recovering equations

Three experiments in [`experiments/neural-vj/`](../../experiments/neural-vj/README.md),
on the same 160-preset, 32-song export (24 training songs, 4 validation,
4 test unless noted). Raw results are in `experiments/neural-vj/results/`.

**Timing the jumps** (`run_events.py`). The cells are 458 audio-driven
columns that jump: a jump is over a quarter of the column's training range,
5 or more in training and at least one in test. The models:
- the value models predict the column, and their jumps are read off the
  prediction;
- the event classifier is LightGBM on the same features plus their
  one-frame change, predicting "jumps at this frame". Its threshold is tuned
  on the validation songs, with one event kept per 3-frame window.

Event F1 on the test songs (median, with the share of cells over 0.5):

| Cells | Clock oracle | Ridge | LightGBM, value | **LightGBM, events** |
| --- | --- | --- | --- | --- |
| all 458 | 0.00 (9%) | 0.00 (26%) | 0.12 (34%) | **0.61 (58%)** |
| 348 with history (counters, toggles) | 0.00 (5%) | 0.00 (9%) | 0.00 (16%) | **0.44 (46%)** |
| 110 memoryless | 0.16 (20%) | 0.74 (81%) | 0.94 (90%) | 0.93 (95%) |

Predicting when a counter ticks is learnable even though its value is not:
a counter's value depends on how many ticks came before, its timing on the
audio now. Per cell, the classifier beats LightGBM-on-value by a median of
+0.06 [+0.02, +0.14] and wins 62% of cells. The gap is concentrated in the
stateful cells, where every value model scores 0.

**Song-aware preset picking** (`run_match.py`). `fit[p, s]` is the share of
preset p's motion on song s that departs from its clock-only trajectory. On
117 reacting presets the variance of fit splits into:
- 62% preset: some presets react to anything;
- 11% song;
- 27% interaction.

The interaction is real: computed on each half of every song, it agrees at
r = 0.47. Ranking presets for 8 held-out songs:

| Ranking | Spearman | Top-10 precision |
| --- | --- | --- |
| fixed (each preset's mean fit) | 0.91 | 0.72 |
| linear map from 39 song statistics, through each preset's dataflow profile | 0.91 | 0.71 |
| mean fit on the 3 training songs nearest in those statistics | **0.96** (7 of 8 songs won) | **0.78** |

On the 4 unfamiliar-style songs, nearest songs gains nothing (0.59 against
0.60). The fixed ranking itself falls to 0.60, so which presets react most
changes with style. A song-aware autoplay needs training songs covering the
styles it will hear, and 24 synthetic songs are too few for the linear map.

**Recovering equations** (`run_symbolic.py`). For the 138 audio-driven
columns `lab:dataflow` labels memoryless, sparse regression searches a
library of MilkDrop-shaped terms:
- signals and their squares and pair products;
- `above(signal, threshold)`;
- `sin`/`cos` of time at the column's own clock frequencies, and their
  products with signals.

It keeps the sparsest fit within 0.001 validation R² of the best.

| Signals offered | Median R² (test) | Exact (R² > 0.999) | R² > 0.9 | Median terms |
| --- | --- | --- | --- | --- |
| the ones `lab:dataflow` says it reads | 0.983 | 41% | 79% | 10 |
| all 13 | 0.988 | 40% | 82% | 94 |

The 56 exact recoveries have a median of 4 terms, and 27 have 3 or fewer,
for example `warp = 2*bass` and `zoomexp = 1 + 50*mid_att`. Given every
signal, the regression finds 98% of the signals the equations read, but
picks extras too (precision 0.44). Given the analysis's signals, it is as
accurate with a tenth of the terms. The misses need forms the library lacks:
ratios like `bass/bass_att`, `mod` and discrete steps. Adding those, or
replacing the library with a genetic search over the VM's operators, is the
next step.

## What the state vectors cannot see

The per-frame states are the VM's equation variables (zoom, rot, warp, decay,
wave colours, q1–q32 …). They do not include what the shaders, custom waves
and shapes, or per-pixel equations draw. `lab:dataflow` says statically
which audio reaches those programs, but not what they draw. Consequences,
measured on the full corpus:

- `lab:preset-map` finds 719 of 2679 presets whose features are identical to
  another's; it lists them as `duplicates` rather than pretending to rank
  them.
- 13 of 35 `lab:edit-eval` test remixes change only shader text, so their
  behavioural distance from the parent reads as zero. The audio-edit score
  still sees a change in which audio uniforms a shader reads, but nothing
  else about it.
- `lab:shader-fix-bench` scores compilation and local edits, not whether the
  fixed shader draws what its author intended.

Closing those gaps needs pixels. The agent render hook
(`window.__STIMS_AGENT_RENDER_FRAMES__`, see
[`agents/browser-automation.md`](../agents/browser-automation.md)) renders
frames deterministically when passed a `startTime`, and `lab:flash-audit`
and the thumbnail and clip generators are built on it, but capture on a
software rasterizer is slow. A GPU host is the practical way to render the corpus to video, and
`parity:capture` / `parity:diff` against native projectM references is the
way to score a shader fix on what it draws.

## Determinism

The VM seeds its RNG from the preset id, the synthetic scenarios are pure
functions of time, and audio files are analysed deterministically, so the same
flags and files write the same arrays and index rows. The manifest is the one
exception: it records a `createdAt` timestamp, so hash the `.npy` and `.jsonl`
files, not the whole directory, when checking a rerun. Rendered captures are deterministic too
once `startTime` is passed: that resets the VM, the GPU feedback buffers, and
the audio signal tracker together.

## Licensing

The Stims code is public domain (see `LICENSE`). The presets are not Stims'
to license: they are works by their credited authors, mostly released without
any explicit licence, and the bundled libraries note their upstream terms in
`public/milkdrop-presets/libraries/*/README.md`. Credit authors (every index
row carries `author`), keep the `family` lineage with any derived data, and
decide for yourself whether your use of the corpus, and of weights trained on
it, fits those terms before redistributing either.
