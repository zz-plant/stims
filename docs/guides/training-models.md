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

## The tools

| Goal | Command | Output |
| --- | --- | --- |
| Audio → per-frame preset state, for the whole corpus | `bun run lab:dataset` | `inputs/`, `signals/`, `states/` `.npy` + `index.jsonl` + `manifest.json` |
| Same, from real music | `bun run lab:dataset -- --audio song.wav` | one `audio-<stem>` scenario per WAV |
| Smaller files | `bun run lab:dataset -- --dtype float16 --every 2` | `<f2` arrays, every 2nd frame |
| One preset's trace, replayable bit for bit | `bun run lab:replay -- --preset <id> --record t.json [--audio song.wav]` | `TraceFile` JSON |
| What each human remix changed | `bun run lab:remix-pairs -- --sources` | JSONL of (parent, child, changes) |
| Score a preset-editing model | `bun run lab:edit-eval -- --export tasks.jsonl`, then `--score answers.jsonl --out edit-report.json` | summary on stdout; report JSON with `--out` |
| Behaviour embeddings, neighbours, 2-D map | `bun run lab:preset-map -- --dataset <dir>` | `embeddings.npy`, `neighbors.json`, `map2d.json` |
| How long each preset control remembers the audio | `bun run lab:memory-probe -- --audio song.wav` | `probe.jsonl`: memory class and linearity per (preset, column) |
| The bar an audio → controls model must clear | `bun run lab:vj-baseline -- --dataset <dir> [--features leaky] [--memory <probe dir>]` | audio R² beyond the clock, per preset and per memory class |
| Score a shader-fixing model | `bun run lab:shader-fix-bench -- --export tasks.jsonl`, then `--score answers.jsonl --out shader-report.json` | summary on stdout; report JSON with `--out` |
| Flash risk of rendered output (needs a browser) | `bun run lab:flash-audit` | per-preset WCAG 2.3.1 counts |

## Splits: always by family

MilkDrop presets were remixed for two decades; a remix and its parent often
differ by a few lines. `lab:dataset` assigns `train` / `val` / `test` per
remix family (`src/js/milkdrop/preset-lineage.ts`), and `lab:edit-eval`
draws its tasks from the held-out families. If you build your own split, split
on the `family` field. A per-preset random split puts near-copies on both
sides and inflates every score.

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
   score as a real-music one. The next section shows why the pooled number
   sits near zero.

## Memory: two kinds of audio-driven behaviour

A preset is a program of its audio signals and the clock, so how much audio
history a model of it needs can be measured rather than guessed from which
architecture trains best. `lab:memory-probe` re-runs each preset with one
signal (bass, mid, treb, their `_att` smoothings, level, beat) bumped for three
frames and records how long each control's response lasts. A zero bump
reproduces the run bit for bit, so the difference is the bump's alone.

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
  than the clock, and every model lands near 0. These are 360 of the 452
  cells scored on value, so they decide any pooled headline. Score them on
  when they change instead (event timing within a few frames); no tool here
  does that yet.
- **Ask the probe before sizing a model's memory.** Leaky integrals lift the
  seconds columns (0.34 → 0.45), and their per-frame change is predictable
  (0.74). Neither helps the persistent columns (−0.05, −0.02, −0.04): their
  difficulty is thresholds and counters, not how far back the model can
  see.

## What the state vectors cannot see

The per-frame states are the VM's equation variables (zoom, rot, warp, decay,
wave colours, q1–q32 …). They do not include what the shaders, custom waves
and shapes, or per-pixel equations draw. Consequences, measured on the full
corpus:

- `lab:preset-map` finds 719 of 2679 presets whose features are identical to
  another's; it lists them as `duplicates` rather than pretending to rank
  them.
- 13 of 35 `lab:edit-eval` test remixes change only shader text, so their
  behavioural distance from the parent reads as zero.
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
