"""Phase 4b: which presets fit which song.

  python run_match.py DATA_DIR LABELS_JSON [--out results_match.json]

Autoplay picks presets without listening. To pick presets that respond to the
song playing, a model must predict, for a new song, how strongly each preset
will react to it, before running anything.

  fit[p, s]   the share of preset p's motion on song s that departs from its
              clock-only trajectory (its mean over the other songs), averaged
              over its moving columns: 0 = the song changes nothing, 1 = all
              of its motion is the song's.

First the decomposition: how much of fit's variance is the preset (some
presets react to anything), the song (some songs move everything), and the
interaction (this preset suits this song). Only the interaction can make a
song-aware pick beat a fixed ranking.

Then the model, fitted on the training songs (24) and scored on the 8 others:
  fit[p, s] ≈ a_p + b(song) + u(preset) · V · g(song)
where g(song) are 39 audio statistics of the song (mean, spread and onset
rate of each signal channel), b and V are ridge maps from them, a_p is the
preset's mean over training songs, and u(preset) is the preset's dataflow
profile: for each signal channel, the share of its audio-driven columns that
read it (from lab:dataflow labels, so an unseen preset needs no data).
Scored per test song: Spearman correlation of predicted and true fit across
presets, and top-10 precision, against the fixed ranking a_p.
"""
import argparse
import json
import time

import numpy as np

import vj_lab as L

ap = argparse.ArgumentParser()
ap.add_argument('data')
ap.add_argument('labels')
ap.add_argument('--ood', default=None, help='a lab:dataset export of the same presets on unfamiliar-style songs')
ap.add_argument('--out', default='results_match.json')
args = ap.parse_args()
t0 = time.time()

d = L.Data(args.data)
S, F, P = d.S, d.F, d.P
songs_train = list(range(S - 8))
songs_test = list(range(S - 8, S))
y, _, _, moving = L.standardize_targets(d.states, list(range(S)))


def fit_matrix(frames=slice(None), y=y, moving=moving):
    S = y.shape[1]
    fit = np.zeros((y.shape[0], S))
    for p in range(y.shape[0]):
        cols = np.flatnonzero(moving[p])
        if len(cols) == 0:
            continue
        x = y[p][:, frames][..., cols].astype(np.float64)  # [S, F, C]
        total = x.reshape(-1, len(cols)).var(0) + 1e-12
        for s in range(S):
            others = [o for o in range(S) if o != s]
            dev = x[s] - x[others].mean(0)
            fit[p, s] = float(np.mean((dev ** 2).mean(0) / total))
    return np.clip(fit, 0, None)


fit = fit_matrix()
keep = fit.max(1) > 1e-6  # presets that react at all
fit = fit[keep]
# reliability: fit on each half of every song; a real interaction agrees between halves
halves = [fit_matrix(slice(0, F // 2))[keep], fit_matrix(slice(F // 2, F))[keep]]


def interaction(m):
    return m - m.mean(1, keepdims=True) - m.mean(0, keepdims=True) + m.mean()


reliability = float(np.corrcoef(interaction(halves[0]).ravel(), interaction(halves[1]).ravel())[0, 1])
presets = [d.presets[i] for i in np.flatnonzero(keep)]
families = [d.families[i] for i in np.flatnonzero(keep)]
P = len(presets)

# ---------- variance decomposition (two-way, on all songs) ----------
grand = fit.mean()
row = fit.mean(1, keepdims=True) - grand
col = fit.mean(0, keepdims=True) - grand
inter = fit - grand - row - col
tot = ((fit - grand) ** 2).sum()
decomp = {'preset': float((row ** 2).sum() * S / tot), 'song': float((col ** 2).sum() * P / tot),
          'interaction': float((inter ** 2).sum() / tot)}
decomp['interaction_split_half_r'] = reliability
print(f'{P} reacting presets × {S} songs; variance of fit: preset {decomp["preset"]:.1%}, song {decomp["song"]:.1%}, '
      f'interaction {decomp["interaction"]:.1%} (split-half agreement of the interaction r = {reliability:.2f})', flush=True)

# ---------- song features ----------
def song_stats(signals, onset_scale=None):
    sig = signals.astype(np.float64)  # [S, F, 13]
    onset = np.maximum(0, np.diff(sig, axis=1))
    scale = onset.reshape(-1, sig.shape[-1]).std(0) if onset_scale is None else onset_scale
    return np.concatenate([sig.mean(1), sig.std(1), (onset > scale).mean(1)], -1), scale


g_raw, onset_scale = song_stats(d.signals)
g_mu, g_sd = g_raw[songs_train].mean(0), g_raw[songs_train].std(0) + 1e-9
g = (g_raw - g_mu) / g_sd

# ---------- preset dataflow profiles ----------
CH = [c.lower() for c in d.manifest['signals']['columns']]
ALIAS = {'mids': 'mid', 'med': 'mid', 'treble': 'treb', 'mids_att': 'mid_att', 'treble_att': 'treb_att',
         'bassatt': 'bass_att', 'midatt': 'mid_att', 'trebleatt': 'treb_att', 'vol_att': 'vol', 'beatpulse': 'beat_pulse'}
labels = json.load(open(args.labels))['presets']
u = np.zeros((P, len(CH)))
for i, pid in enumerate(presets):
    cols = labels.get(pid, {}).get('audioColumns', {})
    for signals in cols.values():
        for s_name in signals:
            s_name = ALIAS.get(s_name, s_name)
            if s_name in CH:
                u[i, CH.index(s_name)] += 1
    if cols:
        u[i] /= len(cols)
u = np.concatenate([u, np.ones((P, 1))], 1)  # + bias: a song-dependent shift shared by all presets


def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def top_k(pred, true, k=10):
    return len(set(np.argsort(-pred)[:k]) & set(np.argsort(-true)[:k])) / k


def fit_model(train_presets, lam):
    """Ridge for V in fit[p,s] - a_p ≈ u_p · V · g_s over training presets and songs."""
    a = fit[train_presets][:, songs_train].mean(1)
    R = fit[train_presets][:, songs_train] - a[:, None]  # [P', S']
    U, G = u[train_presets], g[songs_train]
    # vec(V) solves sum over (p,s) of (u_p ⊗ g_s) — Kronecker design
    X = np.einsum('pi,sj->psij', U, G).reshape(-1, U.shape[1] * G.shape[1])
    A = X.T @ X + lam * len(X) * np.eye(X.shape[1])
    V = np.linalg.solve(A, X.T @ R.reshape(-1)).reshape(U.shape[1], G.shape[1])
    return V


def evaluate(pred_presets, V, use_mean):
    rows = []
    for s in songs_test:
        true = fit[pred_presets, s]
        base = fit[pred_presets][:, songs_train].mean(1) if use_mean else np.zeros(len(pred_presets))
        pred = base + u[pred_presets] @ V @ g[s]
        fixed = fit[pred_presets][:, songs_train].mean(1) if use_mean else u[pred_presets] @ V.mean(1)
        rows.append({'model_spearman': spearman(pred, true), 'fixed_spearman': spearman(fixed, true),
                     'model_top10': top_k(pred, true), 'fixed_top10': top_k(fixed, true)})
    return {k: float(np.mean([r[k] for r in rows])) for k in rows[0]}


results = {'decomposition': decomp, 'presets': P}
all_p = np.arange(P)
for lam in (1e-3, 1e-2, 1e-1, 1.0):
    V = fit_model(all_p, lam)
    results[f'known presets, λ={lam:g}'] = evaluate(all_p, V, True)

# nearest songs: a known preset's fit on a new song is the mean of its fit on the
# k training songs closest in audio statistics (uses the interaction, no linear map)
for k in (3, 5, 8):
    rows = []
    for s_new in songs_test:
        dist = ((g[songs_train] - g[s_new]) ** 2).sum(1)
        near = [songs_train[i] for i in np.argsort(dist)[:k]]
        pred = fit[:, near].mean(1)
        fixed = fit[:, songs_train].mean(1)
        true = fit[:, s_new]
        rows.append({'model_spearman': spearman(pred, true), 'fixed_spearman': spearman(fixed, true),
                     'model_top10': top_k(pred, true), 'fixed_top10': top_k(fixed, true)})
    results[f'known presets, {k} nearest songs'] = {key: float(np.mean([r[key] for r in rows])) for key in rows[0]}
    results[f'known presets, {k} nearest songs']['songs_won_spearman'] = int(sum(r['model_spearman'] > r['fixed_spearman'] for r in rows))
    results[f'known presets, {k} nearest songs']['songs_won_top10'] = int(sum(r['model_top10'] > r['fixed_top10'] for r in rows))
    results[f'known presets, {k} nearest songs']['songs_tied_top10'] = int(sum(r['model_top10'] == r['fixed_top10'] for r in rows))
if args.ood:
    # train on the main songs, rank presets for songs in styles the generator never makes
    o = L.Data(args.ood).subset(presets)
    yo, _, _, mo = L.standardize_targets(o.states, list(range(o.S)))
    fit_o = fit_matrix(y=yo, moving=mo)
    go = (song_stats(o.signals, onset_scale)[0] - g_mu) / g_sd
    for k in (3, 5):
        rows = []
        for s_new in range(o.S):
            near = [songs_train[i] for i in np.argsort(((g[songs_train] - go[s_new]) ** 2).sum(1))[:k]]
            pred, fixed, true = fit[:, near].mean(1), fit[:, songs_train].mean(1), fit_o[:, s_new]
            rows.append({'model_spearman': spearman(pred, true), 'fixed_spearman': spearman(fixed, true),
                         'model_top10': top_k(pred, true), 'fixed_top10': top_k(fixed, true)})
        r = {key: float(np.mean([row[key] for row in rows])) for key in rows[0]}
        r['songs_won_spearman'] = int(sum(row['model_spearman'] > row['fixed_spearman'] for row in rows))
        r['songs_won_top10'] = int(sum(row['model_top10'] > row['fixed_top10'] for row in rows))
        r['songs_tied_top10'] = int(sum(row['model_top10'] == row['fixed_top10'] for row in rows))
        r['songs'] = o.S
        results[f'unfamiliar styles, {k} nearest songs'] = r

# unseen presets: hold out families (hash split as elsewhere)
import hashlib
fam_split = np.array([int(hashlib.sha1(f.encode()).hexdigest(), 16) % 100 < 70 for f in families])
tr_p, te_p = np.flatnonzero(fam_split), np.flatnonzero(~fam_split)
for lam in (1e-3, 1e-2, 1e-1, 1.0):
    V = fit_model(tr_p, lam)
    # an unseen preset has no training-song mean: rank by profile alone, against the training presets' mean as the fixed rank
    rows = []
    for s in songs_test:
        true = fit[te_p, s]
        pred = u[te_p] @ V @ g[s]
        fixed = u[te_p] @ V @ g[songs_train].mean(0)
        rows.append({'model_spearman': spearman(pred, true), 'fixed_spearman': spearman(fixed, true),
                     'model_top10': top_k(pred, true), 'fixed_top10': top_k(fixed, true)})
    results[f'unseen presets, λ={lam:g}'] = {k: float(np.mean([r[k] for r in rows])) for k in rows[0]}

print('\nper test song, mean over 8 held-out songs:')
for k, v in results.items():
    if isinstance(v, dict) and 'model_spearman' in v:
        print(f'  {k:28s} Spearman model {v["model_spearman"]:.3f} vs fixed {v["fixed_spearman"]:.3f}   '
              f'top-10 model {v["model_top10"]:.2f} vs fixed {v["fixed_top10"]:.2f}'
              + (f'   songs won: Spearman {v["songs_won_spearman"]}/{v.get("songs", 8)}, top-10 {v["songs_won_top10"]}/{v.get("songs", 8)} ({v["songs_tied_top10"]} tied)'
                 if 'songs_won_spearman' in v else ''))
json.dump(results, open(args.out, 'w'), indent=1)
print(f'wrote {args.out} ({time.time() - t0:.0f}s)')
