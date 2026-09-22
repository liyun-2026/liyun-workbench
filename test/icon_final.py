# -*- coding: utf-8 -*-
"""砺蕴桌面图标 v16 —— 按「高胜率图标模式」重做。

三条硬改（前几轮全栽在这）：
  1. 符号**粗壮实心**（细线在 60px 必死）
  2. 底色用**饱和强色对角渐变**（之前一路素雅墨白 = 寡淡）
  3. 符号撑到画面的 ~76%（之前只有 ~45%，小家子气）

元素池仍是用户点定的：声刻机 / 声波 / 话筒 / 声音曲线 / 高潮。
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W = 1024                      # 内部工作尺寸
OUT = 512                     # 输出
SAFE = 0.380                  # maskable 安全圆（Android 按圆裁切）
RR = 0.2237                   # iOS 圆角方
BG_LIGHT = (248, 246, 241)
BG_DARK = (232, 227, 216)
INK = (23, 22, 19)
WARM = (247, 243, 234)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREV = os.path.join(ROOT, '预览')
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'


# ───────────────────────── 底层 ─────────────────────────
def new_mask():
    return Image.new('L', (W, W), 0)


def dot(d, cx, cy, r):
    d.ellipse([(cx - r) * W, (cy - r) * W, (cx + r) * W, (cy + r) * W], fill=255)


def line(d, pts, w):
    """变宽带笔触：逐段四边形 + 节点补圆（PIL 的 line(width=) 会留毛刺）。"""
    if len(pts) < 2:
        return
    hw = w * W / 2.0
    P = [(p[0] * W, p[1] * W) for p in pts]
    for i in range(len(P) - 1):
        x1, y1 = P[i]; x2, y2 = P[i + 1]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L * hw, dx / L * hw
        d.polygon([(x1 + nx, y1 + ny), (x2 + nx, y2 + ny),
                   (x2 - nx, y2 - ny), (x1 - nx, y1 - ny)], fill=255)
    for x, y in P:
        d.ellipse([x - hw, y - hw, x + hw, y + hw], fill=255)


def rrect(d, x0, y0, x1, y1, r):
    r = min(r, (y1 - y0) / 2.0 - 0.001, (x1 - x0) / 2.0 - 0.001)
    d.rounded_rectangle([x0 * W, y0 * W, x1 * W, y1 * W], radius=max(r, 0) * W, fill=255)


def arc_pts(cx, cy, r, a0, a1, n=140):
    return [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
            for a in np.linspace(a0, a1, n)]


def sine(x0, x1, cy, amp, cycles, phase=0.0, n=220):
    return [(x0 + (x1 - x0) * t, cy - amp * math.sin(2 * math.pi * cycles * t + phase))
            for t in np.linspace(0, 1, n)]


def sub(a, b):
    return Image.fromarray(np.clip(np.array(a, int) - np.array(b, int), 0, 255).astype(np.uint8), 'L')


def far_radius(m):
    a = np.array(m) > 128
    ys, xs = np.nonzero(a)
    if len(xs) == 0:
        return 0.0
    return float(np.max(np.hypot(xs - W / 2.0, ys - W / 2.0))) / W


def fit(m, target=SAFE):
    r = far_radius(m)
    if r <= target or r == 0:
        return m
    s = target / r
    sz = max(int(W * s), 1)
    m2 = m.resize((sz, sz), Image.LANCZOS)
    out = new_mask()
    out.paste(m2, ((W - sz) // 2, (W - sz) // 2))
    return out


def bg_grad(c1, c2):
    t = np.linspace(0, 1, W)[:, None]
    g = np.linspace(0, 1, W)[None, :]
    k = t * 0.58 + g * 0.42
    arr = np.array(c1, float)[None, None, :] * (1 - k[..., None]) + np.array(c2, float)[None, None, :] * k[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')


def compose(m, c1, c2, fg, rounded=True):
    im = bg_grad(c1, c2).convert('RGBA')
    lay = Image.new('RGBA', (W, W), fg + (255,))
    lay.putalpha(m)
    im.alpha_composite(lay)
    if rounded:
        mk = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mk).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * RR, fill=255)
        im.putalpha(mk)
    return im.resize((OUT, OUT), Image.LANCZOS)


# ───────────────────────── 八个符号 ─────────────────────────
def s_bars():
    """声波柱阵：三根粗柱由矮到高 —— 日积月累到高潮。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    bw, gap, base = 0.145, 0.062, 0.735
    hs = [0.235, 0.375, 0.520]
    x0 = 0.5 - (3 * bw + 2 * gap) / 2 + bw / 2
    for i, h in enumerate(hs):
        x = x0 + i * (bw + gap)
        rrect(d, x - bw / 2, base - h, x + bw / 2, base, bw / 2)
    return m


def s_mic():
    """话筒：头 / 托 / 柱 / 座，全部粗壮圆润。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    cy = 0.345
    rrect(d, 0.395, 0.175, 0.605, 0.520, 0.105)              # 头
    line(d, arc_pts(0.5, cy + 0.085, 0.195, 28, 152), 0.082)  # U 形托
    rrect(d, 0.465, 0.605, 0.535, 0.760, 0.035)              # 柱
    rrect(d, 0.355, 0.775, 0.645, 0.825, 0.025)              # 座
    return m


def s_wave():
    """声音曲线：一道极粗的单周期波。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    line(d, sine(0.175, 0.825, 0.500, 0.150, 1.0), 0.135)
    return m


def s_letter():
    """L 单标（砺蕴首字母）：竖笔笔直认得清，底横末端上扬如书法收锋。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    line(d, [(0.360, 0.160), (0.360, 0.770)], 0.152)                       # 竖笔
    line(d, [(0.360, 0.770), (0.700, 0.770)], 0.152)                       # 底横
    line(d, [(0.690, 0.770), (0.815, 0.678)], 0.140)                       # 上扬尾
    return m


def s_micwave():
    """话筒 + 声弧：头右上一道粗弧 —— 正在发声（避开左右对称的 Wi-Fi 形）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    rrect(d, 0.385, 0.255, 0.585, 0.565, 0.098)              # 头
    line(d, arc_pts(0.485, 0.625, 0.170, 30, 150), 0.072)    # U 形托
    rrect(d, 0.453, 0.658, 0.517, 0.765, 0.032)              # 柱
    rrect(d, 0.360, 0.778, 0.610, 0.820, 0.021)              # 座
    for r, wdt in ((0.235, 0.074), (0.330, 0.064)):
        line(d, arc_pts(0.485, 0.410, r, -56, 16), wdt)      # 声弧（右上单向）
    return m


def s_michew():
    """头顶出声：话筒头顶升起一道粗波 —— 声从口出。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    line(d, sine(0.385, 0.615, 0.262, 0.052, 1.0), 0.078)    # 头顶那道波
    rrect(d, 0.400, 0.348, 0.600, 0.638, 0.098)              # 头
    line(d, arc_pts(0.500, 0.683, 0.166, 32, 148), 0.070)    # U 形托
    rrect(d, 0.470, 0.709, 0.530, 0.793, 0.030)              # 柱
    rrect(d, 0.375, 0.803, 0.625, 0.845, 0.021)              # 座
    return m


def s_hanwave():
    """砺字 + 托波：「砺」坐在一道粗声波上。"""
    m = new_mask()
    try:
        f = ImageFont.truetype(FONT, int(W * 0.46))
    except Exception:
        return m
    td = ImageDraw.Draw(m)
    td.text((0.5 * W, 0.415 * W), '砺', font=f, fill=255, anchor='mm',
            stroke_width=int(W * 0.021), stroke_fill=255)
    line(ImageDraw.Draw(m), sine(0.215, 0.785, 0.800, 0.062, 1.0), 0.086)
    return m


def s_han():
    """汉字单字「砺」：中文最强的识别资产，加粗到实心。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    size = int(W * 0.62)
    try:
        f = ImageFont.truetype(FONT, size)
    except Exception:
        return m
    tmp = Image.new('L', (W, W), 0)
    td = ImageDraw.Draw(tmp)
    td.text((W / 2, W / 2), '砺', font=f, fill=255, anchor='mm',
            stroke_width=int(size * 0.045), stroke_fill=255)
    return fit(tmp, 0.86)          # 汉字笔画碎，先放大到接近满幅再交给 fit 收安全圆


def s_source():
    """声源扩散：中心实心点 + 左右对称各两道粗弧。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    dot(d, 0.500, 0.500, 0.118)
    for r, wdt in ((0.245, 0.092), (0.360, 0.078)):
        line(d, arc_pts(0.500, 0.500, r, -52, 52), wdt)
        line(d, arc_pts(0.500, 0.500, r, 128, 232), wdt)
    return m


def s_notch():
    """声刻盘：实心圆被一道声波横切（刻出声音）。"""
    disc = new_mask(); dot(ImageDraw.Draw(disc), 0.500, 0.500, 0.300)
    cut = new_mask()
    line(ImageDraw.Draw(cut), sine(0.175, 0.825, 0.500, 0.105, 1.0), 0.135)
    return sub(disc, cut)


def s_ringwave():
    """环中声波：粗圆环被一道波横穿，波伸出环外。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    line(d, arc_pts(0.500, 0.500, 0.255, 0, 360), 0.090)
    line(d, sine(0.195, 0.805, 0.500, 0.125, 1.0), 0.118)
    return m


# ───────────────────────── 方案表 ─────────────────────────
VARIANTS = [
    ('01 话筒',     '播音最直白的符号',   s_mic,     ((46, 92, 168), (16, 34, 78)),   WARM),
    ('02 声波柱阵', '三根粗柱递增到高潮', s_bars,    ((34, 32, 30), (11, 10, 9)),      WARM),
    ('03 声音曲线', '一道极粗的波',       s_wave,    ((47, 122, 156), (20, 74, 103)),  WARM),
    ('04 L 单标',   '砺蕴首字母，波尾',   s_letter,  ((62, 58, 158), (24, 21, 78)),    WARM),
    ('05 单字砺',   '中文最强识别资产',   s_han,     (BG_LIGHT, BG_DARK),              INK),
    ('06 话筒声弧', '头右上散出声弧',     s_micwave, ((35, 82, 68), (13, 49, 38)),    WARM),
    ('07 头顶出声', '头顶升起一道波',     s_michew,  ((46, 64, 74), (17, 27, 33)),     WARM),
    ('08 砺字托波', '字坐在一道声波上',   s_hanwave, ((40, 50, 120), (16, 20, 56)),   WARM),
]


def rounded(im, size):
    im = im.convert('RGBA').resize((size, size), Image.LANCZOS)
    mk = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mk).rounded_rectangle([0, 0, size - 1, size - 1], radius=size * RR, fill=255)
    im.putalpha(mk)
    return im


def main():
    os.makedirs(PREV, exist_ok=True)
    icons = []
    print('安全自检（图形层 alpha 最远半径，上限 %.3f）：' % SAFE)
    for name, note, fn, (c1, c2), fg in VARIANTS:
        m = fit(fn())
        r = far_radius(m)
        print('  %s %-12s %.3f' % ('OK ' if r <= SAFE + 1e-3 else '!! ', name, r))
        im = compose(m, c1, c2, fg)
        icons.append((name, im))
        im.save(os.path.join(PREV, '砺蕴图标_v16_%s.png' % name.split(' ')[0]))

    # ── 总览 ──
    cols, cell, gap, pad = 4, 230, 34, 54
    rows = math.ceil(len(icons) / cols)
    bw = pad * 2 + cols * cell + (cols - 1) * gap
    bh = pad * 2 + 46 + rows * (cell + 30 + 30) + rows * 26
    cv = Image.new('RGB', (bw, bh), (17, 17, 19))
    d = ImageDraw.Draw(cv)
    d.text((pad, 22), '砺蕴 · 桌面图标 v16 —— 粗壮实心 / 强色 / 撑满', fill=(238, 234, 224))
    for i, (name, im) in enumerate(icons):
        c, r = i % cols, i // cols
        x = pad + c * (cell + gap)
        y = pad + 46 + r * (cell + 30 + 30 + 26)
        cv.paste(rounded(im, cell), (x, y), rounded(im, cell))
        d.text((x, y + cell + 12), name, fill=(232, 228, 218))
        for j, s in enumerate((56, 36)):
            sx = x + j * (s + 16)
            cv.paste(rounded(im, s), (sx, y + cell + 34 + (56 - s) // 2), rounded(im, s))
    cv.save(os.path.join(PREV, '砺蕴图标_v16_总览.png'))

    # ── 手机桌面实景 ──
    pw, ph = 800, 1180
    ph_img = Image.new('RGB', (pw, ph))
    t = np.linspace(0, 1, ph)[:, None]
    g = np.linspace(0, 1, pw)[None, :]
    k = t * 0.7 + g * 0.3
    arr = np.array((38, 44, 62), float)[None, None, :] * (1 - k[..., None]) + \
          np.array((12, 14, 24), float)[None, None, :] * k[..., None]
    ph_img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')
    pd = ImageDraw.Draw(ph_img)
    pd.text((40, 46), '9:41', fill=(240, 238, 232))
    ic, ig = 132, 44
    x0 = (pw - (4 * ic + 3 * ig)) // 2
    for i, (name, im) in enumerate(icons):
        c, r = i % 4, i // 4
        x = x0 + c * (ic + ig)
        y = 170 + r * (ic + 74)
        ph_img.paste(rounded(im, ic), (x, y), rounded(im, ic))
        pd.text((x + ic // 2 - 22, y + ic + 14), '砺蕴', fill=(228, 226, 220))
    ph_img.save(os.path.join(PREV, '砺蕴图标_v16_实景.png'))
    print('已出：总览 / 实景 / %d 枚单图 -> %s' % (len(icons), PREV))


if __name__ == '__main__':
    main()
