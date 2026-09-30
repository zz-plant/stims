"""Shared pieces for the neural-VJ experiments: data, features, metric, linear
and reservoir baselines, and paired statistics. Everything here is numpy."""
import json
import math
from pathlib import Path

import numpy as np

PERIODS = [0.5, 1, 2, 4, 2 * math.pi, 8, 16]
LAGS = [0, 4, 12, 30]
TAUS = [2, 4, 8, 16, 32, 64, 128, 256]
LAMBDAS = [1e-4, 1e-3, 1e-2, 1e-1, 1.0]
GROUPS = {
    'motion': ['zoom', 'zoomexp', 'rot', 'warp', 'warpanimspeed', 'warp_scale', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy'],
    'feedback': ['decay', 'gammaadj', 'video_echo_zoom', 'video_echo_alpha', 'video_echo_orientation', 'brighten',
                 'darken', 'darken_center', 'solarize', 'invert', 'texture_wrap'],
    'wave': [c for c in ['wave_mode', 'wave_x', 'wave_y', 'wave_r', 'wave_g', 'wave_b', 'wave_a', 'wave_mystery',
                         'wave_scale', 'wave_smoothing', 'wave_thick', 'wave_additive', 'wave_usedots', 'wave_brighten']],
    'borders': ['ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a', 'ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a'],
    'motion_vectors': ['motion_vectors_x', 'motion_vectors_y', 'mv_dx', 'mv_dy', 'mv_l', 'mv_r', 'mv_g', 'mv_b', 'mv_a'],
    'q': [f'q{i}' for i in range(1, 33)],
}


class Data:
    """lab:dataset export with audio-file scenarios, loaded fully into memory."""

    def __init__(self, root):
        root = Path(root)
        manifests = sorted(root.glob('manifest*.json'))
        self.manifest = json.loads(manifests[0].read_text())
        self.fps = self.manifest['fps']
        self.columns = self.manifest['states']['columns']
        rows = [json.loads(l) for f in sorted(root.glob('index*.jsonl')) for l in f.read_text().splitlines()]
        self.songs = sorted({r['scenario'] for r in rows})
        by = {(r['presetId'], r['scenario']): r for r in rows if r['status'] == 'ok'}
        self.presets = sorted({p for (p, _) in by if all((p, s) in by for s in self.songs)})
        self.families = [by[(p, self.songs[0])]['family'] for p in self.presets]
        bins = next(s['spectrumBins'] for s in self.manifest['scenarios'] if s['name'] == self.songs[0])
        self.signals = np.stack([np.load(root / 'signals' / f'{s}.npy').astype(np.float32) for s in self.songs])
        spec = np.stack([np.load(root / 'inputs' / f'{s}.npy')[:, :bins] for s in self.songs]).astype(np.float32) / 255
        edges = np.unique(np.round(np.geomspace(1, bins, 33)).astype(int))
        self.bands = np.stack([spec[..., a:b].mean(-1) for a, b in zip(edges[:-1], edges[1:])], -1)
        # float16 on disk stays float16 in memory: 160 presets × 32 songs × 900 frames × 88 columns is 0.8 GB this
        # way and 1.6 GB as float32; callers upcast per preset when they compute.
        self.states = np.empty((len(self.presets), len(self.songs)) + self.signals.shape[1:2] + (len(self.columns),),
                               np.float16)
        for i, p in enumerate(self.presets):
            for j, s in enumerate(self.songs):
                self.states[i, j] = np.load(root / by[(p, s)]['file'])
        # a preset whose values overflowed float16 on export (stored as ±inf) cannot be standardised: drop it
        finite = np.array([np.isfinite(self.states[i]).all() for i in range(len(self.presets))])
        if not finite.all():
            print(f'dropping {int((~finite).sum())} preset(s) with non-finite states: '
                  f'{[p for p, f in zip(self.presets, finite) if not f]}')
            keep = np.flatnonzero(finite)
            self.presets = [self.presets[i] for i in keep]
            self.families = [self.families[i] for i in keep]
            self.states = self.states[keep]
        self.S, self.F = self.signals.shape[:2]
        self.P, self.C = len(self.presets), len(self.columns)
        t = np.arange(self.F) / self.fps
        self.clock = np.concatenate(
            [np.stack([np.sin(2 * np.pi * t / T), np.cos(2 * np.pi * t / T)], 1) for T in PERIODS], 1
        ).astype(np.float32)

    def subset(self, preset_ids):
        """Keep only these presets (in this order); returns self."""
        idx = [self.presets.index(p) for p in preset_ids]
        self.presets = [self.presets[i] for i in idx]
        self.families = [self.families[i] for i in idx]
        self.states = self.states[idx]
        self.P = len(idx)
        return self

    def audio_stats(self, train_songs):
        """Standardisation statistics for the audio channels, from these songs only."""
        onset = np.maximum(0, np.diff(self.signals, axis=1, prepend=self.signals[:, :1]))
        stats = []
        for x in (self.signals, self.bands, onset):
            flat = x[train_songs].reshape(-1, x.shape[-1])
            stats.append((flat.mean(0), flat.std(0) + 1e-6))
        return stats

    def audio(self, train_songs=None, stats=None):
        """Per-frame audio channels: signals, spectrum bands, rectified onset
        strength of the signals; standardised with `stats` (default: this
        set's `train_songs`), so another set can be scaled like this one."""
        stats = stats or self.audio_stats(train_songs)
        onset = np.maximum(0, np.diff(self.signals, axis=1, prepend=self.signals[:, :1]))
        return np.concatenate([(x - m) / s for x, (m, s) in zip((self.signals, self.bands, onset), stats)],
                              -1).astype(np.float32)


def standardize_targets(states, fit_songs):
    """Per preset/column z-scores from `fit_songs`; moving = varies there.
    Computed one preset at a time; the result is float16 like the input."""
    P, S, F, C = states.shape
    z = np.empty(states.shape, np.float16)
    mu, sd = np.empty((P, C), np.float32), np.empty((P, C), np.float32)
    for p in range(P):
        st = states[p].astype(np.float32)
        fit = st[fit_songs].reshape(-1, C)
        mu[p], sd[p] = fit.mean(0), fit.std(0)
        s = np.where(sd[p] > 1e-6, sd[p], 1.0)
        z[p] = np.clip((st - mu[p]) / s, -10, 10)
    moving = sd > 1e-6
    sd = np.where(moving, sd, 1.0)
    return z, mu, sd, moving


def score(pred, target, moving, sd):
    """lab:vj-baseline's metric. pred/target [P,S,F,C] z-units; returns
    (per-preset median over moving columns, [P,C] per-column scores)."""
    a, b = np.asarray(target, np.float32), np.asarray(pred, np.float32)
    ss = ((a - a.mean(2, keepdims=True)) ** 2).sum(2)
    res = ((a - b) ** 2).sum(2)
    flat = ss < 1e-9
    r2 = np.where(flat, 0.0, np.maximum(-1.0, 1 - res / np.where(flat, 1, ss)))
    flat_ok = (np.abs(a - b).mean(2) * sd[:, None, :]) < 1e-3
    r2 = np.where(flat, flat_ok.astype(float), r2)
    col = r2.mean(1)  # over songs → [P,C]
    col = np.where(moving, col, np.nan)
    with np.errstate(all='ignore'):
        per = np.nanmedian(col, 1)
    return per, col


def group_scores(col, columns):
    out = {}
    for g, names in GROUPS.items():
        idx = [columns.index(n) for n in names if n in columns]
        with np.errstate(all='ignore'):
            vals = np.nanmedian(col[:, idx], 1)
        out[g] = float(np.nanmedian(vals)) if np.isfinite(vals).any() else float('nan')
    return out


def paired(a, b, n=2000, seed=0):
    """Median of per-preset differences a−b with a bootstrap 95% CI, and win rate."""
    d = (a - b)[np.isfinite(a - b)]
    rng = np.random.default_rng(seed)
    boots = np.median(d[rng.integers(0, len(d), (n, len(d)))], 1)
    return float(np.median(d)), float(np.quantile(boots, 0.025)), float(np.quantile(boots, 0.975)), float((d > 0).mean())


# ---------------- features ----------------

def lagged(x, lags=LAGS):
    """x [S,F,D] → [S,F,D*len(lags)], clamped at the first frame."""
    out = []
    for L in lags:
        out.append(x if L == 0 else np.concatenate([np.repeat(x[:, :1], L, 1), x[:, :-L]], 1))
    return np.concatenate(out, -1)


def leaky(x, taus=TAUS):
    """Leaky integrators (exponential moving averages) at several time constants."""
    S, F, D = x.shape
    out = np.empty((S, F, D * len(taus)), np.float32)
    alpha = np.repeat(1.0 / np.array(taus, np.float32), D)
    xs = np.tile(x, (1, 1, len(taus)))
    h = xs[:, 0].copy()
    for t in range(F):
        h += alpha * (xs[:, t] - h)
        out[:, t] = h
    return out


def reservoir(x, n=600, rho=0.9, in_scale=0.5, leaks=(0.02, 0.08, 0.3, 1.0), seed=0):
    """Echo-state network: fixed random recurrent units with mixed leak rates."""
    rng = np.random.default_rng(seed)
    S, F, D = x.shape
    win = rng.uniform(-1, 1, (D, n)) * (rng.random((D, n)) < 0.3) * in_scale
    w = rng.standard_normal((n, n)) * (rng.random((n, n)) < 10 / n)
    w *= rho / np.abs(np.linalg.eigvals(w)).max()
    b = rng.uniform(-0.2, 0.2, n)
    alpha = np.array(leaks)[np.arange(n) % len(leaks)]
    h = np.zeros((S, n))
    out = np.empty((S, F, n), np.float32)
    for t in range(F):
        h = (1 - alpha) * h + alpha * np.tanh(x[:, t] @ win + h @ w + b)
        out[:, t] = h
    return out


class SharedRidge:
    """Ridge regressions that share one design matrix (features depend on the
    song, not the preset): one eigendecomposition serves every preset and λ.
    Features are standardised (by `scaler`, default: fitted on the fitting
    rows) and targets are z-scored, so the intercept is zero and never
    penalised. Two instances given the same scaler share a feature space, so
    a readout fitted by one can serve as a prior for the other."""

    def __init__(self, feats, fit_songs, scaler=None):
        X = feats[fit_songs].reshape(-1, feats.shape[-1]).astype(np.float64)
        if scaler is None:
            sd = X.std(0)
            scaler = (X.mean(0), np.where(sd > 1e-8, sd, 1.0), sd > 1e-8)
        self.mu, self.sd, self.keep = scaler
        self.scaler = scaler
        self.X = self._apply(X)
        self.n = len(self.X)
        self.evals, self.V = np.linalg.eigh(self.X.T @ self.X)

    def _apply(self, X):
        return (X[:, self.keep] - self.mu[self.keep]) / self.sd[self.keep]

    def design(self, feats, songs):
        return self._apply(feats[songs].reshape(-1, feats.shape[-1]).astype(np.float64))

    def weights(self, Y, lams, prior=None):
        """Y [n,C] targets on the fitting rows → {λ: W}. With `prior` [D,C],
        W is shrunk toward it instead of toward zero."""
        if prior is not None:
            Y = Y - self.X @ prior
        proj = self.V.T @ (self.X.T @ Y)
        out = {lam: self.V @ (proj / (self.evals + lam * self.n)[:, None]) for lam in lams}
        return {lam: W + prior for lam, W in out.items()} if prior is not None else out


# ---------------- what audio contributes ----------------

def time_profile(y, fit_songs):
    """The clock oracle and the audio share, from `fit_songs` (z-units).

    mean_traj [P,F,C]: each preset's average trajectory over those songs, the
    best any model that only knows the time can do.
    share [P,C]: fraction of each column's variance that differs between
    songs at the same frame, i.e. is driven by the audio rather than the clock."""
    P, S, F, C = y.shape
    mean_traj = np.empty((P, F, C), np.float32)
    share = np.zeros((P, C), np.float32)
    for p in range(P):
        x = y[p, fit_songs].astype(np.float32)
        mean_traj[p] = x.mean(0)
        tot, between = x.reshape(-1, C).var(0), x.var(0).mean(0)
        share[p] = np.where(tot > 1e-8, between / np.maximum(tot, 1e-12), 0)
    return mean_traj, share


def score_audio(pred, target, mean_traj, audio_cols):
    """Audio R²: the share of between-song variation (target − mean_traj) a
    prediction explains, pooled over songs and frames so a quiet song cannot
    blow up the ratio. 0 = the clock oracle, 1 = perfect, clamped at −1.
    pred/target [P,S,F,C]; audio_cols [P,C] selects the columns scored.
    Returns (per-preset median over its audio columns, [P,C])."""
    a = np.asarray(target, np.float32) - mean_traj[:, None]
    b = np.asarray(pred, np.float32) - mean_traj[:, None]
    ss, res = (a ** 2).sum((1, 2)), ((a - b) ** 2).sum((1, 2))
    r2 = np.where(ss > 1e-9, np.maximum(-1.0, 1 - res / np.maximum(ss, 1e-12)), np.nan)
    col = np.where(audio_cols, r2, np.nan)
    with np.errstate(all='ignore'):
        per = np.nanmedian(col, 1)
    return per, col
