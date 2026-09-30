"""Deep sequence models for the neural-VJ experiments (CPU PyTorch).

Design: a trunk shared by every preset turns a song's audio into a bank of
learned history features; each preset is a linear readout over that bank.
One trunk pass per song therefore serves all presets, and an unseen preset
needs only a new readout, which has a closed form (see run_fewshot.py).
"""
import math

import torch
import torch.nn as nn
import torch.nn.functional as Fn


class GatedCausalConv(nn.Module):
    def __init__(self, h, dilation):
        super().__init__()
        self.pad = 2 * dilation
        self.conv = nn.Conv1d(h, 2 * h, 3, dilation=dilation)

    def forward(self, x):  # [B,H,T]
        a, g = self.conv(Fn.pad(x, (self.pad, 0))).chunk(2, 1)
        return torch.tanh(a) * torch.sigmoid(g)


class DiagSSM(nn.Module):
    """Diagonal complex linear state space (S4D/LRU style) run as a causal
    FFT convolution over the whole sequence. Each channel mixes N damped
    oscillators whose timescales start log-uniform in [tmin, tmax] frames."""

    def __init__(self, h, n=32, tmin=1.0, tmax=1000.0):
        super().__init__()
        tau = torch.exp(torch.empty(h, n).uniform_(math.log(tmin), math.log(tmax)))
        self.log_rate = nn.Parameter(torch.log(1 / tau))
        self.theta = nn.Parameter(torch.empty(h, n).uniform_(0, math.pi / 4))
        self.c = nn.Parameter(torch.randn(h, n, 2) / math.sqrt(n))
        self.d = nn.Parameter(torch.ones(h))

    def kernel(self, length):
        r = torch.exp(self.log_rate)[..., None]
        steps = torch.arange(length, dtype=torch.float32)
        mag = torch.exp(-r * steps)
        ang = self.theta[..., None] * steps
        norm = torch.sqrt(1 - torch.exp(-2 * r)).clamp_min(1e-4)  # bounded gain per mode
        return (norm * mag * (self.c[..., 0, None] * torch.cos(ang) - self.c[..., 1, None] * torch.sin(ang))).sum(1)

    def forward(self, x):  # [B,H,T]
        length = x.shape[-1]
        k = self.kernel(length)
        y = torch.fft.irfft(torch.fft.rfft(x, 2 * length) * torch.fft.rfft(k, 2 * length), 2 * length)[..., :length]
        return y + x * self.d[:, None]


class MinGRU(nn.Module):
    """minGRU (Feng et al. 2024, "Were RNNs All We Needed?"): a gated recurrence
    whose gates depend only on the current input, h_t = (1−z_t)·h_{t−1} + z_t·h̃_t,
    so how fast the state moves is decided by the audio (selective, as in Mamba).
    Trained with a log-space parallel scan (Heinsen 2023) over the whole song.
    Gate biases start spread over [−7, 0] so timescales span ~1 to ~1000 frames."""

    def __init__(self, h):
        super().__init__()
        self.z = nn.Linear(h, h)
        self.h = nn.Linear(h, h)
        with torch.no_grad():
            self.z.bias.uniform_(-7.0, 0.0)

    @staticmethod
    def _log_g(x):  # log of g(x) = x+0.5 (x≥0) or sigmoid(x): keeps the candidate state positive
        return torch.where(x >= 0, torch.log(Fn.relu(x) + 0.5), -Fn.softplus(-x))

    def forward(self, x):  # [B,H,T] → [B,H,T]
        x = x.transpose(1, 2)
        k = self.z(x)
        log_z, log_coef = -Fn.softplus(-k), -Fn.softplus(k)  # log z, log(1−z)
        log_values = log_z + self._log_g(self.h(x))
        a_star = torch.cumsum(log_coef, 1)
        h = torch.exp(a_star + torch.logcumsumexp(log_values - a_star, 1))
        return h.transpose(1, 2)


class Block(nn.Module):
    def __init__(self, h, kind, dilation, dropout):
        super().__init__()
        self.norm = nn.LayerNorm(h)
        self.mix = DiagSSM(h) if kind == 'ssm' else MinGRU(h) if kind == 'mingru' else GatedCausalConv(h, dilation)
        self.ff = nn.Linear(h, 2 * h)
        self.drop = nn.Dropout(dropout)
        self.kind = kind

    def forward(self, x):  # [B,T,H]
        y = self.mix(self.norm(x).transpose(1, 2)).transpose(1, 2)
        if self.kind in ('ssm', 'mingru'):
            y = Fn.gelu(y)
        a, g = self.ff(y).chunk(2, -1)
        return x + self.drop(a * torch.sigmoid(g))


class Trunk(nn.Module):
    """Audio (+clock) sequence → feature bank [B,T,2H]: the residual stream
    plus a gated nonlinear expansion of it, so linear readouts get both."""

    def __init__(self, d_in, h=128, kind='ssm', layers=4, dropout=0.1):
        super().__init__()
        self.inp = nn.Linear(d_in, h)
        self.blocks = nn.ModuleList(Block(h, kind, 2 ** i, dropout) for i in range(layers))
        self.norm = nn.LayerNorm(h)
        self.expand = nn.Linear(h, 2 * h)
        self.width = 2 * h
        self.receptive_field = 1 + 2 * sum(2 ** i for i in range(layers)) if kind == 'tcn' else None

    def forward(self, x):
        z = self.inp(x)
        for blk in self.blocks:
            z = blk(z)
        z = self.norm(z)
        a, g = self.expand(z).chunk(2, -1)
        return torch.cat([z, a * torch.sigmoid(g)], -1)


class SharedTrunkNet(nn.Module):
    """Shared trunk + one linear readout per preset, with a learned
    per-(preset, column) log-variance so the Gaussian NLL weights columns
    by how predictable they turn out to be (Kendall & Gal style).

    rank=None: a full [W,C] readout per preset.
    rank=r:    readouts are mixtures of r shared basis readouts,
               W_p = Σ_k coef[p,k] · basis[k]: a dictionary of "ways to read
               audio" that a new preset can be fitted into from very little
               data (see run_fewshot.py)."""

    def __init__(self, d_in, presets, cols, kind='ssm', h=96, layers=4, rank=None, n_bands=28):
        super().__init__()
        self.trunk = Trunk(d_in, h, kind, layers)
        self.rank = rank
        if rank:
            self.coef = nn.Parameter(torch.randn(presets, rank) / math.sqrt(rank))
            self.basis = nn.Parameter(torch.randn(rank, self.trunk.width, cols) * 0.01)
        else:
            self.w = nn.Parameter(torch.randn(presets, self.trunk.width, cols) * 0.01)
        self.b = nn.Parameter(torch.zeros(presets, cols))
        self.log_var = nn.Parameter(torch.zeros(presets, cols))
        # self-supervised auxiliary head: future spectrum bands at several horizons
        self.n_bands = n_bands
        self.future = nn.Linear(self.trunk.width, 3 * n_bands)

    def features(self, x):
        return self.trunk(x)

    def head_weights(self, p):
        if self.rank:
            return torch.einsum('pk,kwc->pwc', self.coef[p], self.basis)
        return self.w[p]

    def readout(self, feats, p):
        """feats [B,T,W], p [P'] → [B,P',T,C]: one GEMM for all requested presets."""
        b, t, w = feats.shape
        W = self.head_weights(p).permute(1, 0, 2).reshape(w, -1)  # [W, P'*C]
        out = (feats.reshape(b * t, w) @ W).view(b, t, len(p), -1).permute(0, 2, 1, 3)
        return out + self.b[p][None, :, None]

    def forward(self, x, p):
        return self.readout(self.features(x), p)


def future_loss(net, feats, bands, horizons=(4, 16, 64)):
    """Self-supervised: predict the standardised spectrum bands `h` frames
    ahead from the causal features. feats [B,T,W], bands [B,T,32]."""
    pred = net.future(feats).view(feats.shape[0], feats.shape[1], len(horizons), net.n_bands)
    loss = 0.0
    for i, h in enumerate(horizons):
        loss = loss + ((pred[:, :-h, i] - bands[:, h:]) ** 2).mean()
    return loss / len(horizons)


def gaussian_nll(pred, y, log_var, mask):
    """pred/y [B,P',T,C], log_var [P',C], mask [P',C] (moving columns)."""
    m = mask[None, :, None, :]
    lv = log_var[None, :, None, :]
    nll = 0.5 * (((pred - y) ** 2) * torch.exp(-lv) + lv)
    return (nll * m).sum() / (m.sum() * pred.shape[2] + 1e-6)


def masked_mse(pred, y, mask):
    m = mask[None, :, None, :]
    return (((pred - y) ** 2) * m).sum() / (m.sum() * pred.shape[2] + 1e-6)
