"""One training job: a shared trunk + per-preset heads, run as its own process.

  python train_job.py config.json

config keys: data, ood (optional), kind, layers, rank, seed, steps, songs,
presets_per_step, threads, init (optional pretrained trunk .pt),
train_songs, val_songs, fit_songs (target standardisation), train_presets
(indices; heads are trained for these only), out (.npz).

Saves the trunk's feature bank for every song (and OOD song), the head
weights, and the validation curve, so the orchestrator can fit closed-form
readouts and ensembles without re-running anything.
"""
import json
import sys
import time

import numpy as np
import torch

import vj_lab as L
from vj_models import SharedTrunkNet, gaussian_nll

cfg = json.load(open(sys.argv[1]))
torch.manual_seed(cfg['seed'])
np.random.seed(cfg['seed'])
torch.set_num_threads(cfg.get('threads', 1))
t0 = time.time()

d = L.Data(cfg['data'])
train, val, fit = cfg['train_songs'], cfg['val_songs'], cfg['fit_songs']
P_tr = np.array(cfg['train_presets'])
y, mu, sd, moving = L.standardize_targets(d.states, fit)
del d.states
if cfg.get('residual'):
    # learn only what differs between songs: the clock oracle (mean trajectory over the training songs) is
    # subtracted, and only columns whose variance is at least `audio_min` audio-driven carry loss
    mean_traj, share = L.time_profile(y, train)
    for p in range(d.P):
        y[p] = (y[p].astype(np.float32) - mean_traj[p]).astype(np.float16)
    moving = moving & (share >= cfg.get('audio_min', 0.1))
    P_tr = P_tr[moving[P_tr].any(1)]
    print(f'residual targets: {int(moving.sum())} audio-driven (preset, column) pairs over {len(P_tr)} presets', flush=True)
init = torch.load(cfg['init'], weights_only=False) if cfg.get('init') else None
stats = init['audio_stats'] if init else d.audio_stats(train)
audio = d.audio(stats=stats)
clock = np.broadcast_to(d.clock, (d.S, d.F, d.clock.shape[1]))
x_all = torch.from_numpy(np.concatenate([audio, clock], -1).astype(np.float32))
x_ood = None
if cfg.get('ood'):
    o = L.Data(cfg['ood'])
    x_ood = torch.from_numpy(np.concatenate([o.audio(stats=stats), np.broadcast_to(o.clock, (o.S, o.F, o.clock.shape[1]))], -1).astype(np.float32))
    del o
y_t = torch.from_numpy(y)
mask_t = torch.from_numpy(moving.astype(np.float32))

net = SharedTrunkNet(x_all.shape[-1], d.P, d.C, kind=cfg['kind'], layers=cfg['layers'], rank=cfg.get('rank'))
if init:
    net.trunk.load_state_dict(init['trunk'])
    print(f'initialised trunk from {cfg["init"]}', flush=True)
opt = torch.optim.AdamW(net.parameters(), lr=cfg.get('lr', 2e-3), weight_decay=1e-4)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=cfg.get('lr', 2e-3), total_steps=cfg['steps'], pct_start=0.1)


def bank(x):
    net.eval()
    with torch.no_grad():
        out = torch.cat([net.features(x[i:i + 8]) for i in range(0, len(x), 8)])
    net.train()
    return out


def val_mse():
    feats = bank(x_all[val])
    with torch.no_grad():
        pred = net.readout(feats, torch.from_numpy(P_tr)).numpy()  # [S_val, P_tr, F, C]
    m = moving[P_tr][None, :, None, :]
    return float((((pred - y[P_tr][:, val].transpose(1, 0, 2, 3).astype(np.float32)) ** 2) * m).sum() / (m.sum() * len(val) * d.F))


best, state, curve = np.inf, None, []
for step in range(1, cfg['steps'] + 1):
    s = torch.from_numpy(np.random.choice(train, min(cfg['songs'], len(train)), replace=False))
    p = torch.from_numpy(np.random.choice(P_tr, min(cfg['presets_per_step'], len(P_tr)), replace=False))
    x = x_all[s] + 0.05 * torch.randn(len(s), d.F, x_all.shape[-1])
    loss = gaussian_nll(net(x, p), y_t[p][:, s].transpose(0, 1).float(), net.log_var[p], mask_t[p])
    opt.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
    opt.step()
    sched.step()
    if step % 100 == 0 or step == cfg['steps']:
        vl = val_mse()
        curve.append((step, float(loss.item()), vl))
        if vl < best:
            best, state = vl, {k: v.clone() for k, v in net.state_dict().items()}
        print(f'step {step}: nll {loss.item():.3f} val mse {vl:.3f} ({time.time() - t0:.0f}s)', flush=True)
net.load_state_dict(state)
with torch.no_grad():
    allp = torch.arange(d.P)
    out = {'bank': bank(x_all).numpy(), 'heads_w': net.head_weights(allp).numpy(), 'heads_b': net.b.numpy(),
           'log_var': net.log_var.numpy(), 'val_mse': best, 'curve': np.array(curve),
           'n_params': sum(q.numel() for q in net.parameters()), 'config': json.dumps(cfg)}
    if x_ood is not None:
        out['bank_ood'] = bank(x_ood).numpy()
    if cfg.get('rank'):
        out['basis'] = net.basis.numpy()
        out['coef'] = net.coef.numpy()
np.savez(cfg['out'], **out)
print(f'saved {cfg["out"]}: best val mse {best:.3f}, {out["n_params"] / 1e6:.2f}M params, {time.time() - t0:.0f}s')
