"""Phase 4c: recovering a preset's equations from its behaviour.

  python run_symbolic.py DATA_DIR LABELS_JSON [--out results_symbolic.json]

A learned model of a preset is a black box; the preset itself is an
equation. This asks whether the equation can be recovered from audio in and
values out, as sparse regression over a library of MilkDrop-shaped terms
(SINDy-style sequentially thresholded least squares), so the answer is a
readable, editable expression.

Targets: (preset, column) pairs that lab:dataflow labels audio-driven with no
history (the value is a function of this frame's audio and the time), moving,
and at least 10% audio-driven. Inputs per frame: the 13 signals the VM read,
and the time.

Library, per signal s (standardised over the training songs for fitting,
reported in raw units):
  1, s, s², above(s, q) at the 50/75/90% quantiles and at 1.0, 1.2, 1.5,
  s·s' for signal pairs, sin(ωt) and cos(ωt) for the three strongest
  frequencies of the column's clock-only trajectory (its mean over training
  songs), and s·sin(ωt), s·cos(ωt).

Two variants:
  blind        all 13 signals
  code-guided  only the signals lab:dataflow says the column reads

Sparsity is chosen on the validation songs; scored on the test songs:
R² of the value, exact recovery (R² > 0.999), terms used, and, for the blind
variant, whether the signals it picked are the ones the equations read.
Songs as in run_known.py: 24 train, 4 validation, 4 test.
"""
import argparse
import itertools
import json
import time

import numpy as np

import vj_lab as L

ap = argparse.ArgumentParser()
ap.add_argument('data')
ap.add_argument('labels')
ap.add_argument('--out', default='results_symbolic.json')
ap.add_argument('--max-cells', type=int, default=0)
args = ap.parse_args()
t0 = time.time()

d = L.Data(args.data)
S, F = d.S, d.F
train, val, test = list(range(S - 8)), list(range(S - 8, S - 4)), list(range(S - 4, S))
SIG = [c.lower() for c in d.manifest['signals']['columns']]
ALIAS = {'mids': 'mid', 'med': 'mid', 'treble': 'treb', 'mids_att': 'mid_att', 'med_att': 'mid_att',
         'treble_att': 'treb_att', 'bassatt': 'bass_att', 'midatt': 'mid_att', 'midsatt': 'mid_att',
         'trebleatt': 'treb_att', 'vol_att': 'vol', 'beatpulse': 'beat_pulse'}
sig = d.signals.astype(np.float64)  # [S, F, 13], what the VM read
t = np.arange(F) / d.fps
labels = json.load(open(args.labels))['presets']
y, _, _, moving = L.standardize_targets(d.states, train)
_, share = L.time_profile(y, train)
raw = d.states  # values in the preset's own units


def library(channels, omegas):
    """Columns [S, F, K] and their MilkDrop-syntax names."""
    cols, names = [np.ones((S, F))], ['1']
    q = {c: np.quantile(sig[train][..., c], [0.5, 0.75, 0.9]) for c in channels}
    for c in channels:
        s, n = sig[..., c], SIG[c]
        cols += [s, s ** 2]
        names += [n, f'{n}*{n}']
        for th in [*q[c], 1.0, 1.2, 1.5]:
            cols.append((s > th).astype(float))
            names.append(f'above({n},{th:.3g})')
    for a, b in itertools.combinations(channels, 2):
        cols.append(sig[..., a] * sig[..., b])
        names.append(f'{SIG[a]}*{SIG[b]}')
    for w in omegas:
        sw, cw = np.broadcast_to(np.sin(w * t), (S, F)), np.broadcast_to(np.cos(w * t), (S, F))
        cols += [sw, cw]
        names += [f'sin({w:.4g}*time)', f'cos({w:.4g}*time)']
        for c in channels:
            cols += [sig[..., c] * sw, sig[..., c] * cw]
            names += [f'{SIG[c]}*sin({w:.4g}*time)', f'{SIG[c]}*cos({w:.4g}*time)']
    return np.stack(cols, -1), names


def clock_omegas(mean_traj, k=3):
    spec = np.abs(np.fft.rfft(mean_traj - mean_traj.mean()))
    freqs = np.fft.rfftfreq(F, 1 / d.fps)
    spec[0] = 0
    return [float(2 * np.pi * freqs[i]) for i in np.argsort(-spec)[:k] if spec[i] > 1e-9 * spec.max() + 1e-12]


def stlsq(X, yv, threshold, lam=1e-6, iters=10):
    """Sequentially thresholded least squares on standardised columns."""
    sd = X.std(0)
    sd[0] = 1.0
    sd[sd < 1e-12] = np.inf
    Z = X / sd
    active = np.isfinite(sd)
    w = np.zeros(X.shape[1])
    for _ in range(iters):
        idx = np.flatnonzero(active)
        if len(idx) == 0:
            break
        A = Z[:, idx]
        w_a = np.linalg.solve(A.T @ A + lam * np.eye(len(idx)), A.T @ yv)
        w = np.zeros(X.shape[1])
        w[idx] = w_a
        small = np.abs(w) < threshold
        small[0] = False  # keep the intercept
        if not (active & small).any():
            break
        active &= ~small
    return np.where(np.isfinite(sd), w / sd, 0.0)


def r2(a, b):
    ss = ((a - a.mean()) ** 2).sum()
    return float(1 - ((a - b) ** 2).sum() / ss) if ss > 1e-18 else None


def fit_cell(p, c, channels):
    target = raw[p][..., c].astype(np.float64)  # [S, F]
    omegas = clock_omegas(target[train].mean(0))
    X, names = library(channels, omegas)
    Xtr, ytr = X[train].reshape(-1, X.shape[-1]), target[train].reshape(-1)
    scale = ytr.std() + 1e-12
    best = None
    for th in (1e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1):
        w = stlsq(Xtr, ytr / scale, th) * scale
        pv = X[val].reshape(-1, X.shape[-1]) @ w
        score = r2(target[val].reshape(-1), pv)
        terms = int((np.abs(w) > 0).sum())
        # prefer fewer terms when validation R² is within 1e-4
        key = (round(score if score is not None else -1e9, 4), -terms)
        if best is None or key > best[0]:
            best = (key, w, th)
    w = best[1]
    pt = X[test].reshape(-1, X.shape[-1]) @ w
    score = r2(target[test].reshape(-1), pt)
    used = [i for i in np.flatnonzero(np.abs(w) > 0)]
    expr = ' + '.join(f'{w[i]:.4g}*{names[i]}' if names[i] != '1' else f'{w[i]:.4g}' for i in used)
    picked = {SIG[ch] for ch in channels if any(SIG[ch] in names[i].replace('*', ' ').replace('(', ' ').replace(',', ' ').split() for i in used)}
    return {'r2': score, 'terms': len(used), 'equation': expr, 'signals': sorted(picked)}


cells = []
for p, pid in enumerate(d.presets):
    lab = labels.get(pid)
    if not lab:
        continue
    hist = set(lab.get('historyColumns', []))
    for col, signals in lab['audioColumns'].items():
        if col not in d.columns or col in hist:
            continue
        c = d.columns.index(col)
        if not moving[p, c] or share[p, c] < 0.1:
            continue
        chans = sorted({SIG.index(ALIAS.get(s, s)) for s in signals if ALIAS.get(s, s) in SIG})
        if chans:
            cells.append((p, c, chans, sorted({SIG[i] for i in chans})))
if args.max_cells:
    cells = cells[:args.max_cells]
print(f'{len(cells)} memoryless audio cells in {len({p for p, *_ in cells})} presets ({time.time() - t0:.0f}s)', flush=True)

rows = []
for i, (p, c, chans, true_signals) in enumerate(cells):
    guided = fit_cell(p, c, chans)
    blind = fit_cell(p, c, list(range(len(SIG))))
    tp = len(set(blind['signals']) & set(true_signals))
    rows.append({'preset': d.presets[p], 'column': d.columns[c], 'true_signals': true_signals,
                 'guided': guided, 'blind': blind,
                 'blind_signal_precision': tp / len(blind['signals']) if blind['signals'] else None,
                 'blind_signal_recall': tp / len(true_signals)})
    if (i + 1) % 25 == 0:
        print(f'  {i + 1}/{len(cells)} ({time.time() - t0:.0f}s)', flush=True)


def summary(key):
    r = [row[key]['r2'] for row in rows if row[key]['r2'] is not None]
    return {'median_r2': float(np.median(r)), 'exact': float(np.mean([v > 0.999 for v in r])),
            'over_0.9': float(np.mean([v > 0.9 for v in r])),
            'median_terms': float(np.median([row[key]['terms'] for row in rows]))}


res = {'cells': len(rows), 'guided': summary('guided'), 'blind': summary('blind')}
prec = [r['blind_signal_precision'] for r in rows if r['blind_signal_precision'] is not None]
res['blind_signals'] = {'precision': float(np.mean(prec)), 'recall': float(np.mean([r['blind_signal_recall'] for r in rows]))}
print(f'\n{len(rows)} memoryless audio cells, test songs:')
for k in ('guided', 'blind'):
    v = res[k]
    print(f'  {k:8s} median R² {v["median_r2"]:.3f}   exact (R²>0.999) {v["exact"] * 100:.0f}%   R²>0.9 {v["over_0.9"] * 100:.0f}%   median terms {v["median_terms"]:.0f}')
print(f'  blind picks the signals the equations read: precision {res["blind_signals"]["precision"]:.2f}, recall {res["blind_signals"]["recall"]:.2f}')
examples = sorted(rows, key=lambda r: -(r['guided']['r2'] or -1))[:5]
for r in examples:
    print(f'  {r["preset"]} {r["column"]}: R² {r["guided"]["r2"]:.4f}  {r["column"]} = {r["guided"]["equation"]}')
json.dump({'summary': res, 'rows': rows}, open(args.out, 'w'), indent=1)
print(f'wrote {args.out} ({time.time() - t0:.0f}s)')
