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
| The bar an audio → controls model must clear | `bun run lab:vj-baseline -- --dataset <dir>` | per-preset held-out R² |
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

4. Measure a baseline before training. `lab:vj-baseline` fits, per preset,
   ridge regressions from a clock basis and from clock + lagged audio to the
   VM controls, scored on a held-out scenario. On the synthetic scenarios
   the clock alone is the stronger of the two (median R² 0.53 against 0.42):
   linear audio features fitted on three stimuli do not transfer to a
   fourth. A learned model has to beat the better of the two per preset.

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
