"""Builds the web game's extra sound effects from the CC0 recordings in
tools/audio-sources (all converted to 16-bit 44.1 kHz WAV with macOS
afconvert). Standard library only. Run: python3 tools/make_web_audio.py

The files copied unchanged from the Python version (impact-clean.wav,
impact-blocked.wav, punch-whoosh.wav, lucky-punch.wav, champion-*.wav,
crowd-*.wav, victory-fanfare.ogg) are not rebuilt here.
"""
import os
import struct
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, 'audio-sources')
OUT = os.path.join(HERE, '..', 'assets', 'audio')
RATE = 44100


def load(name):
    w = wave.open(os.path.join(SOURCES, name))
    channels, frames = w.getnchannels(), w.getnframes()
    data = struct.unpack('<%dh' % (frames * channels), w.readframes(frames))
    return [sum(data[i * channels:(i + 1) * channels]) / channels / 32768
            for i in range(frames)]


def cut(s, start, end):
    return s[int(start * RATE):int(end * RATE)]


def fade(s, fade_in, fade_out):
    s = list(s)
    n_in, n_out = max(1, int(fade_in * RATE)), max(1, int(fade_out * RATE))
    for i in range(min(n_in, len(s))):
        s[i] *= i / n_in
    for i in range(min(n_out, len(s))):
        s[-1 - i] *= i / n_out
    return s


def low_pass(s, amount):
    out, v = [], 0.0
    for x in s:
        v += amount * (x - v)
        out.append(v)
    return out


def resample(s, speed):
    # speed < 1 = slower and lower pitched.
    out, pos = [], 0.0
    while pos < len(s) - 1:
        i = int(pos)
        f = pos - i
        out.append(s[i] * (1 - f) + s[i + 1] * f)
        pos += speed
    return out


def mix(*layers):
    length = max(len(s) + int(d * RATE) for s, g, d in layers)
    out = [0.0] * length
    for s, g, d in layers:
        o = int(d * RATE)
        for i, x in enumerate(s):
            out[i + o] += x * g
    return out


def normalize(s, peak):
    loud = max(abs(x) for x in s) or 1
    return [x * peak / loud for x in s]


def save(name, s):
    w = wave.open(os.path.join(OUT, name), 'wb')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(struct.pack('<%dh' % len(s), *[max(-32767, min(32767, int(x * 32767))) for x in s]))
    w.close()
    print('wrote', name, round(len(s) / RATE, 2), 's')


punch6 = load('bigsoundbank-2461.wav')    # Punch #6
punch10 = load('bigsoundbank-2465.wav')   # Punch #10 (light)
punch12 = load('bigsoundbank-2467.wav')   # Punch #12
punch8 = load('bigsoundbank-2463.wav')    # Punch #8 (dark)
punch13 = load('bigsoundbank-2468.wav')   # Punch #13 (low end)
whoosh = load('bigsoundbank-1795.wav')    # Whoosh #3
bell3 = load('bigsoundbank-1928.wav')     # Boxing bell #3 (three quick dings)

save('hit-light.wav', normalize(fade(cut(punch10, .095, .45), .002, .2), .85))
save('hit-clean-b.wav', normalize(fade(cut(punch6, .055, .45), .002, .2), .92))
save('hit-heavy.wav', normalize(fade(mix(
    (cut(punch6, .055, .6), 1.0, 0),
    (low_pass(resample(cut(punch13, .08, .7), .8), .2), 1.3, .006)), .002, .3), .98))
save('hit-body.wav', normalize(fade(mix(
    (low_pass(cut(punch12, .07, .5), .35), 1.0, 0),
    (low_pass(cut(punch8, .05, .5), .15), .9, .004)), .002, .2), .9))
save('whoosh-heavy.wav', normalize(fade(resample(cut(whoosh, .14, .72), .78), .05, .25), .8))
save('ko-thud.wav', normalize(fade(mix(
    (low_pass(resample(cut(punch13, .08, .8), .55), .12), 1.0, 0),
    (low_pass(resample(cut(punch8, .05, .6), .6), .1), .8, .03)), .003, .5), .98))
save('bell-ring.wav', normalize(fade(bell3, .001, .25), .9))
