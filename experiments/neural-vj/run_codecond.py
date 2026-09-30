"""Phase 3: unseen presets conditioned on their own equations.

  python run_codecond.py DATA_DIR LABELS_JSON [--bank jobs_fewshot/trunk.npz] [--out results_codecond.json]

LABELS_JSON is `bun run lab:dataflow -- --all --out labels.json`. It lists,
for every preset and canonical column, the audio signals the equations can
carry to that column and whether the column keeps history (reads past
frames). run_fewshot.py fits an unseen preset's readout over every feature,
shrunk toward the average training readout. Here the equations choose each
column's model before any data is seen:

  features   only the signals the column reads: each raw signal, hinges at
             its quartiles (thresholds like above(bass, 1.2) are common),
             and its onset. With history, leaky integrators of those too.
             Clock features are always in.
  prior      the average readout of training columns with the same
             dependency signature (signals + history), not of every column.

The split (by family), songs and metric (audio R² on held-out songs) are
run_fewshot.py's, so the two runs can be compared preset by preset.
Variants, for K = 1 and 4 calibration songs (the no-calibration rows sit
under K = 1, as in run_fewshot.py: the one song sets only the units):

  hand calib-ridge→prior     run_fewshot.py's hand baseline (all features)
  basis, all signals         the new feature basis over every signal:
                             separates the basis from the restriction
  code: restricted           restricted features, shrunk to 0
  code: restricted→sig prior restricted features, signature prior
  code ceiling               restricted features fitted on 20 songs
  bank calib-ridge→prior     with --bank: run_fewshot.py's learned-bank model
  ensemble code+bank         the mean of the two
  code: signature prior only no calibration: the signature prior alone
"""
import argparse
import hashlib
import json
import time
from collections import defaultdict

import numpy as np

import vj_lab as L

ap = argparse.ArgumentParser()
ap.add_argument('data')
ap.add_argument('labels')
ap.add_argument('--bank', default=None, help="run_fewshot.py's trunk.npz: adds the learned bank and a code+bank ensemble")
ap.add_argument('--out', default='results_codecond.json')
args = ap.parse_args()
t_start = time.time()

d = L.Data(args.data)
S = d.S
targets = list(range(4, S - 8))
val_songs, test_songs = list(range(S - 8, S - 4)), list(range(S - 4, S))


def bucket(family):
    h = int(hashlib.sha1(family.encode()).hexdigest(), 16) % 100
    return 'train' if h < 70 else 'val' if h < 80 else 'test'


split = np.array([bucket(f) for f in d.families])
P_tr, P_va, P_te = (np.flatnonzero(split == s) for s in ('train', 'val', 'test'))
labels = json.load(open(args.labels))['presets']
missing = [p for p in d.presets if p not in labels]
if missing:
    raise SystemExit(f'{len(missing)} preset(s) missing from {args.labels}, e.g. {missing[:3]}')
print(f'presets train {len(P_tr)} / val {len(P_va)} / test {len(P_te)} (by family)')

# ---------- dependency signature of every (preset, column) ----------
SIGNALS = d.manifest['signals']['columns']  # the 13 per-frame signal channels the VM reads
ch = {name.lower(): i for i, name in enumerate(SIGNALS)}
ALIAS = {'mids': 'mid', 'med': 'mid', 'treble': 'treb', 'mids_att': 'mid_att', 'med_att': 'mid_att',
         'treble_att': 'treb_att', 'bassatt': 'bass_att', 'midatt': 'mid_att', 'midsatt': 'mid_att',
         'trebleatt': 'treb_att', 'vol_att': 'vol', 'beatpulse': 'beat_pulse', 'beatbass': 'beat',
         'beatmid': 'beat', 'beattreble': 'beat', 'beat_bass': 'beat', 'beat_mid': 'beat', 'beat_treb': 'beat',
         'beat_treble': 'beat'}
WIDE = {'value1', 'value2', 'att', 'music', 'bandflux'}  # the waveform itself, or no single channel: all signals


def channels(signals):
    if any(s in WIDE for s in signals):
        return tuple(range(len(SIGNALS)))
    return tuple(sorted({ch[ALIAS.get(s, s)] for s in signals if ALIAS.get(s, s) in ch}))


sig = {}  # (p, c) -> (channels, history)
for p, pid in enumerate(d.presets):
    lab = labels[pid]
    hist = set(lab.get('historyColumns', []))
    for col, signals in lab['audioColumns'].items():
        if col in d.columns:
            chans = channels(signals)
            if chans:
                sig[(p, d.columns.index(col))] = (chans, col in hist)

# ---------- features ----------
audio = d.audio(list(range(S)))  # [S,F,13 signals + 32 bands + 13 onsets], audio-only scaling
n_sig = len(SIGNALS)
raw, onset = audio[..., :n_sig], audio[..., -n_sig:]
knots = np.quantile(raw[targets].reshape(-1, n_sig), [0.25, 0.5, 0.75], axis=0)  # [3, 13]
hinge = np.concatenate([np.maximum(0, raw - k) for k in knots], -1)  # [S,F,39]
slow = L.leaky(np.concatenate([raw, onset], -1))  # [S,F,26*8]
clock = np.broadcast_to(d.clock, (S, d.F, d.clock.shape[1]))


def feature_index(chans, history):
    """Columns of `basis` that belong to these signal channels."""
    idx = list(range(clock.shape[-1]))
    base = clock.shape[-1]
    for c in chans:
        idx += [base + c, base + n_sig + c, base + 2 * n_sig + c, base + 3 * n_sig + c, base + 4 * n_sig + c]
    if history:
        base2 = base + 5 * n_sig
        for t in range(len(L.TAUS)):
            for c in chans:
                idx += [base2 + t * 2 * n_sig + c, base2 + t * 2 * n_sig + n_sig + c]
    return np.array(sorted(idx))


# clock | raw | onset | 3 hinges | leaky(raw, onset) at 8 time constants
basis = np.concatenate([clock, raw, onset, hinge, slow], -1).astype(np.float32)
hand = np.concatenate([clock, audio, L.leaky(audio)], -1)
bank = np.concatenate([clock, np.load(args.bank)['bank']], -1) if args.bank else None
states = d.states
del d.states
ALL = tuple(range(n_sig))

# ---------- training readouts per signature, on the training families ----------
train_set = set(P_tr.tolist())
by_signature = defaultdict(list)
for (p, c), key in sig.items():
    if p in train_set:
        by_signature[key].append((p, c))
print(f'{len(sig)} audio (preset, column) pairs, {len(by_signature)} signatures among training columns')

scaler = {}
ridges = {}
designs = {}


def ridge(key, songs):
    """SharedRidge over this signature's features, on these songs; one scaler per signature."""
    chans, history = key
    if (key, tuple(songs)) not in ridges:
        feats = basis[..., feature_index(chans, history)]
        if key not in scaler:
            scaler[key] = L.SharedRidge(feats, list(range(S))).scaler
        ridges[(key, tuple(songs))] = (L.SharedRidge(feats, songs, scaler[key]), feats)
    return ridges[(key, tuple(songs))]


def design(key, songs):
    if (key, tuple(songs)) not in designs:
        r, feats = ridge(key, targets)
        designs[(key, tuple(songs))] = r.design(feats, songs)
    return designs[(key, tuple(songs))]


all_results = {}
shape_t = (len(test_songs), d.F)
for K in (4, 1):
    calib = list(range(K))
    y, mu, sd, moving = L.standardize_targets(states, calib)
    # signature priors, in this K's units: the mean readout of training columns sharing the signature
    priors = {}
    for key, pairs in by_signature.items():
        pairs = [(p, c) for p, c in pairs if moving[p, c]]
        if pairs:
            r, _ = ridge(key, targets)
            priors[key] = np.mean([r.weights(y[p, targets][..., c].reshape(-1, 1).astype(np.float64), [1e-2])[1e-2]
                                   for p, c in pairs], 0)
    mt_true, share_true = L.time_profile(y, list(range(S - 8)))
    audio_eval = moving & (share_true >= 0.1)
    results, preds = {}, {}

    def report(name, pred):
        per, col = L.score_audio(pred, y[P_te][:, test_songs], mt_true[P_te], audio_eval[P_te])
        results[name] = {'per_preset': per, 'groups': L.group_scores(col, d.columns)}
        preds[name] = pred
        print(f'  K={K} {name:34s} audio R² {np.nanmedian(per):6.3f}   ({time.time() - t_start:.0f}s)', flush=True)

    def base_pred(presets):
        # columns nobody predicts stay at the calibration replay (clock-only); they are not scored anyway
        return np.stack([np.broadcast_to(y[p, calib].astype(np.float32).mean(0), shape_t + (d.C,)).copy() for p in presets])

    # --- run_fewshot's hand baseline, for the paired comparison ---
    def dense(feats, tag, prior_mode, presets, songs_eval, lam):
        sc = L.SharedRidge(feats, list(range(S))).scaler
        r_cal, r_all = L.SharedRidge(feats, calib, sc), L.SharedRidge(feats, targets, sc)
        X = r_cal.design(feats, songs_eval)
        W_tr = np.stack([r_all.weights(y[p, targets].reshape(-1, d.C), [1e-2])[1e-2] for p in P_tr])
        m_tr = moving[P_tr].astype(float)[:, None, :]
        prior = (W_tr * m_tr).sum(0) / np.maximum(1, m_tr.sum(0))
        out = []
        for p in presets:
            if lam is None:
                W = prior
            else:
                W = r_cal.weights(y[p, calib].reshape(-1, d.C), [lam], prior if prior_mode else None)[lam]
            out.append((X @ W).reshape(len(songs_eval), d.F, d.C))
        return np.stack(out)

    def vloss(pred, presets, songs):
        m = moving[presets][:, None, None, :]
        return float((((pred - y[presets][:, songs]) ** 2) * m).sum() / max(1, m.sum() * len(songs) * d.F))

    for tag, feats in (('hand calib-ridge→prior', hand), ('basis, all signals →prior', basis)):
        losses = {lam: vloss(dense(feats, tag, True, P_va, val_songs, lam), P_va, val_songs) for lam in L.LAMBDAS}
        lam = min(losses, key=losses.get)
        report(f'{tag} (λ={lam:g})', dense(feats, tag, True, P_te, test_songs, lam))

    # --- code-conditioned: each column gets its own features and prior ---
    def coded(presets, songs_eval, lam, use_prior, fit=None):
        fit = fit or calib
        pred = base_pred(presets) if songs_eval is test_songs else np.stack(
            [np.broadcast_to(y[p, calib].astype(np.float32).mean(0), (len(songs_eval), d.F, d.C)).copy() for p in presets])
        for i, p in enumerate(presets):
            for c in range(d.C):
                key = sig.get((p, c))
                if key is None or not moving[p, c]:
                    continue
                r_cal, _ = ridge(key, fit)
                X = design(key, songs_eval)
                # a signature no training column has: shrink toward 0
                prior = priors.get(key) if use_prior else None
                if lam is None:
                    if prior is None:
                        continue
                    W = prior
                else:
                    W = r_cal.weights(y[p, fit][..., c].reshape(-1, 1).astype(np.float64), [lam], prior)[lam]
                pred[i, ..., c] = (X @ W).reshape(len(songs_eval), d.F)
        return pred

    for name, use_prior in (('code: restricted', False), ('code: restricted→sig prior', True)):
        losses = {lam: vloss(coded(P_va, val_songs, lam, use_prior), P_va, val_songs) for lam in L.LAMBDAS}
        lam = min(losses, key=losses.get)
        report(f'{name} (λ={lam:g})', coded(P_te, test_songs, lam, use_prior))

    report(f'code ceiling ({len(targets)} songs)', coded(P_te, test_songs, 1e-2, False, targets))
    if bank is not None:
        losses = {lam: vloss(dense(bank, 'bank', True, P_va, val_songs, lam), P_va, val_songs) for lam in L.LAMBDAS}
        lam = min(losses, key=losses.get)
        report(f'bank calib-ridge→prior (λ={lam:g})', dense(bank, 'bank', True, P_te, test_songs, lam))
        code_name = max((k for k in results if k.startswith('code: restricted')),
                        key=lambda k: np.nanmedian(results[k]['per_preset']))
        report('ensemble code+bank', (preds[code_name] + preds[f'bank calib-ridge→prior (λ={lam:g})']) / 2)
        report('ensemble hand+bank (run_fewshot)',
               (preds[next(k for k in results if k.startswith('hand'))] + preds[f'bank calib-ridge→prior (λ={lam:g})']) / 2)
    if K == 1:
        # no calibration: the readout comes from training presets alone (the one song sets only the units)
        report('hand population (no calibration)', dense(hand, 'hand', True, P_te, test_songs, None))
        report('code: signature prior only (no calibration)', coded(P_te, test_songs, None, True))

    ref = next(k for k in results if k.startswith('hand'))
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
    all_results[f'K={K}'] = summary

json.dump({'test_presets': [d.presets[p] for p in P_te], 'signatures': len(by_signature), 'results': all_results},
          open(args.out, 'w'), indent=1)
print(f'\nwrote {args.out} ({time.time() - t_start:.0f}s)')
