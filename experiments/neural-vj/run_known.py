"""Phase 1 — known presets, held-out songs: what does each model learn about the AUDIO?

  python run_known.py DATA_DIR --ood OOD_DIR --pre pre/a pre/b pre/c [--steps N] [--parallel 4]

Half the corpus is clockwork (controls are the same function of time on
every song), so plain R² rewards memorising the clock. Everything here is
scored with audio R² (vj_lab.score_audio): the share of between-song
variation a model explains beyond the clock oracle (each preset's mean
trajectory over the training songs), on columns ≥10% audio-driven.
Models fit that residual too.

Networks run as separate single-thread processes (train_job.py,
pretrain_job.py), `--parallel` at a time; finished jobs are skipped on
re-run, so a container restart loses only the jobs in flight.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

import vj_lab as L

ap = argparse.ArgumentParser()
ap.add_argument('data')
ap.add_argument('--ood', default=None)
ap.add_argument('--pre', nargs='*', default=[])
ap.add_argument('--steps', type=int, default=800)
ap.add_argument('--pre-steps', type=int, default=600)
ap.add_argument('--parallel', type=int, default=4)
ap.add_argument('--threads', type=int, default=1)
ap.add_argument('--audio-min', type=float, default=0.1)
ap.add_argument('--jobs-dir', default='jobs_known')
ap.add_argument('--out', default='results_known.json')
ap.add_argument('--skip-deep', action='store_true')
args = ap.parse_args()
t_start = time.time()
PY = sys.executable  # the interpreter running this script (the one with torch)
HERE = Path(__file__).resolve().parent
jobs_dir = Path(args.jobs_dir)
jobs_dir.mkdir(exist_ok=True)

d = L.Data(args.data)
o = L.Data(args.ood) if args.ood else None
if o is not None:
    common = [p for p in d.presets if p in set(o.presets)]
    d.subset(common)
    o.subset(common)
S = d.S
train, val, test = list(range(S - 8)), list(range(S - 8, S - 4)), list(range(S - 4, S))
y, mu, sd, moving = L.standardize_targets(d.states, train)
del d.states
mean_traj, share = L.time_profile(y, train)
audio_cols = moving & (share >= args.audio_min)
scored = audio_cols.any(1)
print(f'{d.P} presets × {S} songs × {d.F} frames; songs train {len(train)} / val {len(val)} / test {len(test)}')
print(f'audio-driven (≥{args.audio_min:.0%}) columns: {int(audio_cols.sum())} of {int(moving.sum())} moving, '
      f'in {int(scored.sum())} presets; the other {int((~scored).sum())} presets are clockwork and are not scored')
audio_stats = d.audio_stats(train)
audio = d.audio(stats=audio_stats)
clock = np.broadcast_to(d.clock, (S, d.F, d.clock.shape[1]))
y_test = y[:, test]
ood = None
if o is not None:
    ood = {'songs': o.songs, 'audio': o.audio(stats=audio_stats), 'clock': np.broadcast_to(o.clock, (o.S, o.F, o.clock.shape[1])),
           'y': np.stack([np.clip((o.states[p].astype(np.float32) - mu[p]) / sd[p], -10, 10) for p in range(d.P)]).astype(np.float16)}
    print(f'OOD songs: {o.songs}')
    del o
results, preds, ood_preds = {}, {}, {}


def report(name, pred_test, pred_ood=None, extra=None, keep=False):
    per, col = L.score_audio(pred_test, y_test, mean_traj, audio_cols)
    results[name] = {'per_preset': per, 'groups': L.group_scores(col, d.columns), **(extra or {})}
    if keep:
        preds[name] = np.asarray(pred_test, np.float16)
    line = f'  {name:22s} audio R² {np.nanmedian(per):6.3f}'
    if pred_ood is not None:
        per_o, _ = L.score_audio(pred_ood, ood['y'], mean_traj, audio_cols)
        results[name]['ood'] = per_o
        if keep:
            ood_preds[name] = np.asarray(pred_ood, np.float16)
        line += f'   OOD {np.nanmedian(per_o):6.3f}'
    print(line + f'   ({time.time() - t_start:.0f}s)', flush=True)


def ridge_readout(feats, feats_ood=None, per_preset_lambda=True):
    """Per-preset ridge on the residual (target − clock oracle); λ chosen on
    the validation songs' audio columns. Returns full predictions."""
    r = L.SharedRidge(feats, train)
    Xv, Xt = r.design(feats, val), r.design(feats, test)
    Xo = r.design(feats_ood, list(range(len(feats_ood)))) if feats_ood is not None else None
    pred = np.broadcast_to(mean_traj[:, None], y_test.shape).astype(np.float32)
    pred_ood = np.broadcast_to(mean_traj[:, None], ood['y'].shape).astype(np.float32) if Xo is not None else None
    fitted = np.flatnonzero(scored)
    val_losses = np.zeros((len(fitted), len(L.LAMBDAS)))
    weights = []
    for i, p in enumerate(fitted):
        res = (y[p, train].astype(np.float32) - mean_traj[p]).reshape(-1, d.C)
        W = r.weights(res, L.LAMBDAS)
        weights.append(W)
        res_v = (y[p, val].astype(np.float32) - mean_traj[p]).reshape(-1, d.C)[:, audio_cols[p]]
        for k, lam in enumerate(L.LAMBDAS):
            val_losses[i, k] = ((Xv @ W[lam][:, audio_cols[p]] - res_v) ** 2).mean()
    choice = val_losses.argmin(1) if per_preset_lambda else np.full(len(fitted), val_losses.mean(0).argmin())
    for i, p in enumerate(fitted):
        W = weights[i][L.LAMBDAS[choice[i]]]
        pred[p] += (Xt @ W).reshape(len(test), d.F, d.C)
        if Xo is not None:
            pred_ood[p] += (Xo @ W).reshape(pred_ood.shape[1:])
    return pred, pred_ood


def both(fn):
    return fn(audio, clock), (fn(ood['audio'], ood['clock']) if ood else None)


# ---------- reference and linear rungs ----------
oracle = np.broadcast_to(mean_traj[:, None], y_test.shape)
report('clock oracle', oracle, np.broadcast_to(mean_traj[:, None], ood['y'].shape) if ood else None)
report('lag-ridge', *ridge_readout(*both(lambda a, c: np.concatenate([c, L.lagged(a[..., :13])], -1)), per_preset_lambda=False))
report('ridge+', *ridge_readout(*both(lambda a, c: np.concatenate([c, a, L.leaky(a)], -1))), keep=True)
report('reservoir', *ridge_readout(*both(lambda a, c: np.concatenate([c, a, L.reservoir(a, rho=0.9, in_scale=0.3)], -1))), keep=True)


# ---------- gradient-boosted trees ----------
def lgbm_rung(every=3, rounds=400):
    """LightGBM per (preset, audio column) on the ridge+ features, fitted to the
    residual. Trees see the same inputs as ridge+, so any gain is nonlinearity:
    thresholds such as `if(bass > 1.3, …)` that a linear readout cannot express.
    Every `every`-th training frame (neighbouring frames are nearly duplicates);
    early stopping on the validation songs; one binned dataset reused for all
    832 targets via set_label."""
    import lightgbm as lgb
    feats = np.concatenate([clock, audio, L.leaky(audio)], -1).astype(np.float32)
    feats_o = np.concatenate([ood['clock'], ood['audio'], L.leaky(ood['audio'])], -1).astype(np.float32) if ood else None
    Xtr = feats[train][:, ::every].reshape(-1, feats.shape[-1])
    Xv = feats[val][:, ::every].reshape(-1, feats.shape[-1])
    Xt = feats[test].reshape(-1, feats.shape[-1])
    Xo = feats_o.reshape(-1, feats.shape[-1]) if ood else None
    params = {'objective': 'l2', 'learning_rate': 0.05, 'num_leaves': 15, 'min_data_in_leaf': 40, 'feature_fraction': 0.5,
              'bagging_fraction': 0.8, 'bagging_freq': 1, 'lambda_l2': 1.0, 'num_threads': 4, 'verbose': -1, 'max_bin': 63}
    dtr = lgb.Dataset(Xtr, label=np.zeros(len(Xtr)), params=params, free_raw_data=False).construct()
    dv = lgb.Dataset(Xv, label=np.zeros(len(Xv)), reference=dtr, free_raw_data=False).construct()
    pred = np.broadcast_to(mean_traj[:, None], y_test.shape).astype(np.float32)
    pred_ood = np.broadcast_to(mean_traj[:, None], ood['y'].shape).astype(np.float32) if ood else None
    t0, n, rounds_used = time.time(), 0, []
    for p in np.flatnonzero(scored):
        res_tr = (y[p, train].astype(np.float32) - mean_traj[p])[:, ::every]
        res_v = (y[p, val].astype(np.float32) - mean_traj[p])[:, ::every]
        for c in np.flatnonzero(audio_cols[p]):
            dtr.set_label(res_tr[..., c].reshape(-1))
            dv.set_label(res_v[..., c].reshape(-1))
            model = lgb.train(params, dtr, rounds, valid_sets=[dv], callbacks=[lgb.early_stopping(30, verbose=False)])
            rounds_used.append(model.best_iteration)
            pred[p, :, :, c] += model.predict(Xt, num_iteration=model.best_iteration).reshape(len(test), d.F)
            if ood:
                pred_ood[p, :, :, c] += model.predict(Xo, num_iteration=model.best_iteration).reshape(pred_ood.shape[1], d.F)
            n += 1
    print(f'    lightgbm: {n} models, median {int(np.median(rounds_used))} rounds, {time.time() - t0:.0f}s', flush=True)
    return pred, pred_ood


# ---------- network jobs ----------
def run_jobs(jobs, parallel):
    """jobs: (name, argv, deps, output). Skips jobs whose output exists; runs up to `parallel` at once."""
    done = {name for name, _, _, out in jobs if Path(out).exists()}
    if done:
        print(f'    already done (skipped): {sorted(done)}')
    pending = [j for j in jobs if j[0] not in done]
    running = {}
    while pending or running:
        for j in list(pending):
            name, argv, deps, out = j
            if len(running) < parallel and all(dep in done for dep in deps):
                log = open(jobs_dir / f'{name}.log', 'w')
                running[name] = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT)
                pending.remove(j)
                print(f'    started {name} ({time.time() - t_start:.0f}s)', flush=True)
        for name, proc in list(running.items()):
            if proc.poll() is not None:
                if proc.returncode != 0:
                    raise SystemExit(f'job {name} failed (see {jobs_dir / f"{name}.log"})')
                done.add(name)
                del running[name]
                print(f'    finished {name} ({time.time() - t_start:.0f}s)', flush=True)
        time.sleep(5)


def job(name, kind, layers, seed, rank=None, init=None):
    out = jobs_dir / f'{name}.npz'
    cfg = {'data': args.data, 'ood': args.ood, 'kind': kind, 'layers': layers, 'rank': rank, 'seed': seed, 'steps': args.steps,
           'songs': 8, 'presets_per_step': 40, 'threads': args.threads, 'init': init, 'train_songs': train, 'val_songs': val,
           'fit_songs': train, 'train_presets': list(range(d.P)), 'residual': True, 'audio_min': args.audio_min, 'out': str(out)}
    (jobs_dir / f'{name}.json').write_text(json.dumps(cfg))
    return name, [PY, str(HERE / 'train_job.py'), str(jobs_dir / f'{name}.json')], [Path(init).stem] if init else [], str(out)


def net_preds(name):
    """SGD-head and ridge-head predictions (test, OOD) from a finished job."""
    z = np.load(jobs_dir / f'{name}.npz')
    bank, W, b = z['bank'], z['heads_w'], z['heads_b']
    sgd = mean_traj[:, None] + np.einsum('sfw,pwc->psfc', bank[test], W) + b[:, None, None, :]
    sgd_o = mean_traj[:, None] + np.einsum('sfw,pwc->psfc', z['bank_ood'], W) + b[:, None, None, :] if ood else None
    rp, ro = ridge_readout(np.concatenate([clock, bank], -1), np.concatenate([ood['clock'], z['bank_ood']], -1) if ood else None)
    s1, _ = L.score_audio(sgd, y_test, mean_traj, audio_cols)
    s2, _ = L.score_audio(rp, y_test, mean_traj, audio_cols)
    print(f'    {name}: SGD heads {np.nanmedian(s1):.3f}, ridge heads {np.nanmedian(s2):.3f}; '
          f'{float(z["n_params"]) / 1e6:.2f}M params, best val mse {float(z["val_mse"]):.3f}', flush=True)
    return sgd, sgd_o, rp, ro


if not args.skip_deep:
    jobs = [job('tcn-s0', 'tcn', 8, 0), job('ssm-s0', 'ssm', 4, 0), job('mingru-s0', 'mingru', 4, 0)]
    if args.pre:
        pre_out = jobs_dir / 'pre-mingru-s0.pt'
        jobs.append(('pre-mingru-s0', [PY, str(HERE / 'pretrain_job.py'), '--dirs', *args.pre, '--kind', 'mingru', '--layers', '4', '--seed', '0',
                                       '--steps', str(args.pre_steps), '--threads', str(args.threads), '--out', str(pre_out)], [], str(pre_out)))
    jobs += [job('tcn-L3-s0', 'tcn', 3, 0), job('mingru-s1', 'mingru', 4, 1)]
    if args.pre:
        jobs.append(job('mingru-pre-s0', 'mingru', 4, 0, init=str(pre_out)))
    print(f'\n{len(jobs)} network jobs, {args.parallel} at a time, {args.threads} thread(s) each:')
    run_jobs(jobs, args.parallel)

    groups = {'tcn (8 layers, 8.5 s)': ['tcn-s0'], 'ssm': ['ssm-s0'], 'mingru': ['mingru-s0', 'mingru-s1'],
              'tcn (3 layers, 0.25 s)': ['tcn-L3-s0']}
    if args.pre:
        groups['mingru pretrained'] = ['mingru-pre-s0']
    for label, names in groups.items():
        outs = [net_preds(n) for n in names]
        avg = lambda i: np.mean([x[i] for x in outs], 0) if outs[0][i] is not None else None
        cand = '3 layers' not in label
        report(label, avg(0), avg(1), extra={'seeds': len(names)}, keep=cand)
        report(f'{label} +ridge', avg(2), avg(3), keep=cand)
        del outs
    report('lightgbm', *lgbm_rung(), keep=True)
    lin = max(('ridge+', 'reservoir', 'lightgbm'), key=lambda k: np.nanmedian(results[k]['per_preset']))
    deep = max((k for k in preds if k not in ('ridge+', 'reservoir', 'lightgbm')), key=lambda k: np.nanmedian(results[k]['per_preset']))
    report('ensemble', (preds[lin].astype(np.float32) + preds[deep].astype(np.float32)) / 2,
           (ood_preds[lin].astype(np.float32) + ood_preds[deep].astype(np.float32)) / 2 if ood else None, extra={'members': [lin, deep]})

# ---------- summary ----------
ref = 'ridge+'
print(f'\nAudio R² on {len(test)} held-out songs, {int(scored.sum())} audio-reactive presets '
      f'(0 = clock oracle, 1 = perfect). Paired vs {ref}:')
summary = {}
for name, r in results.items():
    per = r['per_preset']
    line = f'  {name:24s} {np.nanmedian(per):6.3f}'
    entry = {'audio_r2': float(np.nanmedian(per)), 'groups': r['groups']}
    if name != ref:
        med, lo, hi, win = L.paired(per, results[ref]['per_preset'])
        line += f'   Δ {med:+.3f} [{lo:+.3f}, {hi:+.3f}]  wins {win * 100:3.0f}%'
        entry['vs_ref'] = {'median_diff': med, 'ci95': [lo, hi], 'win_rate': win}
    if 'ood' in r:
        entry['ood_audio_r2'] = float(np.nanmedian(r['ood']))
        line += f'   OOD {entry["ood_audio_r2"]:6.3f}'
    for k in ('seeds', 'members'):
        if k in r:
            entry[k] = r[k]
    summary[name] = entry
    print(line)
print('\nBy output group (audio R²):')
names = list(summary)
print('  ' + 'group'.ljust(16) + ''.join(n[:12].rjust(13) for n in names))
for g in L.GROUPS:
    print('  ' + g.ljust(16) + ''.join(f'{summary[n]["groups"][g]:13.3f}' for n in names))
json.dump({'presets': d.presets, 'audio_share': share.tolist(), 'test_songs': [d.songs[s] for s in test],
           'ood_songs': ood['songs'] if ood else None, 'summary': summary,
           'per_preset': {n: [None if not np.isfinite(v) else float(v) for v in results[n]['per_preset']] for n in summary}},
          open(args.out, 'w'), indent=1)
print(f'\nwrote {args.out} ({time.time() - t_start:.0f}s)')
