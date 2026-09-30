"""Self-supervised trunk pretraining on audio-only exports (no VM targets).

  python pretrain_job.py --dirs pre/a pre/b pre/c --kind ssm --layers 4 --seed 0 --steps 1000 --out trunk.pt

The trunk learns to predict the spectrum bands 4, 16 and 64 frames ahead
from its causal features. Hundreds of songs cost only audio analysis, so
this tests whether more *audio* (rather than more VM runs) is what limits
generalisation to held-out songs.
"""
import argparse
import time

import numpy as np
import torch

import vj_lab as L
from vj_models import SharedTrunkNet, future_loss

ap = argparse.ArgumentParser()
ap.add_argument('--dirs', nargs='+', required=True)
ap.add_argument('--kind', default='ssm')
ap.add_argument('--layers', type=int, default=4)
ap.add_argument('--seed', type=int, default=0)
ap.add_argument('--steps', type=int, default=1000)
ap.add_argument('--songs', type=int, default=8)
ap.add_argument('--threads', type=int, default=1)
ap.add_argument('--out', required=True)
args = ap.parse_args()
torch.manual_seed(args.seed)
np.random.seed(args.seed)
torch.set_num_threads(args.threads)
t0 = time.time()

sets = [L.Data(p) for p in args.dirs]
signals = np.concatenate([s.signals for s in sets])
bands = np.concatenate([s.bands for s in sets])
base = sets[0]
base.signals, base.bands = signals, bands
S = len(signals)
stats = base.audio_stats(list(range(S)))
audio = base.audio(stats=stats)
clock = np.broadcast_to(base.clock, (S, base.F, base.clock.shape[1]))
x_all = torch.from_numpy(np.concatenate([audio, clock], -1).astype(np.float32))
bands_z = torch.from_numpy(((bands - stats[1][0]) / stats[1][1]).astype(np.float32))
n_val = max(1, min(16, S // 5))
val = list(range(S - n_val, S))
train = list(range(S - n_val))
print(f'pretraining on {len(train)} songs, validating on {len(val)}', flush=True)

net = SharedTrunkNet(x_all.shape[-1], 1, 1, kind=args.kind, layers=args.layers, n_bands=bands.shape[-1])
opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=args.steps, pct_start=0.1)
best, state = np.inf, None
for step in range(1, args.steps + 1):
    s = torch.from_numpy(np.random.choice(train, args.songs, replace=False))
    loss = future_loss(net, net.features(x_all[s] + 0.05 * torch.randn(len(s), base.F, x_all.shape[-1])), bands_z[s])
    opt.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
    opt.step()
    sched.step()
    if step % 100 == 0 or step == args.steps:
        net.eval()
        with torch.no_grad():
            vl = float(np.mean([future_loss(net, net.features(x_all[val[i:i + 8]]), bands_z[val[i:i + 8]]).item() for i in range(0, len(val), 8)]))
        net.train()
        if vl < best:
            best, state = vl, {k: v.clone() for k, v in net.trunk.state_dict().items()}
        print(f'step {step}: future-band mse train {loss.item():.3f} val {vl:.3f} ({time.time() - t0:.0f}s)', flush=True)
torch.save({'trunk': state, 'audio_stats': stats, 'kind': args.kind, 'layers': args.layers, 'val': best}, args.out)
print(f'saved {args.out} (val {best:.3f}, {time.time() - t0:.0f}s)')
