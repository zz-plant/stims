"""Out-of-distribution stimuli: styles the training generator never produces.
Same sample rate and length as the training songs; different structure."""
import numpy as np, wave, sys
from synth_songs import SR, env, kick, snare, hat, note

def write(name, x, outdir):
    x = x / max(1e-6, np.abs(x).max()) * 0.8
    with wave.open(f'{outdir}/{name}.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype('<i2').tobytes())

def ambient(rng, seconds):  # slow pads and swells, no percussion at all
    n = int(seconds * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for k in range(6):
        f = 55 * 2 ** (rng.integers(0, 24) / 12)
        swell = 0.5 + 0.5 * np.sin(2 * np.pi * t / rng.uniform(4, 9) + rng.uniform(0, 6.3))
        out += swell * (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.01 * t)) * 0.2
    return out

def breakbeat(rng, seconds):  # fast, syncopated, hat-heavy, with drops
    bpm = rng.uniform(185, 205); step = 60 / bpm / 4
    n = int(seconds * SR); out = np.zeros(n + SR); t0 = 0; s = 0
    while t0 < seconds:
        at = int(t0 * SR); bar = s // 16
        def add(x, g):
            e = min(len(out), at + len(x)); out[at:e] += g * x[: e - at]
        drop = bar % 4 == 3  # every fourth bar: drums out, only a rising noise
        if drop:
            if s % 4 == 0: add(rng.standard_normal(int(step * 4 * SR)) * np.linspace(0, 0.3, int(step * 4 * SR)), 1)
        else:
            if s % 16 in (0, 3, 6, 10, 11) or rng.random() < 0.1: add(kick(rng), 1)
            if s % 16 in (4, 12, 15): add(snare(rng), 0.8)
            add(hat(rng, s % 2 == 1 and rng.random() < 0.3), 1.2)
        t0 += step; s += 1
    return out[:n]

def sparse(rng, seconds):  # isolated hits separated by silence
    n = int(seconds * SR); out = np.zeros(n + SR); t = 0.0
    while t < seconds:
        x = kick(rng) if rng.random() < 0.6 else snare(rng); at = int(t * SR)
        e = min(len(out), at + len(x)); out[at:e] += x[: e - at]
        t += rng.uniform(0.4, 2.5)
    return out[:n]

def noisewash(rng, seconds):  # filtered noise bursts with a drone, no pitch structure
    n = int(seconds * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    gate = (np.sin(2 * np.pi * t * rng.uniform(0.3, 1.2)) > rng.uniform(0.2, 0.7)).astype(float)
    lp = np.convolve(noise * gate, np.ones(40) / 40, 'same')  # crude low-pass
    hp = noise * gate - lp
    return 0.5 * lp + 0.25 * hp + 0.2 * np.sin(2 * np.pi * 41 * t)

if __name__ == '__main__':
    seconds, outdir = float(sys.argv[1]), sys.argv[2]
    for k, (name, fn) in enumerate([('ambient', ambient), ('breakbeat', breakbeat), ('sparse', sparse), ('noisewash', noisewash)]):
        write(f'ood-{name}', fn(np.random.default_rng(500 + k), seconds), outdir)
        print(name)
