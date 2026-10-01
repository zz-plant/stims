"""Phase 4a: timing the jumps of counters and toggles.

  python run_events.py DATA_DIR LABELS_JSON [--out results_events.json] [--procs 4]

Audio R² cannot score a column that jumps: a counter that ticks on the right
beats but from the other state scores below the clock. lab:vj-baseline
therefore scores timing (event F1), and found that no linear model times a
single jump of the ~340 counters and gated toggles. This asks whether a
threshold-capable model does.

An event is a frame where a column jumps by more than a quarter of its range
over the training songs; a predicted event within 3 frames of an actual one is
a hit (the same rule as lab:vj-baseline's eventMatch). Cells: audio-driven
columns (at least 10% audio share) that jump at least 5 times on the training
songs and at least once on the test songs. Songs split as in run_known.py:
24 train, 4 validation, 4 test.

  clock oracle        the training songs' mean trajectory
  ridge+              per-preset ridge over clock + audio + leaky features
  lgbm value          LightGBM on the same features, predicting the value
  lgbm events         LightGBM classifier predicting "jumps at this frame",
                      on the same features plus their one-frame change; the
                      probability threshold is tuned per cell on the
                      validation songs, then non-maximum suppression keeps
                      one event per tolerance window.
"""
import argparse
import json
import multiprocessing as mp
import time

import lightgbm as lgb
import numpy as np

import vj_lab as L

JUMP = 0.25
TOL = 3
REG = dict(learning_rate=0.05, num_leaves=31, min_data_in_leaf=20, bagging_fraction=0.8, bagging_freq=1,
           feature_fraction=0.5, num_threads=1, verbose=-1)

ap = argparse.ArgumentParser()
ap.add_argument('data')
ap.add_argument('labels')
ap.add_argument('--out', default='results_events.json')
ap.add_argument('--procs', type=int, default=4)
args = ap.parse_args()


def events(series, thr):
    return np.flatnonzero(np.abs(np.diff(series)) > thr) + 1


def match(actual_ev, pred_ev):
    """(actual, predicted, hit_actual, hit_predicted) within TOL frames."""
    if len(actual_ev) == 0 or len(pred_ev) == 0:
        return len(actual_ev), len(pred_ev), 0, 0
    d = np.abs(actual_ev[:, None] - pred_ev[None, :]) <= TOL
    return len(actual_ev), len(pred_ev), int(d.any(1).sum()), int(d.any(0).sum())


def f1(counts):
    a, p, ha, hp = (sum(c[i] for c in counts) for i in range(4))
    if a == 0:
        return None
    recall = ha / a
    precision = hp / p if p else 0.0
    return 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)


def peaks(prob, theta):
    """Frames over theta that are the maximum within ±TOL (one event per window)."""
    above = np.flatnonzero(prob > theta)
    keep = []
    for f in above:
        lo, hi = max(0, f - TOL), min(len(prob), f + TOL + 1)
        if prob[f] >= prob[lo:hi].max() and (not keep or f - keep[-1] > TOL):
            keep.append(f)
    return np.array(keep, dtype=int)


# ---------- data (module level so forked workers share it) ----------
t0 = time.time()
d = L.Data(args.data)
S, F = d.S, d.F
train, val, test = list(range(S - 8)), list(range(S - 8, S - 4)), list(range(S - 4, S))
audio = d.audio(train)
clock = np.broadcast_to(d.clock, (S, F, d.clock.shape[1]))
feats = np.concatenate([clock, audio, L.leaky(audio)], -1).astype(np.float32)
delta = np.concatenate([np.zeros_like(audio[:, :1]), np.diff(audio, axis=1)], 1)
ev_feats = np.concatenate([feats, delta], -1)
states = d.states
y, mu, sd, moving = L.standardize_targets(states, train)
_, share = L.time_profile(y, train)
labels = json.load(open(args.labels))['presets']

cells = []
for p in range(d.P):
    hist = set(labels.get(d.presets[p], {}).get('historyColumns', []))
    for c in range(d.C):
        if not moving[p, c] or share[p, c] < 0.1:
            continue
        tr = y[p, train][..., c].astype(np.float64)
        thr = JUMP * (tr.max() - tr.min())
        if thr <= 0:
            continue
        n_train = sum(len(events(tr[i], thr)) for i in range(len(train)))
        n_test = sum(len(events(y[p, s, :, c].astype(np.float64), thr)) for s in test)
        if n_train >= 5 and n_test >= 1:
            cells.append((p, c, float(thr), d.columns[c] in hist))
print(f'{len(cells)} jumping cells in {len({p for p, *_ in cells})} presets ({time.time() - t0:.0f}s)', flush=True)

# ridge+ once per preset (shared design over songs)
ridge = L.SharedRidge(feats, train)
X_test = ridge.design(feats, test)


def run_cell(cell):
    p, c, thr, history = cell
    actual = [events(y[p, s, :, c].astype(np.float64), thr) for s in test]
    out = {'preset': d.presets[p], 'column': d.columns[c], 'history': history}
    # clock oracle
    oracle = y[p, train][..., c].astype(np.float64).mean(0)
    out['oracle'] = f1([match(a, events(oracle, thr)) for a in actual])
    # ridge+
    W = ridge.weights(y[p, train][..., c].reshape(-1, 1).astype(np.float64), [1e-2])[1e-2]
    pred = (X_test @ W).reshape(len(test), F)
    out['ridge'] = f1([match(a, events(pred[i], thr)) for i, a in enumerate(actual)])
    # lgbm value
    Xtr = feats[train].reshape(-1, feats.shape[-1])
    m = lgb.train(dict(REG, objective='regression'), lgb.Dataset(Xtr, y[p, train][..., c].reshape(-1)), num_boost_round=200)
    pv = m.predict(feats[test].reshape(-1, feats.shape[-1])).reshape(len(test), F)
    out['lgbm_value'] = f1([match(a, events(pv[i], thr)) for i, a in enumerate(actual)])
    # lgbm events
    target = np.zeros((len(train), F), np.int8)
    for i, s in enumerate(train):
        target[i, events(y[p, s, :, c].astype(np.float64), thr)] = 1
    clf = lgb.train(dict(REG, objective='binary', min_data_in_leaf=10),
                    lgb.Dataset(ev_feats[train].reshape(-1, ev_feats.shape[-1]), target.reshape(-1)), num_boost_round=200)
    prob_val = clf.predict(ev_feats[val].reshape(-1, ev_feats.shape[-1])).reshape(len(val), F)
    actual_val = [events(y[p, s, :, c].astype(np.float64), thr) for s in val]
    best = (-1.0, 0.5)
    for theta in (0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7):
        score = f1([match(a, peaks(prob_val[i], theta)) for i, a in enumerate(actual_val)])
        if score is not None and score > best[0]:
            best = (score, theta)
    prob = clf.predict(ev_feats[test].reshape(-1, ev_feats.shape[-1])).reshape(len(test), F)
    out['lgbm_events'] = f1([match(a, peaks(prob[i], best[1])) for i, a in enumerate(actual)])
    out['theta'] = best[1]
    return out


if __name__ == '__main__':
    with mp.get_context('fork').Pool(args.procs) as pool:
        rows = []
        for i, row in enumerate(pool.imap_unordered(run_cell, cells, chunksize=4)):
            rows.append(row)
            if (i + 1) % 50 == 0:
                print(f'  {i + 1}/{len(cells)} cells ({time.time() - t0:.0f}s)', flush=True)
    methods = ['oracle', 'ridge', 'lgbm_value', 'lgbm_events']
    summary = {}
    for group, sel in (('all', lambda r: True), ('history', lambda r: r['history']), ('no history', lambda r: not r['history'])):
        rs = [r for r in rows if sel(r)]
        summary[group] = {'cells': len(rs), **{m: {'median_f1': float(np.median([r[m] for r in rs])) if rs else None,
                                                     'share_over_half': float(np.mean([r[m] > 0.5 for r in rs])) if rs else None}
                                                 for m in methods}}
    ev = np.array([r['lgbm_events'] for r in rows])
    va = np.array([r['lgbm_value'] for r in rows])
    med, lo, hi, win = L.paired(ev, va)
    summary['events_vs_value'] = {'median_diff': med, 'ci95': [lo, hi], 'win_rate': win}
    print(f'\nEvent F1 on held-out songs ({len(rows)} jumping cells; ±{TOL} frames):')
    print('  ' + 'group'.ljust(12) + 'cells'.rjust(7) + ''.join(m.rjust(22) for m in methods))
    for group in ('all', 'history', 'no history'):
        g = summary[group]
        print('  ' + group.ljust(12) + str(g['cells']).rjust(7) + ''.join(
            (f"{g[m]['median_f1']:.3f} ({g[m]['share_over_half'] * 100:.0f}% >.5)" if g[m]['median_f1'] is not None else '—').rjust(22)
            for m in methods))
    print(f'  lgbm events vs lgbm value, paired: Δ {med:+.3f} [{lo:+.3f}, {hi:+.3f}], wins {win * 100:.0f}%')
    json.dump({'summary': summary, 'cells': rows}, open(args.out, 'w'), indent=1)
    print(f'wrote {args.out} ({time.time() - t0:.0f}s)')
