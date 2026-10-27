"""Renderiza um corte vertical no Padrão Entur a partir de um spec JSON.

uso: python3 cortar.py spec.json transcricao.json pasta_trabalho saida.mp4 [PREVIEW=t1,t2]

Layouts por trecho (campo "layout" de cada clip):
  "dupla" -> convidado em cima, mentor embaixo, legenda na costura
  "solo"  -> animação em cima, pessoa embaixo com degradê de fumaça roxa
"""
import json, math, os, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from padrao import *  # noqa

SPEC, TRANS, WORK, OUT = sys.argv[1:5]
spec = json.load(open(SPEC))
os.makedirs(WORK, exist_ok=True)
NAME = os.path.splitext(os.path.basename(SPEC))[0]
P = spec["pessoas"]
SRC = spec["fonte"]
SOLO_H = H - SOLO_VIDEO_Y
SOLO_CW = int(round(720 * W / SOLO_H)) // 2 * 2       # largura do recorte solo na fonte 1280x720

# ---------- 1. trilhas de vídeo e voz ----------
clips = spec["clips"]
t = 0
for c in clips:
    c["t0"] = t; t += c["b"] - c["a"]; c["t1"] = t
VOICE_DUR = t

def build_streams():
    fc_solo, fc_top, fc_bot, fc_a, ins = [], [], [], [], []
    host = spec["mentor"]; guest = spec["convidado"]
    for i, c in enumerate(clips):
        d = c["b"] - c["a"]
        ins += ["-ss", f"{c['a']:.3f}", "-t", f"{d:.3f}", "-i", SRC]
        who = P[c["quem"]]
        sx = c.get("solo_x", who["solo_x"])
        fc_solo.append(f"[{i}:v]crop={SOLO_CW}:720:{sx}:0,scale={W}:{SOLO_H}:flags=lanczos,fps={FPS},setsar=1,setpts=PTS-STARTPTS[s{i}]")
        tx, ty = P[guest]["dupla_xy"]; bx, by = P[host]["dupla_xy"]
        fc_top.append(f"[{i}:v]crop=600:533:{tx}:{ty},scale={W}:{SPLIT_Y}:flags=lanczos,fps={FPS},setsar=1,setpts=PTS-STARTPTS[u{i}]")
        fc_bot.append(f"[{i}:v]crop=600:533:{bx}:{by},scale={W}:{H - SPLIT_Y}:flags=lanczos,fps={FPS},setsar=1,setpts=PTS-STARTPTS[w{i}]")
        fc_a.append(f"[{i}:a]aresample=44100,asetpts=PTS-STARTPTS,afade=t=in:d=0.04,afade=t=out:st={d - 0.06:.3f}:d=0.06[a{i}]")
    n = len(clips)
    # cada stream de vídeo precisa da própria cópia da entrada
    fc = []
    for i in range(n):
        fc.append(f"[{i}:v]split=3[v{i}a][v{i}b][v{i}c]")
    fc += [x.replace(f"[{i}:v]", f"[v{i}a]") for i, x in enumerate(fc_solo)]
    fc += [x.replace(f"[{i}:v]", f"[v{i}b]") for i, x in enumerate(fc_top)]
    fc += [x.replace(f"[{i}:v]", f"[v{i}c]") for i, x in enumerate(fc_bot)]
    fc += fc_a
    fc.append("".join(f"[s{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[S]")
    fc.append("".join(f"[u{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[U]")
    fc.append("".join(f"[w{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[B]")
    fc.append("".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[A]")
    enc = ["-c:v", "libx264", "-crf", "14", "-preset", "fast"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", ";".join(fc),
                    "-map", "[S]", *enc, f"{WORK}/{NAME}_solo.mp4",
                    "-map", "[U]", *enc, f"{WORK}/{NAME}_cima.mp4",
                    "-map", "[B]", *enc, f"{WORK}/{NAME}_baixo.mp4",
                    "-map", "[A]", "-ac", "2", f"{WORK}/{NAME}_voz.wav"], check=True)

PREV = [float(x) for x in os.environ.get("PREVIEW", "").split(",") if x]
if not os.path.exists(f"{WORK}/{NAME}_voz.wav") or os.environ.get("REBUILD"):
    build_streams()

# ---------- 2. legenda ----------
tr = json.load(open(TRANS))
WORDS = [(w[0], w[1], w[2].strip()) for s in tr for w in s["words"]]
fix = spec.get("corrigir", {})
cap = []
for c in clips:
    if "palavras" in c:          # legenda manual: [[t_fonte, palavra], ...]
        ws = [(a, x) for a, x in c["palavras"]]
    else:
        ws = [(w[0], w[2]) for w in WORDS if w[0] >= c["a"] - .05 and w[0] < c["b"] - .1]
    drop = set(c.get("remover", []))
    first = True
    for a, x in ws:
        if x in drop: continue
        x = fix.get(x, x)
        if first: x = x[:1].upper() + x[1:]; first = False
        cap.append([round(a - c["a"] + c["t0"], 3), x])
GROUPS = agrupar(cap)

# ---------- 3. render ----------
END_DUR = spec.get("final", {}).get("dur", 3.0)
TOTAL = VOICE_DUR + END_DUR
NF = int(round(TOTAL * FPS))
fundo = Fundo()
GFX = spec.get("graficos", [])

def clip_at(t):
    for c in clips:
        if c["t0"] <= t < c["t1"]: return c
    return clips[-1]

def open_dec(path, w, h):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                            stdout=subprocess.PIPE, bufsize=w * h * 3 * 2)

def grab_frame(path, t, w, h):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0, t):.3f}", "-i", path, "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    return Image.frombuffer("RGB", (w, h), raw[:w * h * 3]) if len(raw) >= w * h * 3 else None

streams = {"solo": (f"{WORK}/{NAME}_solo.mp4", W, SOLO_H), "cima": (f"{WORK}/{NAME}_cima.mp4", W, SPLIT_Y),
           "baixo": (f"{WORK}/{NAME}_baixo.mp4", W, H - SPLIT_Y)}
decs = {} if PREV else {k: open_dec(*v) for k, v in streams.items()}
last = {k: None for k in streams}

if not PREV:
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                            "-pix_fmt", "yuv420p", f"{WORK}/{NAME}_mudo.mp4"], stdin=subprocess.PIPE)

def grafico_em(t):
    for gdef in GFX:
        if gdef["t0"] <= t < gdef["t1"]: return gdef
    return None

def tela_solo(t, c, vid):
    fr = fundo.base(t, H)
    if vid is not None:
        # entrada do layout: vídeo sobe
        k = eo(prog(t - c["seg_t0"], 0, .35)) if c.get("entrou") else 1
        fr.paste(vid, (0, int(SOLO_VIDEO_Y + (1 - k) * 160)))
    # fumaça: fundo roxo por cima do topo do vídeo
    y0, y1 = SOLO_VIDEO_Y, SOLO_VIDEO_Y + 420
    mask = fundo.fumaca(t, y0, y1)
    fr.paste(fundo.base(t, H).crop((0, y0, W, y1)), (0, y0), mask)
    # animação
    gdef = grafico_em(t)
    g = G()
    if gdef:
        BLOCOS[gdef["tipo"]](g, t - gdef["t0"], gdef["t1"] - gdef["t0"], gdef.get("dados", {}))
    layer = g.done()
    if gdef and 0 <= t - gdef["t0"] < .22:
        layer.alpha_composite(Image.new("RGBA", layer.size, (196, 181, 253, int(60 * (1 - (t - gdef["t0"]) / .22)))))
    fr.alpha_composite(layer, (0, 0))
    return fr, 1480

def tela_dupla(t, c, top, bot):
    fr = Image.new("RGBA", (W, H), BG_DEEP + (255,))
    k = eo(prog(t - c["seg_t0"], 0, .35)) if c.get("entrou") else 1
    active_top = c["quem"] == spec["convidado"]
    for img, y, active, sgn in ((top, 0, active_top, -1), (bot, SPLIT_Y, not active_top, 1)):
        if img is None: continue
        im = img if active else Image.blend(img, Image.new("RGB", img.size, (16, 6, 40)), .28)
        fr.paste(im, (0, int(y + sgn * (1 - k) * 200)))
    d = ImageDraw.Draw(fr)
    d.rectangle([0, SPLIT_Y - 3, W, SPLIT_Y + 3], fill=PURPLE)
    # moldura de quem fala
    y = 0 if active_top else SPLIT_Y
    d.rectangle([0, y, W, y + 8], fill=LILAC) if active_top else d.rectangle([0, H - 14, W, H - 6], fill=LILAC)
    return fr, SPLIT_Y

def tela_final(t, base_img):
    lt = t - VOICE_DUR; fin = spec.get("final", {})
    k = eo(prog(lt, 0, .6))
    fr = Image.blend(base_img.convert("RGB"), base_img.convert("RGB").filter(ImageFilter.GaussianBlur(14)), k).convert("RGBA")
    fr.alpha_composite(Image.new("RGBA", (W, H), (16, 6, 40, int(200 * k))))
    g = G(W, H)
    for i, ln in enumerate(fin.get("linhas", [])):
        s, al = pop(lt, .15 + i * .3, .55)
        g.rich(W / 2, 760 + i * 95, ln.upper(), "Black", 72 * max(s, .3), WHITE, LILAC, al)
    q = eo(prog(lt, .9, .5))
    yb = 760 + len(fin.get("linhas", [])) * 95 + 40
    g.rect(390, yb, 690, yb + 6, rgba(PURPLE, q))
    if fin.get("cta"):
        s, al = pop(lt, 1.2, .5)
        g.pill(W / 2, yb + 110, fin["cta"].upper(), WHITE, PURPLE, 38 * max(s, .3), al, "ExtraBold")
    g.text(W / 2, yb + 210, fin.get("assinatura", "@papodeagente · ENTUR"), "SemiBold", 30, rgba(MUTED, q), "mm")
    fr.alpha_composite(g.done())
    return fr

# marca entradas de layout / pessoa
prev = None
for c in clips:
    c["entrou"] = prev is None or prev["layout"] != c["layout"]
    c["troca_pessoa"] = prev is None or prev["quem"] != c["quem"] or c["entrou"]
    prev = c
# segmentos contínuos de mesmo layout (para animação de entrada)
for i, c in enumerate(clips):
    c["seg_t0"] = c["t0"] if c["entrou"] else clips[i - 1]["seg_t0"]
# primeira aparição de cada pessoa (plaquinha)
first_seen = {}
for c in clips:
    first_seen.setdefault(c["quem"], c["t0"])

frames = [int(x * FPS) for x in PREV] if PREV else range(NF)
last_frame = None
for fi in frames:
    t = fi / FPS
    tv = min(t, VOICE_DUR - 1 / FPS)
    if PREV:
        for k_, (pth, w_, h_) in streams.items(): last[k_] = grab_frame(pth, tv, w_, h_)
    elif t < VOICE_DUR:
        for k_, (pth, w_, h_) in streams.items():
            raw = decs[k_].stdout.read(w_ * h_ * 3)
            if len(raw) == w_ * h_ * 3: last[k_] = Image.frombuffer("RGB", (w_, h_), raw)
    if t < VOICE_DUR or last_frame is None:
        c = clip_at(tv)
        if c["layout"] == "solo":
            fr, cap_y = tela_solo(t, c, last["solo"])
        else:
            fr, cap_y = tela_dupla(t, c, last["cima"], last["baixo"])
        cabecalho(fr, t, spec.get("selo", "ECLIPSE EXPERIENCE"), spec.get("direita", ""))
        if c["layout"] == "solo":
            pz = P[c["quem"]]; st = first_seen[c["quem"]] if c["t0"] == first_seen[c["quem"]] else c["t0"]
            if c["troca_pessoa"]: plaquinha(fr, t - c["t0"], pz, 1650)
        else:
            if c["entrou"]:
                plaquinha(fr, t - c["t0"], P[spec["convidado"]], SPLIT_Y - 150)
                plaquinha(fr, t - c["t0"], P[spec["mentor"]], H - 160)
        base_for_end = fr.copy()
        legenda(fr, t, GROUPS, cap_y)
        if t < VOICE_DUR: last_frame = base_for_end
    if t >= VOICE_DUR:
        fr = tela_final(t, last_frame)
    d = ImageDraw.Draw(fr)
    d.rectangle([0, H - 6, int(W * t / TOTAL), H], fill=LILAC)
    if PREV:
        fr.convert("RGB").resize((540, 960)).save(f"{WORK}/prev_{NAME}_{t:05.2f}.png"); continue
    enc.stdin.write(fr.convert("RGB").tobytes())
    if fi % 150 == 0: print(f"{NAME} {fi}/{NF}", flush=True)
if PREV: sys.exit(0)
enc.stdin.close(); enc.wait()
for dproc in decs.values(): dproc.kill()

# ---------- 4. áudio ----------
SR = 44100
def readwav(p):
    w = wave.open(p); a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    return a.reshape(-1, w.getnchannels())
voice = readwav(f"{WORK}/{NAME}_voz.wav")
N = int(TOTAL * SR)
mix = np.zeros((N, 2), np.float32); mix[:len(voice)] += voice[:N]
mus = spec.get("musica")
if mus:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(mus.get("inicio", 0)), "-t", str(TOTAL + 1), "-i", mus["arquivo"],
                    "-ar", str(SR), "-ac", "2", f"{WORK}/_m.wav"], check=True)
    m = readwav(f"{WORK}/_m.wav")[:N]
    if len(m) < N: m = np.pad(m, ((0, N - len(m)), (0, 0)))
    m = m / (np.sqrt(np.mean(m ** 2)) + 1e-9) * .18
    env = np.abs(voice.mean(1)); kk = int(.25 * SR); env = np.convolve(env, np.ones(kk) / kk, "same")
    env = np.pad(env, (0, max(0, N - len(env))))[:N]
    gain = .30 - .22 * np.clip(env / .02, 0, 1)
    tt = np.arange(N) / SR
    gain *= np.clip(tt / .4, 0, 1)
    e = np.clip((tt - VOICE_DUR) / .5, 0, 1); gain = gain * (1 - e) + .9 * e
    fo = int(1.5 * SR); gain[-fo:] *= np.linspace(1, 0, fo)
    mix += m * gain[:, None]
rng = np.random.default_rng(3)
L = int(.4 * SR); tt = np.arange(L) / SR
wh = np.convolve(rng.normal(0, 1, L), np.ones(30) / 30, "same") * np.sin(np.pi * tt / tt[-1]) ** 2 * .3
marks = sorted(set([g_["t0"] for g_ in GFX if g_["t0"] > .5] + [c["t0"] for c in clips if c["entrou"] and c["t0"] > .5]))
for c_ in marks:
    i = int((c_ - .15) * SR)
    if 0 <= i < N - L: mix[i:i + L] += wh[:, None]
L2 = int(1.6 * SR); t2 = np.arange(L2) / SR
boom = np.sin(2 * np.pi * np.cumsum(30 + 70 * np.exp(-t2 * 6)) / SR) * np.exp(-t2 * 2.2) * .8
boom += np.convolve(rng.normal(0, 1, L2), np.ones(8) / 8, "same") * np.exp(-t2 * 9) * .25
for c_, gn in ((0.0, .6), (VOICE_DUR, 1.0)):
    i = int(c_ * SR); j = min(N, i + L2); mix[i:j] += boom[:j - i, None] * gn
pk = np.abs(mix).max()
if pk > .98: mix *= .98 / pk
w = wave.open(f"{WORK}/{NAME}_mix.wav", "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((mix * 32767).astype(np.int16).tobytes()); w.close()
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{WORK}/{NAME}_mudo.mp4", "-i", f"{WORK}/{NAME}_mix.wav",
                "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
                "-shortest", "-movflags", "+faststart", OUT], check=True)
print("ok", OUT)
