"""Synthesise varied, music-like songs (drums, bass, chords, dynamics) as WAVs.
Each song gets its own tempo, pattern, key, instrumentation and arrangement,
so held-out songs are genuinely new stimuli rather than resampled ones."""
import numpy as np, wave, sys
SR = 44100

def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(t / max(attack, 1e-4), 1) * np.exp(-t / decay)

def kick(rng):
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 50 + rng.uniform(60, 120) * np.exp(-t * rng.uniform(25, 45))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, rng.uniform(0.12, 0.3))

def snare(rng):
    n = int(0.25 * SR)
    noise = rng.standard_normal(n) * env(n, 0.001, rng.uniform(0.05, 0.12))
    tone = np.sin(2 * np.pi * rng.uniform(170, 240) * np.arange(n) / SR) * env(n, 0.001, 0.06)
    return 0.6 * noise + 0.5 * tone

def hat(rng, open_=False):
    n = int((0.25 if open_ else 0.06) * SR)
    x = np.diff(rng.standard_normal(n + 1))  # crude high-pass
    return 0.25 * x * env(n, 0.0005, 0.12 if open_ else 0.02)

def note(freq, dur, rng, kind):
    n = int(dur * SR); t = np.arange(n) / SR
    if kind == 'saw':
        x = 2 * ((t * freq) % 1) - 1
    elif kind == 'square':
        x = np.sign(np.sin(2 * np.pi * freq * t))
    else:
        x = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(4 * np.pi * freq * t)
    return x * env(n, 0.005, dur * rng.uniform(0.4, 1.2))

def song(seed, seconds):
    rng = np.random.default_rng(seed)
    bpm = rng.uniform(70, 175); beat = 60 / bpm; step = beat / 4
    swing = rng.uniform(0, 0.25) * step
    root = 55 * 2 ** (rng.integers(0, 12) / 12)
    scale = [0, 3, 5, 7, 10] if rng.random() < 0.5 else [0, 2, 4, 7, 9]
    kick_pat = rng.random(16) < rng.uniform(0.15, 0.4); kick_pat[0] = True
    snare_pat = np.zeros(16, bool); snare_pat[[4, 12]] = rng.random() < 0.85
    snare_pat |= rng.random(16) < 0.06
    hat_pat = rng.random(16) < rng.uniform(0.3, 0.95)
    bass_pat = rng.random(16) < rng.uniform(0.2, 0.6)
    bass_notes = rng.choice(scale, 16) + 12 * rng.integers(0, 2, 16)
    lead_kind = rng.choice(['saw', 'square', 'sine'])
    chord_every = int(rng.choice([4, 8, 16]))
    mix = rng.uniform(0.3, 1.0, 5)  # kick, snare, hat, bass, chords
    n = int(seconds * SR); out = np.zeros(n + SR)
    # Arrangement: sections of 4–8 bars, each muting some parts.
    bar = 16 * step; t0 = 0.0; section_parts = np.ones(5, bool)
    s = 0
    while t0 < seconds:
        if s % 16 == 0:
            section_parts = rng.random(5) < 0.8
            section_parts[rng.integers(0, 5)] = True
            section_gain = rng.uniform(0.4, 1.0)
        i = s % 16
        at = int((t0 + (swing if i % 2 else 0)) * SR)
        def add(x, g):
            end = min(len(out), at + len(x)); out[at:end] += g * section_gain * x[: end - at]
        if section_parts[0] and kick_pat[i]: add(kick(rng), mix[0])
        if section_parts[1] and snare_pat[i]: add(snare(rng), mix[1] * 0.7)
        if section_parts[2] and hat_pat[i]: add(hat(rng, rng.random() < 0.1), mix[2])
        if section_parts[3] and bass_pat[i]:
            add(note(root * 2 ** (bass_notes[i] / 12), step * rng.uniform(0.8, 2), rng, 'saw' if lead_kind != 'saw' else 'sine'), mix[3] * 0.5)
        if section_parts[4] and s % chord_every == 0:
            deg = rng.choice(scale)
            for iv in (0, 4 if 4 in scale else 3, 7):
                add(note(root * 4 * 2 ** ((deg + iv) / 12), step * chord_every, rng, lead_kind), mix[4] * 0.12)
        t0 += step; s += 1
    out = out[:n]
    out /= max(1e-6, np.abs(out).max()) / rng.uniform(0.5, 0.95)
    return (out * 32767).astype('<i2'), bpm

if __name__ == '__main__':
    count, seconds, outdir = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
    for k in range(count):
        pcm, bpm = song(1000 + k, seconds)
        with wave.open(f'{outdir}/song{k:02d}.wav', 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
        print(f'song{k:02d} {bpm:.0f} bpm')
