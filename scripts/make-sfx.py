#!/usr/bin/env python3
"""
scripts/make-sfx.py — renders the two signature game sounds from scratch (no samples, no copyrighted material).

    python3 scripts/make-sfx.py            ->  public/sounds/game-start.mp3 , game-over.mp3   (stereo, long cues)
                                               public/sounds/walk-a.wav , walk-b.wav , food.wav  (mono, tiny cues)
    python3 scripts/make-sfx.py --wav      ->  also keeps the .wav masters of the two long cues

Needs: numpy, scipy, ffmpeg (libmp3lame).  Deterministic (fixed noise seed), so every run gives the same files.

GAME START  "Power-up"  (~1.3 s)   sub thump -> filtered noise riser -> fast rising C-major bell arpeggio -> bright
                                    open chord with a few high sparkles.  Major, rising, quick: "go!".
GAME OVER   "Crash & fade" (~2.2 s) hard impact (sub drop + crack) -> pitch-dropping, bit-crushed buzz -> sad falling
                                    minor phrase that ends on a drooping note.  Minor, falling, slow: "you lost".
WALK a / b  "Slither"      (~70 ms) soft band-passed noise "ssf" + a tiny low tap. Two variants (played alternately, with
                                    a little random pitch in the game) so a long run never sounds like a machine gun.
                                    Quiet on purpose: it plays on every step.
FOOD        "Bite & blip"  (~230 ms) crunchy double noise-burst + low pop, then a bright G5 -> C6 blip (same key as the
                                    start / game-over cues).  The game raises its pitch on quick consecutive bites.

The four short cues are WAV (not MP3) on purpose: MP3 adds encoder padding, which would delay a 70 ms step sound.
"""
import os
import subprocess
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
rng = np.random.default_rng(7)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "sounds")


# ------------------------------------------------------------------ building blocks
def tt(d):
    return np.arange(int(d * SR)) / SR


def mono_to_stereo(x, pan=0.0):
    a = (pan + 1) * np.pi / 4  # equal-power pan, -1 .. +1
    return np.stack([x * np.cos(a), x * np.sin(a)])


class Mix:
    """Stereo buffer you can drop sounds into at a time offset."""

    def __init__(self, dur):
        self.buf = np.zeros((2, int(dur * SR)))

    def add(self, x, start, gain=1.0, pan=0.0):
        i = int(start * SR)
        st = mono_to_stereo(x, pan) * gain
        n = min(st.shape[1], self.buf.shape[1] - i)
        if n > 0:
            self.buf[:, i:i + n] += st[:, :n]


def env(n_or_t, attack=0.003, tau=0.2):
    """fast attack, exponential decay"""
    t = n_or_t if isinstance(n_or_t, np.ndarray) else tt(n_or_t)
    release = np.minimum(1, (t[-1] - t) / 0.03)  # 30 ms release so a sound never ends on a click
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / tau) * release


def tv_filter(x, f0, f1, kind="low", order=2, block=512):
    """Filter whose cutoff glides exponentially from f0 to f1 over the whole signal (block-wise Butterworth)."""
    n = len(x)
    y = np.zeros(n)
    nb = int(np.ceil(n / block))
    zi = None
    for b in range(nb):
        i0, i1 = b * block, min(n, (b + 1) * block)
        f = min(f0 * (f1 / f0) ** ((b + 0.5) / nb), SR * 0.45)
        sos = signal.butter(order, f, btype=kind, fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        y[i0:i1], zi = signal.sosfilt(sos, x[i0:i1], zi=zi)
    return y


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="high", fs=SR, output="sos"), x)


def bell(freq, dur, tau, bright=1.0, droop_cents=0.0):
    """Soft pluck/bell: sine + decaying 2nd/3rd partials + a slightly detuned triangle for warmth."""
    t = tt(dur)
    f = freq * 2 ** ((-droop_cents / 1200) * (t / dur))  # optional downward pitch droop
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph)
         + 0.38 * bright * np.sin(2 * ph) * np.exp(-t / (tau * 0.55))
         + 0.16 * bright * np.sin(3.01 * ph) * np.exp(-t / (tau * 0.3))
         + 0.22 * signal.sawtooth(ph * 1.004, 0.5))
    return x * env(t, 0.003, tau)


def reverb(mix, rt=0.9, wet=0.2, predelay=0.014, tail=None):
    """Decorrelated stereo noise-IR reverb. Adds a tail so decays are not chopped."""
    tail = rt if tail is None else tail
    n_tail = int(tail * SR)
    padded = np.concatenate([mix.buf, np.zeros((2, n_tail))], axis=1)
    out = padded.copy()
    for ch in range(2):
        n = int(rt * 1.4 * SR)
        ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * (6.9 / rt))  # -60 dB at rt seconds
        ir = lp(ir, 5500)
        ir[: int(predelay * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))  # unit energy -> `wet` is a predictable level
        out[ch] += wet * signal.fftconvolve(padded[ch], ir)[: padded.shape[1]]
    return out


def master(x, peak_db=-1.5, fade_out=0.05):
    x = np.tanh(x * 1.15) / np.tanh(1.15)  # gentle saturation = glue / soft limiter
    n_in, n_out = int(0.002 * SR), int(fade_out * SR)
    x[:, :n_in] *= np.linspace(0, 1, n_in)
    x[:, -n_out:] *= np.linspace(1, 0, n_out)
    # trim trailing near-silence
    mag = np.max(np.abs(x), axis=0)
    last = np.nonzero(mag > 10 ** (-42 / 20) * mag.max())[0]
    x = x[:, : last[-1] + n_out] if len(last) else x
    x[:, -n_out:] *= np.linspace(1, 0, n_out)
    return x * (10 ** (peak_db / 20) / np.max(np.abs(x)))


# ------------------------------------------------------------------ GAME START  "Power-up"
def game_start():
    m = Mix(1.6)

    # 1) sub thump — gives the start some weight
    t = tt(0.35)
    f = 48 + 100 * np.exp(-t / 0.035)
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 0.002, 0.11)
    m.add(thump, 0.0, 0.55)

    # 2) riser: noise, band opens from 300 Hz to 7 kHz, swells then cuts right before the arpeggio lands
    t = tt(0.30)
    noise = rng.standard_normal(len(t))
    riser = tv_filter(hp(noise, 250), 600, 7000, "low", 2)
    riser *= (t / t[-1]) ** 1.6 * np.minimum(1, (t[-1] - t) / 0.02)
    m.add(riser, 0.04, 0.16, pan=0.0)

    # 3) rising C-major bell arpeggio  C5 E5 G5 C6  (tiny stereo spread so it feels wide)
    notes = [523.25, 659.25, 783.99, 1046.50]
    for i, fr in enumerate(notes):
        m.add(bell(fr, 0.55, 0.16, 1.0), 0.14 + i * 0.07, 0.34, pan=-0.35 + 0.23 * i)

    # 4) the "go" chord  C5 + E5 + G5 + C6 + E6, open and bright, with a slow-ish tail
    t0 = 0.45
    for fr, g, p in [(523.25, .30, -.2), (659.25, .26, .2), (783.99, .26, -.1), (1046.5, .24, .1), (1318.5, .18, .0)]:
        m.add(bell(fr, 1.0, 0.34, 1.1), t0, g, pan=p)

    # 5) sparkles — a few very quiet high pings, spaced irregularly
    for ts, fr, p in [(0.52, 2093.0, -.6), (0.60, 2637.0, .5), (0.69, 3136.0, -.3), (0.80, 2349.0, .6)]:
        m.add(bell(fr, 0.3, 0.07, 0.6), ts, 0.07, pan=p)

    out = reverb(m, rt=0.75, wet=0.20)
    return master(out, peak_db=-1.5, fade_out=0.09)


# ------------------------------------------------------------------ GAME OVER  "Crash & fade"
def game_over():
    m = Mix(2.6)

    # 1) impact: sub drop + low-passed noise body + a tiny high crack on the very first ms
    t = tt(0.6)
    f = 34 + 110 * np.exp(-t / 0.07)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 0.001, 0.2)
    m.add(sub, 0.0, 0.85)
    body = lp(rng.standard_normal(int(0.25 * SR)), 1600) * env(0.25, 0.001, 0.06)
    m.add(body, 0.0, 0.55)
    crack = hp(rng.standard_normal(int(0.03 * SR)), 2500) * env(0.03, 0.0005, 0.008)
    m.add(crack, 0.0, 0.35)

    # 2) falling buzz: saw/square pitch dives 440 -> 52 Hz, lowpass closes 3 kHz -> 180 Hz, then bit-crushed (retro)
    d = 0.75
    t = tt(d)
    f = 440 * (52 / 440) ** (t / d)
    ph = 2 * np.pi * np.cumsum(f) / SR
    buzz = 0.6 * signal.sawtooth(ph) + 0.4 * np.sign(np.sin(ph * 0.5 + 0.3))
    buzz = tv_filter(buzz, 3000, 180, "low", 2)
    hold = 4  # sample & hold = crude bit-crush
    crushed = np.repeat(buzz[::hold], hold)[: len(buzz)]
    buzz = 0.55 * buzz + 0.45 * crushed
    buzz *= env(t, 0.004, 0.33)
    m.add(buzz, 0.03, 0.42)

    # 6) a short dusty "debris" tail under the buzz
    debris = tv_filter(rng.standard_normal(int(0.7 * SR)), 4500, 300, "low", 2) * env(0.7, 0.01, 0.2)
    m.add(debris, 0.05, 0.10)

    # 3) sad falling phrase (A minor feel):  A4  F4  D4  A3 — soft bells; the last one droops 40 cents and rings out
    phrase = [(440.00, 0.34, 0.20, 0), (349.23, 0.56, 0.22, 0), (293.66, 0.78, 0.26, 0), (220.00, 1.04, 0.62, 45)]
    for fr, ts, tau, droop in phrase:
        dur = 1.3 if droop else 0.7
        m.add(bell(fr, dur, tau, 0.7, droop_cents=droop), ts, 0.30 if not droop else 0.34, pan=0.0)
    # low octave doubling of the last note for body
    m.add(bell(110.0, 1.3, 0.55, 0.3, droop_cents=45), 1.04, 0.22)

    out = reverb(m, rt=1.25, wet=0.26, predelay=0.02)
    return master(out, peak_db=-1.5, fade_out=0.12)


# ------------------------------------------------------------------ WALK  "Slither"  (two variants)
def mono_master(x, peak_db, fade_in=0.001, fade_out=0.012):
    n_in, n_out = int(fade_in * SR), int(fade_out * SR)
    x = x.copy()
    x[:n_in] *= np.linspace(0, 1, n_in)
    x[-n_out:] *= np.linspace(1, 0, n_out)
    return x * (10 ** (peak_db / 20) / np.max(np.abs(x)))


def walk(variant):
    d = 0.075
    t = tt(d)
    lo, hi, tap_f = (1300, 3600, 190) if variant == "a" else (1700, 4300, 230)
    # soft "sss" — noise in a band that closes a little as it dies away, fast attack, ~22 ms decay
    n = rng.standard_normal(len(t))
    swish = tv_filter(hp(n, lo), hi, hi * 0.55, "low", 2) * env(t, 0.002, 0.022)
    # tiny low "tap" so it still reads on a phone speaker
    f = tap_f * (0.62 + 0.38 * np.exp(-t / 0.012))
    tap = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 0.001, 0.016)
    return mono_master(0.85 * swish + 0.55 * tap, peak_db=-12.0)


# ------------------------------------------------------------------ FOOD  "Bite & blip"
def food():
    d = 0.26
    m = np.zeros(int(d * SR))

    def put(x, start, gain=1.0):
        i = int(start * SR)
        m[i:i + len(x)] += x[: len(m) - i] * gain

    # two quick crunchy noise bursts (the bite) ...
    for ts, g in [(0.0, 1.0), (0.021, 0.7)]:
        c = tv_filter(hp(rng.standard_normal(int(0.04 * SR)), 900), 6000, 1800, "low", 2) * env(0.04, 0.0008, 0.009)
        put(c, ts, 0.62 * g)
    # ... on top of a low pop
    t = tt(0.12)
    f = 90 + 190 * np.exp(-t / 0.028)
    put(np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 0.001, 0.04), 0.0, 0.6)
    # the reward blip: G5 -> C6, sine + a little 2nd harmonic, quick decay
    for ts, fr, g in [(0.045, 783.99, 0.55), (0.100, 1046.50, 0.6)]:
        tb = tt(0.16)
        b = (np.sin(2 * np.pi * fr * tb) + 0.30 * np.sin(4 * np.pi * fr * tb) * np.exp(-tb / 0.03)) * env(tb, 0.002, 0.055)
        put(b, ts, g)
    return mono_master(np.tanh(m * 1.1), peak_db=-3.0, fade_out=0.02)


# ------------------------------------------------------------------ export
def export_wav_mono(name, x):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + ".wav")
    wavfile.write(path, SR, (x * 32767).astype(np.int16))
    print(f"{name}: {len(x) / SR * 1000:.0f} ms  peak {20 * np.log10(np.max(np.abs(x))):.1f} dBFS  -> {path}")


def export(name, x, keep_wav):
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, name + ".wav")
    mp3 = os.path.join(OUT, name + ".mp3")
    wavfile.write(wav, SR, (x.T * 32767).astype(np.int16))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "160k", mp3], check=True)
    if not keep_wav:
        os.remove(wav)
    rms = 20 * np.log10(np.sqrt(np.mean(x ** 2)))
    print(f"{name}: {x.shape[1] / SR:.2f}s  peak {20 * np.log10(np.max(np.abs(x))):.1f} dBFS  rms {rms:.1f} dBFS  -> {mp3}")


if __name__ == "__main__":
    keep = "--wav" in sys.argv
    export("game-start", game_start(), keep)
    export("game-over", game_over(), keep)
    export_wav_mono("walk-a", walk("a"))
    export_wav_mono("walk-b", walk("b"))
    export_wav_mono("food", food())
