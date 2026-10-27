"""Padrão Entur de Cortes — identidade visual e peças gráficas reutilizáveis.

Tudo que define o "jeito Entur" de um corte vive aqui: paleta roxa, fontes,
legenda, plaquinha de nome, fumaça do layout solo e os blocos animados
(número, barras, linha, lista, citação, etapas, selo, manchete).
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, "..", "fonts")

# ---------------- formato ----------------
W, H, FPS = 1080, 1920, 30
SPLIT_Y = 960                 # costura do layout dupla
SOLO_VIDEO_Y = 560            # onde o vídeo começa no layout solo
SOLO_GFX_H = 820              # altura da área de animação no layout solo
SS = 2                        # supersampling das animações

# ---------------- paleta roxa Entur ----------------
# Ajuste aqui se a marca tiver hex oficial diferente.
BG_DEEP = (16, 6, 40)         # fundo quase preto arroxeado
BG_MID = (38, 14, 92)         # roxo profundo
PURPLE = (124, 58, 237)       # roxo principal  #7C3AED
LILAC = (167, 139, 250)       # lilás           #A78BFA
INDIGO = (91, 108, 240)       # acento Entur    #5B6CF0
PINK = (236, 72, 153)         # contraste quente (alertas)
WHITE = (255, 255, 255)
MUTED = (196, 181, 253)       # texto secundário lilás claro
DIM = (88, 70, 140)

# ---------------- fontes ----------------
_fc = {}
def font(weight, size):
    k = (weight, int(size))
    if k not in _fc:
        _fc[k] = ImageFont.truetype(os.path.join(FONT_DIR, f"Poppins-{weight}.ttf"), max(1, int(size)))
    return _fc[k]

# ---------------- easing ----------------
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def eo(x): x = clamp(x); return 1 - (1 - x) ** 3
def eio(x): x = clamp(x); return 4 * x ** 3 if x < .5 else 1 - (-2 * x + 2) ** 3 / 2
def eback(x):
    x = clamp(x); c1 = 1.70158; c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
def prog(t, a, d): return clamp((t - a) / d) if d > 0 else float(t >= a)
def lerp(a, b, x): return a + (b - a) * x
def rgba(c, a): return (c[0], c[1], c[2], int(255 * clamp(a)))

# ---------------- camada de desenho (supersampled) ----------------
class G:
    def __init__(self, w=W, h=SOLO_GFX_H):
        self.w, self.h = w, h
        self.im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im, "RGBA")
    def s(self, v): return int(round(v * SS))
    def rect(self, x0, y0, x1, y1, fill, r=0, outline=None, width=0):
        if x1 - x0 < 1 or y1 - y0 < 1: return
        r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
        self.d.rounded_rectangle([self.s(x0), self.s(y0), self.s(x1), self.s(y1)], radius=self.s(r),
                                 fill=fill, outline=outline, width=self.s(width))
    def circle(self, cx, cy, r, fill, outline=None, width=0):
        if r <= 0: return
        self.d.ellipse([self.s(cx - r), self.s(cy - r), self.s(cx + r), self.s(cy + r)], fill=fill,
                       outline=outline, width=self.s(width))
    def line(self, pts, fill, width):
        self.d.line([(self.s(x), self.s(y)) for x, y in pts], fill=fill, width=self.s(width), joint="curve")
        for x, y in (pts[0], pts[-1]): self.circle(x, y, width / 2, fill)
    def poly(self, pts, fill):
        self.d.polygon([(self.s(x), self.s(y)) for x, y in pts], fill=fill)
    def tw(self, txt, weight, size):
        return self.d.textlength(txt, font=font(weight, self.s(size))) / SS
    def text(self, x, y, txt, weight, size, fill, anchor="la"):
        a = fill[3] if len(fill) == 4 else 255
        if a < 3 or not txt: return
        f = font(weight, self.s(size))
        if a >= 252:
            self.d.text((self.s(x), self.s(y)), txt, font=f, fill=fill, anchor=anchor); return
        l, t_, r, b = self.d.textbbox((self.s(x), self.s(y)), txt, font=f, anchor=anchor)
        l, t_ = int(l) - 2, int(t_) - 2
        tmp = Image.new("RGBA", (int(r) - l + 4, int(b) - t_ + 4), (0, 0, 0, 0))
        ImageDraw.Draw(tmp).text((self.s(x) - l, self.s(y) - t_), txt, font=f, fill=fill[:3] + (255,), anchor=anchor)
        tmp.putalpha(tmp.getchannel("A").point(lambda v: v * a // 255))
        self.im.alpha_composite(tmp, (max(l, 0), max(t_, 0)), (max(-l, 0), max(-t_, 0)))
    def rich(self, cx, y, txt, weight, size, base, hi, alpha=1.0):
        """texto centralizado; trechos entre *asteriscos* saem na cor de destaque"""
        parts = []; on = False
        for chunk in txt.split("*"):
            if chunk: parts.append((chunk, on))
            on = not on
        total = sum(self.tw(c, weight, size) for c, _ in parts)
        x = cx - total / 2
        for c, h in parts:
            self.text(x, y, c, weight, size, rgba(hi if h else base, alpha), "lm")
            x += self.tw(c, weight, size)
    def arrow_up(self, cx, cy, s, fill):
        self.poly([(cx, cy - s), (cx + s * .8, cy), (cx + s * .3, cy), (cx + s * .3, cy + s),
                   (cx - s * .3, cy + s), (cx - s * .3, cy), (cx - s * .8, cy)], fill)
    def arrow_right(self, cx, cy, s, fill):
        self.poly([(cx + s, cy), (cx, cy - s * .8), (cx, cy - s * .3), (cx - s, cy - s * .3),
                   (cx - s, cy + s * .3), (cx, cy + s * .3), (cx, cy + s * .8)], fill)
    def check(self, cx, cy, r, fill, mark):
        self.circle(cx, cy, r, fill)
        self.line([(cx - r * .45, cy + r * .02), (cx - r * .1, cy + r * .35), (cx + r * .5, cy - r * .35)], mark, r * .22)
    def star(self, cx, cy, r, fill):
        pts = []
        for i in range(10):
            a = -math.pi / 2 + i * math.pi / 5; rr = r if i % 2 == 0 else r * .45
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        self.poly(pts, fill)
    def pill(self, x, y, txt, fg, bg, size=30, alpha=1.0, weight="Bold"):
        tw = self.tw(txt, weight, size); pw = tw + size * 1.4; ph = size * 1.9
        self.rect(x - pw / 2, y - ph / 2, x + pw / 2, y + ph / 2, rgba(bg, alpha), r=ph / 2)
        self.text(x, y + size * .05, txt, weight, size, rgba(fg, alpha), "mm")
    def done(self):
        return self.im.resize((self.w, self.h), Image.LANCZOS)

def pop(t, a, d=.45):
    p = prog(t, a, d); return eback(p), eo(p * 1.6)

# ================= BLOCOS ANIMADOS =================
# Cada bloco: fn(g, t, dur, data). Coordenadas na área 1080 x SOLO_GFX_H.
# Topo ~120 = título; conteúdo entre 200 e 640; o rodapé (>640) fica sob a fumaça.

def _title(g, t, d):
    if d.get("titulo"):
        p = eo(prog(t, 0, .45))
        g.rich(W / 2, 135 + (1 - p) * 25, d["titulo"].upper(), "ExtraBold", 54, WHITE, LILAC, p)
    if d.get("sub"):
        p = eo(prog(t, .2, .45))
        g.text(W / 2, 195 + (1 - p) * 15, d["sub"], "Medium", 30, rgba(MUTED, p), "mm")

def b_manchete(g, t, dur, d):
    """Gancho/manchete: linhas grandes com *destaque*. data: linhas[], tag"""
    if d.get("tag"):
        s, al = pop(t, 0, .4); g.pill(W / 2, 170, d["tag"].upper(), WHITE, PINK, 28, al)
    lines = d["linhas"]; n = len(lines)
    size = d.get("size", 74 if n <= 3 else 62)
    y0 = 380 - (n - 1) * size * .62
    for i, ln in enumerate(lines):
        p = eo(prog(t, .15 + i * .22, .45))
        g.rich(W / 2, y0 + i * size * 1.25 + (1 - p) * 30, ln.upper(), "Black", size, WHITE, LILAC, p)

def b_numero(g, t, dur, d):
    """KPI gigante com contador. data: valor, prefixo, sufixo, rotulo, decimais, titulo"""
    _title(g, t, d)
    v = d["valor"]; p = eio(prog(t, .3, d.get("conta", 1.6)))
    dec = d.get("decimais", 0)
    num = f"{v * p:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    txt = f"{d.get('prefixo', '')}{num}{d.get('sufixo', '')}"
    s, al = pop(t, .2, .5)
    size = d.get("size", 150)
    # brilho atrás do número
    alerta = d.get("alerta")
    g.circle(W / 2, 400, 230 * eo(prog(t, .2, .8)), rgba(PINK if alerta else PURPLE, .35 * al))
    g.text(W / 2, 400, txt, "Black", size * max(s, .3), rgba(PINK if alerta else WHITE, al), "mm")
    if d.get("rotulo"):
        q = eo(prog(t, .9, .45))
        g.pill(W / 2, 560 + (1 - q) * 20, d["rotulo"].upper(), WHITE, PINK if alerta else PURPLE, 32, q)

def b_barras(g, t, dur, d):
    """Comparativo em barras. data: titulo, sub, itens[{rotulo, valor(0-1), destaque, tag}], nota"""
    _title(g, t, d)
    it = d["itens"]; n = len(it)
    x0, x1, base, hmax = 120, 960, 640, 360
    step = (x1 - x0) / n; bw = min(220, step * .7)
    for i, b in enumerate(it):
        a = .35 + i * .3
        p = eo(prog(t, a, 1.0)); cx = x0 + step * (i + .5)
        col = PURPLE if b.get("destaque") else DIM
        g.rect(cx - bw / 2, base - hmax, cx + bw / 2, base, rgba(BG_MID, .55), r=20)
        h = hmax * b["valor"] * p
        if h > 2:
            g.rect(cx - bw / 2, base - h, cx + bw / 2, base, rgba(col, 1), r=20)
            if b.get("destaque"):
                g.rect(cx - bw / 2, base - h, cx + bw / 2, base - h + 10, rgba(LILAC, 1), r=5)
        g.text(cx, base + 34, b["rotulo"], "SemiBold", 28, rgba(WHITE, eo(prog(t, a, .4))), "mm")
        if b.get("tag") and p > .9:
            q = eo(prog(t, a + 1.0, .35))
            g.text(cx, base - h - 34, b["tag"], "Black", 40, rgba(LILAC if b.get("destaque") else MUTED, q), "mm")
    if d.get("nota"):
        g.text(W - 50, 700, d["nota"], "Medium", 20, rgba(MUTED, .7 * eo(prog(t, 1, .5))), "rm")

def b_linha(g, t, dur, d):
    """Curva de crescimento. data: titulo, sub, pontos[0-1], eixo[], selo, selo_t, nota"""
    _title(g, t, d)
    ys = d["pontos"]; n = len(ys)
    x0, x1, y0, y1 = 130, 950, 640, 290
    for k in range(4):
        yy = lerp(y0, y1, k / 3); g.line([(x0, yy), (x1, yy)], rgba(WHITE, .07), 2)
    p = eio(prog(t, .4, d.get("dur", 2.6)))
    pts = [(lerp(x0, x1, i / (n - 1)), lerp(y0, y1, v)) for i, v in enumerate(ys)]
    tot = (n - 1) * p; k = int(tot); f = tot - k
    vis = pts[:k + 1]
    if k < n - 1: vis = vis + [(lerp(pts[k][0], pts[k + 1][0], f), lerp(pts[k][1], pts[k + 1][1], f))]
    if p > 0 and len(vis) > 1:
        g.poly(vis + [(vis[-1][0], y0), (vis[0][0], y0)], rgba(PURPLE, .25))
        g.line(vis, rgba(LILAC, 1), 9)
        hx, hy = vis[-1]; g.circle(hx, hy, 22, rgba(LILAC, .35)); g.circle(hx, hy, 12, rgba(WHITE, 1))
    for i, lab in enumerate(d.get("eixo", [])):
        if lab:
            xi = lerp(x0, x1, i / max(1, len(d["eixo"]) - 1))
            g.text(xi, y0 + 34, lab, "SemiBold", 24, rgba(MUTED, eo(prog(t, .4, .4))), "mm")
    if d.get("selo"):
        s, al = pop(t, d.get("selo_t", 3.0), .45)
        if al > 0: g.pill(W / 2, 290, d["selo"].upper(), WHITE, PINK, 30, al)
    if d.get("nota"):
        g.text(W - 50, 700, d["nota"], "Medium", 20, rgba(MUTED, .7 * eo(prog(t, 1, .5))), "rm")

def b_lista(g, t, dur, d):
    """Lista com checks. data: titulo, itens[{texto, t}]"""
    _title(g, t, d)
    for i, it in enumerate(d["itens"]):
        a = it.get("t", .5 + i * .6)
        p = eback(prog(t, a, .5)); al = eo(prog(t, a, .3))
        if al <= 0: continue
        y = 270 + i * 110; x = 110 - (1 - p) * 200
        g.rect(x, y, x + 860, y + 88, rgba(BG_MID, .9 * al), r=44, outline=rgba(PURPLE, al), width=3)
        g.check(x + 50, y + 44, 26, rgba(PURPLE, al), rgba(WHITE, al))
        g.text(x + 95, y + 46, it["texto"], "Bold", 34, rgba(WHITE, al), "lm")

def b_citacao(g, t, dur, d):
    """Frase em destaque. data: linhas[{texto, t}], autor, estrelas"""
    s, al = pop(t, 0, .5)
    g.rect(90, 150, 990, 610, rgba(BG_MID, .85 * al), r=40, outline=rgba(PURPLE, al), width=3)
    g.text(150, 200, "“", "Black", 150, rgba(LILAC, al), "lm")
    for i, ln in enumerate(d["linhas"]):
        q = eo(prog(t, ln.get("t", .3 + i * .5), .4))
        y = 300 + i * 74 + (1 - q) * 15
        g.rich(W / 2, y, ln["texto"], "ExtraBold", 52, WHITE, LILAC, q)
    if d.get("estrelas"):
        for k in range(5):
            s2, a2 = pop(t, d.get("estrelas_t", 2.5) + k * .1, .35)
            if a2 > 0: g.star(380 + k * 80, 665, 28 * s2, rgba(LILAC, a2))
    if d.get("autor"):
        g.text(W / 2, 730, d["autor"], "Medium", 28, rgba(MUTED, eo(prog(t, 1.2, .4))), "mm")

def b_etapas(g, t, dur, d):
    """Fluxo vertical de etapas. data: titulo, etapas[{texto, t}]"""
    _title(g, t, d)
    st = d["etapas"]; n = len(st); gap = min(120, 360 / max(1, n - 1)); bh = 40 if n <= 4 else 34
    for i, e in enumerate(st):
        a = e.get("t", .4 + i * .7); y = 280 + i * gap
        if i > 0:
            q = eo(prog(t, a - .25, .25))
            if q > 0: g.line([(540, y - gap + bh + 2), (540, y - gap + bh + 2 + (gap - 2 * bh - 4) * q)], rgba(LILAC, q), 5)
        s, al = pop(t, a, .45)
        if al <= 0: continue
        last = i == n - 1
        w2 = 280 * s
        g.rect(540 - w2, y - bh * s, 540 + w2, y + bh * s, rgba(PURPLE if last else BG_MID, al), r=bh,
               outline=rgba(LILAC if last else PURPLE, al), width=3)
        g.text(540, y + 2, e["texto"], "ExtraBold", 36, rgba(WHITE, al), "mm")

def b_selo(g, t, dur, d):
    """Selo de autoridade. data: grande, linha1, linha2"""
    cx, cy = 540, 330
    p = eo(prog(t, 0, .7))
    for i in range(18):
        a = i * math.pi / 9 + t * .3; r0, r1 = 150, 150 + 220 * p
        g.poly([(cx + r0 * math.cos(a - .05), cy + r0 * math.sin(a - .05)), (cx + r1 * math.cos(a), cy + r1 * math.sin(a)),
                (cx + r0 * math.cos(a + .05), cy + r0 * math.sin(a + .05))], rgba(LILAC, .18 * p))
    s, al = pop(t, .1, .6)
    g.circle(cx, cy, 145 * s, rgba(PURPLE, al), outline=rgba(LILAC, al), width=5)
    g.text(cx, cy + 6, d["grande"], "Black", 110 * max(s, .05), rgba(WHITE, al), "mm")
    q = eo(prog(t, .8, .45))
    g.text(540, 560 + (1 - q) * 20, d.get("linha1", "").upper(), "Black", 52, rgba(WHITE, q), "mm")
    q = eo(prog(t, 1.2, .45))
    g.text(540, 625 + (1 - q) * 20, d.get("linha2", ""), "SemiBold", 32, rgba(LILAC, q), "mm")

BLOCOS = {"manchete": b_manchete, "numero": b_numero, "barras": b_barras, "linha": b_linha,
          "lista": b_lista, "citacao": b_citacao, "etapas": b_etapas, "selo": b_selo}

# ================= FUNDO, FUMAÇA E ELEMENTOS FIXOS =================
def _noise(size, rng):
    acc = np.zeros((size, size), np.float32)
    for n, w in [(6, .45), (12, .3), (24, .15), (48, .1)]:
        gimg = Image.fromarray((rng.random((n, n)) * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC)
        acc += np.asarray(gimg, np.float32) / 255 * w
    return (acc - acc.min()) / (acc.max() - acc.min())

class Fundo:
    """fundo roxo animado (área de animação) + máscara de fumaça para o layout solo"""
    def __init__(self, seed=7):
        rng = np.random.default_rng(seed)
        y = np.linspace(0, 1, H)[:, None]; x = np.linspace(0, 1, W)[None, :]
        m = np.clip(.15 + .55 * y * (1 - .4 * x), 0, 1)[..., None]
        img = np.array(BG_DEEP, float) * (1 - m) + np.array(BG_MID, float) * m
        self.bg = Image.fromarray(img.astype(np.uint8), "RGB").convert("RGBA")
        self.noise = _noise(2048, rng)
        self.noise2 = _noise(2048, np.random.default_rng(seed + 1))
        self.glow = self._glow(460, PURPLE, .45)
        self.glow2 = self._glow(380, INDIGO, .3)
        grid = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grid)
        for gx in range(30, W, 60):
            for gy in range(30, H, 60):
                gd.ellipse([gx - 1.5, gy - 1.5, gx + 1.5, gy + 1.5], fill=(255, 255, 255, 18))
        self.grid = grid
    @staticmethod
    def _glow(r, col, a):
        yy, xx = np.mgrid[0:r * 2, 0:r * 2]
        dd = np.sqrt((xx - r) ** 2 + (yy - r) ** 2) / r
        arr = np.zeros((r * 2, r * 2, 4), np.uint8); arr[..., :3] = col
        arr[..., 3] = (np.clip(1 - dd, 0, 1) ** 2 * a * 255).astype(np.uint8)
        return Image.fromarray(arr, "RGBA")
    def base(self, t, h=H):
        im = self.bg.crop((0, 0, W, h)).copy()
        im.paste(self.glow, (int(300 + 260 * math.sin(t * .35)) - 460, int(260 + 120 * math.cos(t * .27)) - 460), self.glow)
        im.paste(self.glow2, (int(800 + 180 * math.cos(t * .3)) - 380, int(560 + 100 * math.sin(t * .4)) - 380), self.glow2)
        im.alpha_composite(self.grid.crop((0, 0, W, h)))
        return im
    def fumaca(self, t, y0, y1):
        """máscara alpha (W x (y1-y0)): 1 = fundo roxo, 0 = vídeo. Borda em fumaça que se move."""
        hgt = y1 - y0
        ox = int(t * 22) % 900; oy = int(t * 9) % 900
        n1 = self.noise[oy:oy + hgt, ox:ox + W]
        ox2 = int(-t * 15) % 900; oy2 = int(t * 6) % 900
        n2 = self.noise2[oy2:oy2 + hgt, ox2:ox2 + W]
        n = (n1 * .6 + n2 * .4)
        g = np.linspace(1, 0, hgt)[:, None]                  # degradê vertical
        m = np.clip((g - .5) * 1.9 + (n - .5) * 1.0 + .5, 0, 1)
        m = m ** 1.2
        return Image.fromarray((m * 255).astype(np.uint8), "L")

def cabecalho(img, t, selo="ECLIPSE EXPERIENCE", direita=""):
    ov = Image.new("RGBA", (W, 110), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    f = font("SemiBold", 24); tw = d.textlength(selo, font=f)
    d.rounded_rectangle([40, 34, 40 + tw + 48, 80], radius=23, fill=(124, 58, 237, 150), outline=(196, 181, 253, 120))
    d.ellipse([58, 51, 70, 63], fill=PINK if int(t * 2) % 2 == 0 else (255, 160, 200))
    d.text((80, 58), selo, font=f, fill=WHITE, anchor="lm")
    if direita: d.text((W - 40, 58), direita, font=font("Medium", 24), fill=MUTED, anchor="rm")
    img.alpha_composite(ov, (0, 0))

def plaquinha(img, t, pessoa, y, lado="esq"):
    """nome + papel; t = tempo desde que a pessoa entrou"""
    p = eo(prog(t, .3, .4)) * (1 - eo(prog(t, 3.8, .4)))
    if p <= .01: return
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    f1, f2 = font("ExtraBold", 38), font("Medium", 24)
    w1 = max(d.textlength(pessoa["nome"].upper(), font=f1), d.textlength(pessoa["papel"], font=f2)) + 64
    x = 40 - (1 - p) * 60 if lado == "esq" else W - 40 - w1 + (1 - p) * 60
    d.rounded_rectangle([x, y, x + w1, y + 104], radius=22, fill=(16, 6, 40, int(225 * p)))
    d.rounded_rectangle([x, y, x + 10, y + 104], radius=5, fill=rgba(PURPLE if pessoa.get("mentor") else LILAC, p))
    d.text((x + 32, y + 36), pessoa["nome"].upper(), font=f1, fill=rgba(WHITE, p), anchor="lm")
    d.text((x + 32, y + 76), pessoa["papel"], font=f2, fill=rgba(MUTED, p), anchor="lm")
    img.alpha_composite(ov)

# ---------------- legenda ----------------
CAP_SIZE = 62
def agrupar(words):
    """words: [[t, palavra], ...] -> grupos de até 3 palavras / 18 caracteres"""
    groups, cur = [], []
    for i, (ts, wd) in enumerate(words):
        cur.append([ts, wd])
        nxt = words[i + 1][0] if i + 1 < len(words) else ts + 1
        ln = sum(len(w) + 1 for _, w in cur)
        if wd[-1] in ".,!?:" or len(cur) >= 3 or ln > 18 or nxt - ts > .8:
            groups.append(cur); cur = []
    if cur: groups.append(cur)
    for gi, gr in enumerate(groups):
        end = groups[gi + 1][0][0] if gi + 1 < len(groups) else gr[-1][0] + 1.0
        for w in gr: w.append(min(end, gr[-1][0] + 1.2))
    return groups

def legenda(img, t, groups, cy):
    d = ImageDraw.Draw(img, "RGBA"); f = font("Black", CAP_SIZE)
    for gr in groups:
        if gr[0][0] - .02 <= t < gr[0][2]:
            words = [w[1].rstrip(",").upper() for w in gr]
            sp = d.textlength(" ", font=f); ws = [d.textlength(w, font=f) for w in words]
            total = sum(ws) + sp * (len(ws) - 1)
            x = W / 2 - total / 2
            started = [i for i, g_ in enumerate(gr) if g_[0] <= t]; cur = started[-1] if started else -1
            for i, (w, wl) in enumerate(zip(words, ws)):
                if i == cur:
                    k = eback(prog(t, gr[i][0], .15))
                    pad = 12 * k
                    d.rounded_rectangle([x - pad - 4, cy - 42 - pad * .3, x + wl + pad + 4, cy + 46 + pad * .3],
                                        radius=18, fill=PURPLE + (255,))
                col = WHITE if i <= cur else (225, 218, 245)
                d.text((x, cy + 4), w, font=f, fill=col, anchor="lm", stroke_width=5, stroke_fill=(16, 6, 40))
                x += wl + sp
            return
