"""Independent check of the LightGBM rung on a sample of presets.
1. Refit from scratch (fresh data build, no shared code path with lgbm_rung) and score held-out songs.
2. Permutation: predict each test song with ANOTHER test song's audio features. A model that uses
   the audio must collapse to <= 0 here; a high score would mean leakage.
3. Same two checks for ridge+ as a reference."""
import sys
import numpy as np, lightgbm as lgb, vj_lab as L
DATA, OOD = (sys.argv[1:3] + ["data", "ood"][len(sys.argv[1:3]):])
rng = np.random.default_rng(0)
d = L.Data(DATA); o = L.Data(OOD)
common = [p for p in d.presets if p in set(o.presets)]; d.subset(common); del o
S = d.S; train, val, test = list(range(S - 8)), list(range(S - 8, S - 4)), list(range(S - 4, S))
y, mu, sd, moving = L.standardize_targets(d.states, train); del d.states
mt, share = L.time_profile(y, train); ac = moving & (share >= 0.1)
audio = d.audio(stats=d.audio_stats(train))
clock = np.broadcast_to(d.clock, (S, d.F, d.clock.shape[1]))
feats = np.concatenate([clock, audio, L.leaky(audio)], -1).astype(np.float32)
presets = rng.choice(np.flatnonzero(ac.any(1)), 12, replace=False)
perm = [test[(i + 1) % 4] for i in range(4)]  # song k is predicted from song k+1's audio
params = {'objective': 'l2', 'learning_rate': 0.05, 'num_leaves': 15, 'min_data_in_leaf': 40, 'feature_fraction': 0.5,
          'bagging_fraction': 0.8, 'bagging_freq': 1, 'lambda_l2': 1.0, 'num_threads': 1, 'verbose': -1, 'max_bin': 63}
Xtr = feats[train][:, ::3].reshape(-1, feats.shape[-1]); Xv = feats[val][:, ::3].reshape(-1, feats.shape[-1])
r = L.SharedRidge(feats, train)
out = {k: [] for k in ('lgb', 'lgb_perm', 'ridge', 'ridge_perm')}
for p in presets:
    preds = {k: np.broadcast_to(mt[p][None], (4, d.F, d.C)).astype(np.float32).copy() for k in out}
    res_tr = (y[p, train].astype(np.float32) - mt[p]); res_v = (y[p, val].astype(np.float32) - mt[p])
    W = r.weights(res_tr.reshape(-1, d.C), [1e-2])[1e-2]
    preds['ridge'] += (r.design(feats, test) @ W).reshape(4, d.F, d.C)
    preds['ridge_perm'] += (r.design(feats, perm) @ W).reshape(4, d.F, d.C)
    for c in np.flatnonzero(ac[p]):
        m = lgb.train(params, lgb.Dataset(Xtr, res_tr[:, ::3, c].reshape(-1)), 400,
                      valid_sets=[lgb.Dataset(Xv, res_v[:, ::3, c].reshape(-1))], callbacks=[lgb.early_stopping(30, verbose=False)])
        preds['lgb'][..., c] += m.predict(feats[test].reshape(-1, feats.shape[-1]), num_iteration=m.best_iteration).reshape(4, d.F)
        preds['lgb_perm'][..., c] += m.predict(feats[perm].reshape(-1, feats.shape[-1]), num_iteration=m.best_iteration).reshape(4, d.F)
    for k in out:
        per, _ = L.score_audio(preds[k][None], y[p, test][None], mt[p][None], ac[p][None])
        out[k].append(per[0])
print(f'{len(presets)} random audio-reactive presets, 4 held-out songs')
for k, v in out.items():
    print(f'  {k:11s} median audio R² {np.nanmedian(v):6.3f}   per preset: {np.round(v, 2).tolist()}')
