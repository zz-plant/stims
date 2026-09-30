# Neural VJ experiments

Can a learned model predict how a MilkDrop preset's controls respond to music
it has never heard? These scripts answer that on CPU, against honest
baselines, from `lab:dataset` exports. The findings are summarised in
[`docs/guides/training-models.md`](../../docs/guides/training-models.md#learned-models-so-far);
the raw numbers are in [`results/`](results/).

Everything is scored with **audio R²** (`vj_lab.score_audio`, the same metric
`lab:vj-baseline` reports): the share of each preset's *between-song*
behaviour a model predicts beyond the clock oracle, on columns at least 10%
audio-driven. Clockwork presets (the same function of time on every song,
about a third of the corpus) are counted and left out.

## Files

| File | What it is |
| --- | --- |
| `synth_songs.py` | Varied synthetic songs (tempo, drums, bass, chords, arrangement), one seed per song |
| `synth_ood.py` | Four out-of-distribution styles the song generator never makes: ambient, breakbeat, sparse hits, noise wash |
| `vj_lab.py` | Data loading, audio features, the metric, ridge / leaky-integrator / reservoir baselines, paired bootstrap statistics |
| `vj_models.py` | Shared-trunk networks (dilated TCN, diagonal state space, minGRU) with per-preset readouts |
| `train_job.py`, `pretrain_job.py` | One network per process (supervised; audio-only future-spectrum pretraining) |
| `run_known.py` | Phase 1: known presets, held-out songs, the full model ladder plus LightGBM |
| `run_fewshot.py` | Phase 2: presets from unseen families, fitted from 1 or 4 calibration songs |
| `run_codecond.py` | Phase 3: the same, with each column's features and prior chosen from the preset's equations (`lab:dataflow --all` labels) |
| `verify_lgbm.py` | Independent refit of the LightGBM result and a permutation (mismatched-audio) leakage check |

## Reproduce

About two hours on four CPU cores. Exports are large (0.8 GB for the main set) and live in the gitignored `scratch/`.

```bash
python -m venv .venv && .venv/bin/pip install -r experiments/neural-vj/requirements.txt
cd experiments/neural-vj
python synth_songs.py 32 16 ../../scratch/nvj/songs          # 24 train, 4 val, 4 test songs
python synth_ood.py 16 ../../scratch/nvj/ood_songs
# 240 audio-only songs for pretraining: synth_songs.song(5000 + k, 16) for k in range(240), split into 3 dirs
cd ../..
bun run lab:dataset -- --out scratch/nvj/data --audio scratch/nvj/songs --frames 900 --only <preset ids> --dtype float16
bun run lab:dataset -- --out scratch/nvj/ood  --audio scratch/nvj/ood_songs --frames 900 --only <same ids> --dtype float16
cd experiments/neural-vj
../../.venv/bin/python run_known.py ../../scratch/nvj/data --ood ../../scratch/nvj/ood --pre <pretraining export dirs>
../../.venv/bin/python run_fewshot.py ../../scratch/nvj/data --kind mingru
(cd ../.. && bun run lab:dataflow -- --all --out scratch/nvj/labels.json)
../../.venv/bin/python run_codecond.py ../../scratch/nvj/data ../../scratch/nvj/labels.json --bank jobs_fewshot/trunk.npz
```

The published results used 160 randomly sampled presets (seed 7) whose
four-scenario `lab:dataset` rows were all `ok`; 158 remained after dropping two
whose VM output is non-finite. `lab:dataset` now gives those runs status `nan`
itself.

## Operational notes

- Each `lab:dataset` process can reach 4–7 GB; on a 15 GB machine run at most two at once.
- Networks train fastest as one single-thread process per core (`--parallel 4 --threads 1`): small matrices scale poorly across threads.
- `run_known.py` skips any job whose output already exists, so a rerun after an interruption resumes.
