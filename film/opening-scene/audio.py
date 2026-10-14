#!/usr/bin/env python3
"""
تصميم صوت مشهد الافتتاح «من الظل إلى النور» (10 ثوانٍ) — numpy فقط.

  python3 audio.py ../build/timeline.json ../build/audio.wav

الخط الزمني (خطوات البطل والطلاب، نقاط القطع) يأتي من render.cjs حتى يتزامن
الصوت مع الصورة إطارًا بإطار.
  • 0.0–4.4  ممر الجامعة: صدى قاعة واسعة، همهمة طلاب، خطوات، بيانو حزين خفيف
  • 4.4      مرور العمود أمام العدسة (whoosh) ثم قلب صفحة الدفتر
  • 5.4–6.7  صوت قلم الرصاص، اللحن يصعد نحو الأمل، المصباح يتوهّج
  • 7.4      ضربة منخفضة ناعمة + كورد مضيء مع ظهور العنوان
  • 9.62     «بيب» قارئ الباركود — J-cut نحو مشهد الكاشير
التعليق الصوتي للبطل يُسجَّل لاحقًا باللهجة السعودية ويُركّب فوق هذا المزج.
"""
import json
import sys
import wave

import numpy as np

SR = 48000
DUR = 10.0
N = int(SR * DUR)
rng = np.random.default_rng(7)


# ------------------------------------------------------------------ helpers
def tt(n):
    return np.arange(n) / SR


def spectral(x, lo=None, hi=None, order=2):
    """مرشح تمرير منخفض/مرتفع بطور صفري في مجال التردد."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    H = np.ones_like(f)
    if hi:
        H /= np.sqrt(1 + (f / hi) ** (2 * order))
    if lo:
        H /= np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * H, n=len(x))


def noise(n):
    return rng.standard_normal(n)


class Bus:
    def __init__(self):
        self.x = np.zeros((2, N))

    def add(self, sig, t0, gain=1.0, pan=0.0):
        i0 = int(round(t0 * SR))
        if i0 >= N:
            return
        s = sig if sig.ndim == 2 else np.vstack([sig, sig])
        if i0 < 0:
            s = s[:, -i0:]
            i0 = 0
        s = s[:, : N - i0]
        a = (pan + 1) * np.pi / 4
        self.x[0, i0:i0 + s.shape[1]] += s[0] * gain * np.cos(a) * np.sqrt(2)
        self.x[1, i0:i0 + s.shape[1]] += s[1] * gain * np.sin(a) * np.sqrt(2)


def env_adsr(n, a, r, hold=None):
    e = np.ones(n)
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na) ** 2
    e[-nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e


def reverb_ir(seconds, rt60, damp_hz, seed, predelay=0.012):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = tt(n)
    decay = np.exp(-6.91 * t / rt60)
    ir = np.zeros((2, n))
    for ch in range(2):
        x = r.standard_normal(n) * decay
        lo = spectral(x, hi=damp_hz, order=1)
        mix = np.exp(-t / (rt60 * 0.35))
        ir[ch] = lo * (1 - mix * 0.5) + x * mix * 0.5
    pd = int(predelay * SR)
    ir = np.concatenate([np.zeros((2, pd)), ir], axis=1)
    for d, g in [(0.019, 0.5), (0.031, 0.35), (0.047, 0.28), (0.061, 0.2)]:
        k = int(d * SR)
        ir[0, k] += g * r.uniform(0.6, 1)
        ir[1, k + int(0.003 * SR)] += g * r.uniform(0.6, 1)
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


def convolve(x, ir):
    n = x.shape[1] + ir.shape[1]
    out = np.zeros((2, N))
    for ch in range(2):
        y = np.fft.irfft(np.fft.rfft(x[ch], n) * np.fft.rfft(ir[ch], n), n)
        out[ch] = y[:N]
    return out


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ------------------------------------------------------------------ instruments
def piano(m, vel=0.6, length=4.0):
    f0 = midi(m)
    n = int(length * SR)
    t = tt(n)
    y = np.zeros(n)
    bright = 0.6 + vel
    for det in (-0.7, 0.7):
        f = f0 * 2 ** (det / 1200)
        for k in range(1, 15):
            fk = k * f * np.sqrt(1 + 0.00032 * k * k)
            if fk > 16000:
                break
            amp = (1 / k ** 1.15) * np.exp(-(k - 1) / (3.2 * bright))
            tau = (2.6 if f0 < 300 else 1.9) / (1 + 0.38 * k)
            y += amp * np.exp(-t / tau) * np.sin(2 * np.pi * fk * t + k * 0.7)
    y *= np.minimum(1, t / 0.004)
    h = spectral(noise(int(0.02 * SR)) * np.exp(-tt(int(0.02 * SR)) / 0.004), hi=2500)
    y[: len(h)] += h * 0.05 * vel
    rel = int(0.25 * SR)
    y[-rel:] *= np.linspace(1, 0, rel)
    return y * vel * 0.16


def pad(notes, t0, t1, att=1.4, rel=1.0, gain=1.0, dark=1600):
    n = int((t1 - t0) * SR)
    t = tt(n)
    out = np.zeros((2, n))
    for i, m in enumerate(notes):
        f0 = midi(m)
        for j, det in enumerate((-5, 0, 5)):
            f = f0 * 2 ** (det / 1200)
            ph = rng.uniform(0, 2 * np.pi)
            v = np.zeros(n)
            for k in range(1, 11):
                if k * f > 9000:
                    break
                v += (1 / k) * np.exp(-k * f / dark) * np.sin(2 * np.pi * k * f * t + ph * k)
            trem = 1 + 0.08 * np.sin(2 * np.pi * (0.17 + 0.05 * i) * t + j)
            pan = ((i % 3) - 1) * 0.35 + (j - 1) * 0.25
            a = (pan + 1) * np.pi / 4
            out[0] += v * trem * np.cos(a)
            out[1] += v * trem * np.sin(a)
    e = env_adsr(n, att, rel)
    return out * e * gain * 0.022


def sub_boom(length=2.2):
    n = int(length * SR)
    t = tt(n)
    f = 38 + 34 * np.exp(-t / 0.35)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / 0.7) * np.minimum(1, t / 0.006)
    y += spectral(noise(n), hi=180) * np.exp(-t / 0.12) * 0.6
    return y * 0.55


def riser(length):
    n = int(length * SR)
    t = tt(n)
    e = (t / length) ** 3
    x = spectral(noise(n), lo=1800, hi=9000)
    f = 260 + 520 * (t / length) ** 2
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    return (x * 0.35 + s) * e * 0.5


def whoosh(length, center):
    n = int(length * SR)
    t = tt(n)
    x = noise(n)
    low, mid, high = spectral(x, hi=420), spectral(x, lo=420, hi=1900), spectral(x, lo=1900, hi=7000)
    g = np.exp(-((t - center) ** 2) / (2 * 0.16 ** 2))
    gm = np.exp(-((t - center) ** 2) / (2 * 0.07 ** 2))
    y = low * g * 1.1 + mid * (0.35 * g + 0.8 * gm) + high * 0.35 * gm
    pan = np.clip((t - center) / 0.35, -1, 1)
    a = (pan + 1) * np.pi / 4
    return np.vstack([y * np.cos(a), y * np.sin(a)]) * 0.42


def paper_flip(length):
    n = int(length * SR)
    t = tt(n)
    crk = np.abs(spectral(noise(n), hi=45)) ** 1.6
    crk /= crk.max()
    shape = np.sin(np.pi * np.clip(t / (length * 0.86), 0, 1)) ** 1.5
    y = spectral(noise(n), lo=700, hi=8000) * (0.25 + crk) * shape
    k = int((length - 0.07) * SR)
    land = spectral(noise(n - k), hi=420) * np.exp(-tt(n - k) / 0.03)
    y[k:] += land * 1.6
    return y * 0.16


def pencil_sfx(length):
    n = int(length * SR)
    t = tt(n)
    am = 0.55 + 0.45 * np.sin(2 * np.pi * (13 + 4 * np.sin(2 * np.pi * 1.3 * t)) * t)
    y = spectral(noise(n), lo=2200, hi=9500) * am
    y *= np.minimum(1, t / 0.02) * np.minimum(1, (length - t) / 0.03)
    return y * 0.045


def footstep(bright=1.0):
    n = int(0.12 * SR)
    t = tt(n)
    slap = spectral(noise(n), lo=280, hi=3800 * bright) * np.exp(-t / 0.016)
    thump = np.sin(2 * np.pi * 105 * t) * np.exp(-t / 0.028) * 0.6
    scuff_n = int(0.05 * SR)
    y = slap + thump
    y[int(0.035 * SR):int(0.035 * SR) + scuff_n] += spectral(noise(scuff_n), lo=1500, hi=6000) * np.exp(-tt(scuff_n) / 0.02) * 0.25
    return y * np.minimum(1, t / 0.0015)


def murmur(length, seed):
    r = np.random.default_rng(seed)
    n = int(length * SR)
    t = tt(n)
    y = np.zeros(n)
    for v in range(7):
        rate = r.uniform(3.2, 5.5)
        syl = np.clip(np.sin(2 * np.pi * rate * t + r.uniform(0, 6)) + 0.4 * np.sin(2 * np.pi * rate * 0.37 * t + r.uniform(0, 6)), 0, None) ** 1.5
        phrase = np.clip(np.sin(2 * np.pi * r.uniform(0.15, 0.35) * t + r.uniform(0, 6)) + 0.3, 0, 1)
        f0 = r.uniform(300, 600)
        y += spectral(r.standard_normal(n), lo=f0, hi=f0 * 3.2) * syl * phrase
    return y / 7


def bird(f0=3600):
    n = int(0.16 * SR)
    t = tt(n)
    f = f0 + 900 * np.sin(2 * np.pi * 18 * t) * np.exp(-t / 0.06) + 1200 * t / 0.16
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / 0.16) ** 2


def barcode_beep():
    n = int(0.16 * SR)
    t = tt(n)
    y = np.sin(2 * np.pi * 2950 * t) + 0.18 * np.sin(2 * np.pi * 5900 * t) + 0.06 * np.sign(np.sin(2 * np.pi * 2950 * t))
    e = np.minimum(1, t / 0.002) * np.clip((0.12 - t) / 0.006, 0, 1)
    return y * e * 0.2


def store_tone(length):
    n = int(length * SR)
    t = tt(n)
    hum = 0.5 * np.sin(2 * np.pi * 120 * t) + 0.25 * np.sin(2 * np.pi * 240 * t) + 0.08 * np.sin(2 * np.pi * 360 * t)
    air = spectral(noise(n), lo=180, hi=2400) * 0.5
    return (hum * 0.25 + air) * 0.05


# ------------------------------------------------------------------ build
def main(tl_path, out_path):
    tl = json.load(open(tl_path))
    T1, T2 = tl["cuts"]
    BEEP = tl["barcode"]

    music, sfx, amb = Bus(), Bus(), Bus()
    hall_send, room_send = Bus(), Bus()

    # ---- الموسيقى
    music.add(pad([45, 52, 57, 59, 60, 64], 0, T1 + 0.6, att=1.6, rel=0.7), 0)
    b = pad([41, 48, 53, 57, 64, 67], 0, T2 - T1 + 0.5, att=0.5, rel=0.6, gain=0.95)
    music.add(b, T1 - 0.1)
    c = pad([36, 43, 48, 55, 62, 64, 67, 72], 0, DUR - T2 + 0.05, att=0.35, rel=0.9, gain=0.85, dark=2600)
    music.add(c, T2)
    for t0, m, v, p in [(0.30, 45, 0.5, -0.2), (0.32, 52, 0.35, -0.1), (0.90, 76, 0.42, 0.2), (1.85, 72, 0.4, 0.1),
                        (2.80, 71, 0.38, 0.15), (3.70, 69, 0.4, 0.0),
                        (T1 + 0.05, 41, 0.5, -0.2), (T1 + 0.07, 48, 0.36, -0.1), (4.90, 69, 0.4, 0.1), (5.55, 72, 0.43, 0.15),
                        (6.20, 76, 0.48, 0.2), (6.80, 79, 0.45, 0.25),
                        (T2, 36, 0.62, -0.15), (T2 + 0.01, 43, 0.5, -0.1), (T2 + 0.02, 48, 0.45, 0.0),
                        (T2 + 0.06, 76, 0.42, 0.1), (T2 + 0.11, 79, 0.42, 0.2), (T2 + 0.16, 84, 0.4, 0.3),
                        (8.35, 79, 0.3, 0.3), (8.75, 84, 0.3, -0.2), (9.10, 86, 0.22, 0.2)]:
        music.add(piano(m, v, 4.5 if m < 60 else 3.6), t0, 1.0, p)
    # بريق خافت مع ظهور العنوان
    n = int((DUR - 7.8) * SR)
    t = tt(n)
    sh = sum(np.sin(2 * np.pi * f * t + i) * (0.5 + 0.5 * np.sin(2 * np.pi * (5 + i) * t)) for i, f in enumerate([2093, 2637, 3136, 4186]))
    music.add(sh * env_adsr(n, 0.9, 1.0) * 0.006, 7.8)

    # ---- مؤثرات التحول
    sfx.add(riser(T2 - 6.55), 6.55, 0.5)
    sfx.add(sub_boom(), T2, 0.7)
    sfx.add(whoosh(1.2, 0.62), T1 - 0.6, 1.0)
    pf0, pf1 = tl["pageFlip"]
    sfx.add(paper_flip(pf1 - pf0 + 0.08), pf0 - 0.02, 1.0, 0.1)
    for a, d in [(5.42, 0.24), (5.66, 0.12), (5.78, 0.24), (6.02, 0.12), (6.0, 0.4), (6.40, 0.12)] + [(6.12 + i * 0.07, 0.14) for i in range(7)]:
        sfx.add(pencil_sfx(d), a, 1.0, -0.15)
    n = int((DUR - T2) * SR)
    t = tt(n)
    up = spectral(noise(n), lo=3000, hi=11000) * np.exp(-((t - 0.75) ** 2) / (2 * 0.25 ** 2))
    sfx.add(up * 0.05, T2)

    # ---- الأجواء: الممر
    nA = int((T1 + 0.05) * SR)
    room = spectral(noise(nA), hi=900) * 0.02
    mur = murmur(T1 + 0.05, 3) * 0.06
    eA = env_adsr(nA, 0.6, 0.06)
    amb.add(np.vstack([room * eA, spectral(noise(nA), hi=900) * 0.02 * eA]), 0)
    hall_send.add(mur * eA, 0, 1.0, -0.3)
    hall_send.add(murmur(T1 + 0.05, 9) * 0.05 * eA, 0, 1.0, 0.4)
    for t0, f0, p in [(1.25, 3700, 0.6), (1.43, 4100, 0.6), (2.95, 3300, -0.5)]:
        amb.add(spectral(bird(f0), lo=1500) * 0.012, t0, 1.0, p)
    for st in tl["steps"]:
        g = 0.32 if st["hero"] else 0.30 * (4.0 / st["z"]) ** 1.3
        s = footstep(1.0 if st["hero"] else 0.7) * g
        sfx.add(s, st["t"], 0.9, st["pan"] * 0.7)
        hall_send.add(s, st["t"], 1.4, st["pan"] * 0.7)
    # ---- الأجواء: الدفتر (هادئ)
    nB = int((T2 - T1) * SR)
    eB = env_adsr(nB, 0.05, 0.4)
    amb.add(np.vstack([spectral(noise(nB), hi=700) * 0.012 * eB, spectral(noise(nB), hi=700) * 0.012 * eB]), T1)
    room_send.add(murmur(T2 - T1, 21) * 0.012 * eB, T1, 1.0, 0.3)
    amb.add(spectral(bird(3900), lo=1500) * 0.006, 5.9, 1.0, -0.6)

    # ---- J-cut: صوت المحل وقارئ الباركود
    amb.add(store_tone(DUR - (BEEP - 0.22)) * env_adsr(int((DUR - (BEEP - 0.22)) * SR), 0.2, 0.05), BEEP - 0.22, 1.0)
    beep = barcode_beep()
    sfx.add(beep, BEEP, 1.0, 0.05)
    room_send.add(beep, BEEP, 0.5, 0.05)

    # ---- خفض الموسيقى للبيب ونهاية المشهد
    duck = np.ones(N)
    tN = tt(N)
    duck *= 1 - 0.55 * np.clip((tN - (BEEP - 0.25)) / 0.25, 0, 1)
    duck *= np.clip((DUR - tN) / 0.38, 0, 1) ** 0.8

    hall = convolve(hall_send.x, reverb_ir(3.2, 2.6, 3500, 1))
    room = convolve(room_send.x, reverb_ir(1.2, 0.6, 5000, 2))
    mus_verb = convolve(music.x, reverb_ir(4.0, 3.2, 6000, 3))

    mix = (music.x * 0.85 + mus_verb * 0.32) * duck + sfx.x + amb.x + hall * 0.35 + room * 0.3
    mix[:, : int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    mix[:, -int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    peak = np.max(np.abs(mix))
    mix = np.tanh(mix / peak * 1.15) / np.tanh(1.15) * 0.89

    pcm = (np.clip(mix.T, -1, 1) * 32767).astype("<i2")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("wrote", out_path, f"peak {peak:.3f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
