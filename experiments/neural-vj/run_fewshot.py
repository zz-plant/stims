"""Phase 2 — unseen presets (split by family), few-shot from calibration songs.

  python run_fewshot.py DATA_DIR --kind ssm [--init pretrained.pt] [--steps N] [--threads 4]

One trunk is trained (as a train_job.py process) on the training families
only, with a rank-8 readout dictionary. Then, for K = 1 and K = 4
calibration songs, an unseen preset is fitted in closed form from those
songs alone:
  hand calib-ridge(→prior)   ridge over hand features, shrunk to 0 / to the
                             training presets' mean readout
  bank calib-ridge(→prior)   the same over the learned feature bank
  bank dictionary(→prior)    rank-8 coefficients over the learned basis:
                             8 numbers per preset instead of 206×88
with a no-calibration population model and full-data ceilings.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

import vj_lab as L

ap = argparse.ArgumentParser()
ap.add_argument('data')
ap.add_argument('--kind', default='ssm')
ap.add_argument('--layers', type=int, default=None)
ap.add_argument('--init', default=None)
ap.add_argument('--steps', type=int, default=1000)
ap.add_argument('--threads', type=int, default=4)
ap.add_argument('--rank', type=int, default=8)
ap.add_argument('--jobs-dir', default='jobs_fewshot')
ap.add_argument('--out', default='results_fewshot.json')
args = ap.parse_args()
t_start = time.time()
PY = sys.executable  # the interpreter running this script (the one with torch)
HERE = Path(__file__).resolve().parent
jobs_dir = Path(args.jobs_dir)
jobs_dir.mkdir(exist_ok=True)

d = L.Data(args.data)
S = d.S
targets = list(range(4, S - 8))
val_songs, test_songs = list(range(S - 8, S - 4)), list(range(S - 4, S))


def bucket(family):
    h = int(hashlib.sha1(family.encode()).hexdigest(), 16) % 100
    return 'train' if h < 70 else 'val' if h < 80 else 'test'


split = np.array([bucket(f) for f in d.families])
P_tr, P_va, P_te = (np.flatnonzero(split == s) for s in ('train', 'val', 'test'))
print(f'presets train {len(P_tr)} / val {len(P_va)} / test {len(P_te)} (by family); trunk songs {len(targets)}, '
      f'val {len(val_songs)}, test {len(test_songs)}')
states = d.states
del d.states
audio = d.audio(list(range(S)))  # audio-only scaling: no targets involved
clock = np.broadcast_to(d.clock, (S, d.F, d.clock.shape[1]))
hand = np.concatenate([clock, audio, L.leaky(audio)], -1)

# ---------- one trunk on the training families (targets standardised over their own trunk songs) ----------
cfg = {'data': args.data, 'kind': args.kind, 'layers': args.layers or (4 if args.kind == 'ssm' else 8), 'rank': args.rank, 'seed': 0,
       'steps': args.steps, 'songs': 8, 'presets_per_step': 40, 'threads': args.threads, 'init': args.init,
       'train_songs': targets, 'val_songs': val_songs, 'fit_songs': targets, 'train_presets': P_tr.tolist(),
       'residual': True, 'audio_min': 0.1, 'out': str(jobs_dir / 'trunk.npz')}
(jobs_dir / 'trunk.json').write_text(json.dumps(cfg))
if not Path(cfg['out']).exists():
    print(f'training the trunk ({args.kind}, rank {args.rank}) on {len(P_tr)} presets …', flush=True)
    with open(jobs_dir / 'trunk.log', 'w') as log:
        subprocess.run([PY, str(HERE / 'train_job.py'), str(jobs_dir / 'trunk.json')], stdout=log, stderr=subprocess.STDOUT, check=True)
z = np.load(cfg['out'])
bank = np.concatenate([clock, z['bank']], -1)
# the trunk job trained readouts only for training presets with audio-driven columns; the dictionary prior
# is the mean of those coefficients (the others are still at their random initialisation)
y_tr, _, _, mv_tr = L.standardize_targets(states, targets)
_, share_tr = L.time_profile(y_tr, targets)
trained = P_tr[(mv_tr & (share_tr >= 0.1))[P_tr].any(1)]
del y_tr
basis, coef_tr = z['basis'], z['coef'][trained]  # basis [r, W, C] over raw bank features
print(f'trunk done: best val mse {float(z["val_mse"]):.3f} ({time.time() - t_start:.0f}s)')

all_results = {}
for K in (4, 1):
    calib = list(range(K))
    y, mu, sd, moving = L.standardize_targets(states, calib)  # only calibration songs may inform a new preset
    # evaluation only: the true clock oracle of each preset (its mean over all 24 non-held-out songs) defines
    # audio R²; no prediction below ever sees it
    mt_true, share_true = L.time_profile(y, list(range(S - 8)))
    audio_eval = moving & (share_true >= 0.1)
    results, preds = {}, {}

    def report(name, pred):
        per, col = L.score_audio(pred, y[P_te][:, test_songs], mt_true[P_te], audio_eval[P_te])
        results[name] = {'per_preset': per, 'groups': L.group_scores(col, d.columns)}
        preds[name] = np.asarray(pred, np.float32)
        print(f'  K={K} {name:34s} audio R² {np.nanmedian(per):6.3f}   ({time.time() - t_start:.0f}s)', flush=True)

    # K-shot clock baseline: replay the average of the calibration songs' trajectories
    report('calibration replay', np.stack([np.broadcast_to(y[p, calib].astype(np.float32).mean(0), (len(test_songs), d.F, d.C)) for p in P_te]))

    def vloss(pred, presets, songs):
        m = moving[presets][:, None, None, :]
        return float((((pred - y[presets][:, songs]) ** 2) * m).sum() / max(1, m.sum() * len(songs) * d.F))

    shape_v, shape_t = (len(val_songs), d.F, d.C), (len(test_songs), d.F, d.C)

    def readouts(feats, tag):
        scaler = L.SharedRidge(feats, list(range(S))).scaler
        r_cal, r_all = L.SharedRidge(feats, calib, scaler), L.SharedRidge(feats, targets, scaler)
        Xv, Xt = r_cal.design(feats, val_songs), r_cal.design(feats, test_songs)
        W_tr = np.stack([r_all.weights(y[p, targets].reshape(-1, d.C), [1e-2])[1e-2] for p in P_tr])
        m_tr = moving[P_tr].astype(float)[:, None, :]
        prior = (W_tr * m_tr).sum(0) / np.maximum(1, m_tr.sum(0))
        for name, pr in ((f'{tag} calib-ridge', None), (f'{tag} calib-ridge→prior', prior)):
            losses = {lam: np.mean([vloss((Xv @ r_cal.weights(y[p, calib].reshape(-1, d.C), [lam], pr)[lam]).reshape(shape_v)[None], [p], val_songs)
                                    for p in P_va]) for lam in L.LAMBDAS}
            lam = min(losses, key=losses.get)
            report(f'{name} (λ={lam:g})', np.stack([(Xt @ r_cal.weights(y[p, calib].reshape(-1, d.C), [lam], pr)[lam]).reshape(shape_t) for p in P_te]))
        report(f'{tag} population (no calibration)', np.broadcast_to((Xt @ prior).reshape(shape_t), (len(P_te),) + shape_t).copy())
        Xt_all = r_all.design(feats, test_songs)
        report(f'{tag} ceiling ({len(targets)} songs)', np.stack([(Xt_all @ r_all.weights(y[p, targets].reshape(-1, d.C), [1e-2])[1e-2]).reshape(shape_t) for p in P_te]))

    readouts(hand, 'hand')
    readouts(bank, 'bank')

    # dictionary: y[p] ≈ Σ_k a_k (bank @ basis[k]) + b, fitted from calibration rows, r+1 numbers per column-set
    Zc = np.stack([z['bank'][calib].reshape(-1, z['bank'].shape[-1]) @ basis[k] for k in range(args.rank)], -1)  # [n, C, r]
    Zt = np.stack([z['bank'][test_songs].reshape(-1, z['bank'].shape[-1]) @ basis[k] for k in range(args.rank)], -1)
    Zv = np.stack([z['bank'][val_songs].reshape(-1, z['bank'].shape[-1]) @ basis[k] for k in range(args.rank)], -1)
    coef_prior = coef_tr.mean(0)

    def dict_fit(p, lam, prior_a):
        m = moving[p]
        A = Zc[:, m, :].reshape(-1, args.rank)
        Y = y[p, calib].reshape(-1, d.C)[:, m].astype(np.float32)
        b = Y.mean(0)
        t = (Y - b).reshape(-1)
        if prior_a is not None:
            t = t - A @ prior_a
        a = np.linalg.solve(A.T @ A + lam * len(A) * np.eye(args.rank), A.T @ t)
        if prior_a is not None:
            a = a + prior_a
        bias = np.zeros(d.C)
        bias[m] = b
        return a, bias

    def dict_pred(Z, a, bias, n_songs):
        return (Z @ a + bias).reshape(n_songs, d.F, d.C)

    for name, pr in (('bank dictionary', None), ('bank dictionary→prior', coef_prior)):
        losses = {lam: np.mean([vloss(dict_pred(Zv, *dict_fit(p, lam, pr), len(val_songs))[None], [p], val_songs) for p in P_va]) for lam in (1e-4, 1e-3, 1e-2, 1e-1, 1.0)}
        lam = min(losses, key=losses.get)
        report(f'{name} (λ={lam:g})', np.stack([dict_pred(Zt, *dict_fit(p, lam, pr), len(test_songs)) for p in P_te]))

    best_hand = max((k for k in results if k.startswith('hand calib')), key=lambda k: np.nanmedian(results[k]['per_preset']))
    best_bank = max((k for k in results if k.startswith('bank') and 'ceiling' not in k and 'population' not in k), key=lambda k: np.nanmedian(results[k]['per_preset']))
    report('ensemble hand+bank', (preds[best_hand] + preds[best_bank]) / 2)

    ref = best_hand
    print(f'\nK={K}: audio R² on unseen presets ({int(audio_eval[P_te].any(1).sum())} audio-reactive of {len(P_te)}), '
          f'held-out songs ({len(test_songs)}). Paired vs "{ref}":')
    summary = {}
    for name, rr in results.items():
        per = rr['per_preset']
        entry = {'audio_r2': float(np.nanmedian(per)), 'groups': rr['groups']}
        line = f'  {name:38s} {np.nanmedian(per):6.3f}'
        if name != ref:
            med, lo, hi, win = L.paired(per, results[ref]['per_preset'])
            line += f'   Δ {med:+.3f} [{lo:+.3f}, {hi:+.3f}]  wins {win * 100:3.0f}%'
            entry['vs_ref'] = {'median_diff': med, 'ci95': [lo, hi], 'win_rate': win}
        summary[name] = entry
        print(line)
    print('  by group:')
    names = list(summary)
    print('  ' + 'group'.ljust(16) + ''.join(n[:13].rjust(14) for n in names))
    for g in L.GROUPS:
        print('  ' + g.ljust(16) + ''.join(f'{summary[n]["groups"][g]:14.3f}' for n in names))
    all_results[f'K={K}'] = summary

json.dump({'kind': args.kind, 'rank': args.rank, 'init': args.init, 'test_presets': [d.presets[p] for p in P_te], 'results': all_results},
          open(args.out, 'w'), indent=1)
print(f'\nwrote {args.out} ({time.time() - t_start:.0f}s)')
