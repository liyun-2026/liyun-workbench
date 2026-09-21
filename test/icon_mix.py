# -*- coding: utf-8 -*-
"""砺蕴桌面图标 v14：声音元素「简化 + 融合」十二版。

用户点名的元素池：声刻机、声波、话筒、声音曲线、高潮（表达的最高点），
并服务于「播音主持艺考 + 学生激励」。

铁律：每个方案都是**一个符号**，让两三个元素长在同一个形状上（融合），
不是把话筒和声波并排摆在一起（拼贴）。全部平面、2~3 色、圆头线、无渐变金属。
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw

BASE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/预览"
SS = 4                      # 超采样，保证圆头线边缘干净
W = 512 * SS
SAFE = 0.400                # maskable 安全圆上限

# ───────────── 底层绘制（归一化坐标） ─────────────
def new_mask():
    return Image.new('L', (W, W), 0)


def line(d, pts, w):
    """圆头粗线：每段连线 + 端点补圆（PIL 的 line 自带端点不圆）。"""
    p = [(x * W, y * W) for x, y in pts]
    d.line(p, fill=255, width=int(w * W), joint="curve")
    r = w * W / 2.0
    for a, b in p:
        d.ellipse([a - r, b - r, a + r, b + r], fill=255)


def smooth(fn, n=260, t0=0.0, t1=1.0):
    return [fn(t0 + (t1 - t0) * i / n) for i in range(n + 1)]


def arc_pts(cx, cy, r, a0, a1, n=160, wob=None):
    """角度用度；wob(θ归一化) 可让半径起伏。"""
    out = []
    for i in range(n + 1):
        t = i / n
        a = math.radians(a0 + (a1 - a0) * t)
        rr = r * (1 + wob(t)) if wob else r
        out.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return out


def dot(d, cx, cy, r):
    d.ellipse([(cx - r) * W, (cy - r) * W, (cx + r) * W, (cy + r) * W], fill=255)


def ring(d, cx, cy, r, w):
    d.ellipse([(cx - r) * W, (cy - r) * W, (cx + r) * W, (cy + r) * W],
              outline=255, width=int(w * W))


def rrect(d, x0, y0, x1, y1, rad):
    d.rounded_rectangle([x0 * W, y0 * W, x1 * W, y1 * W], radius=rad * W, fill=255)


def poly(d, pts):
    d.polygon([(x * W, y * W) for x, y in pts], fill=255)


def ribbon(d, pts, wf, n=200):
    """沿路径变宽的带（绸缎感）：法线偏移成多边形 + 两端圆头。"""
    P = [(x * W, y * W) for x, y in pts]
    up, dn = [], []
    n = len(P) - 1
    for i, (x, y) in enumerate(P):
        j = min(i + 1, n); k = max(i - 1, 0)
        dx, dy = P[j][0] - P[k][0], P[j][1] - P[k][1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        hw = wf(i / n) * W / 2.0
        up.append((x + nx * hw, y + ny * hw))
        dn.append((x - nx * hw, y - ny * hw))
    d.polygon(up + dn[::-1], fill=255)
    for p, hw in ((P[0], wf(0.0) / 2), (P[-1], wf(1.0) / 2)):
        r = hw * W
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)


def sine(x0, x1, y, amp, periods, phase=0.0):
    return smooth(lambda t: (x0 + (x1 - x0) * t,
                             y - amp * math.sin(2 * math.pi * periods * t + phase)))


# ───────────── 十二个方案 ─────────────
def v01():
    """话筒即波峰：一条声波走到中间，波峰膨胀成话筒头（头下接 U 托与底座）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    line(d, sine(0.10, 0.90, 0.62, 0.075, 1.5), 0.046)
    dot(d, 0.50, 0.45, 0.125)                       # 波峰 = 话筒头
    line(d, arc_pts(0.50, 0.45, 0.185, 32, 148), 0.048)   # U 形托
    rrect(d, 0.472, 0.635, 0.528, 0.845, 0.028)     # 立柱
    rrect(d, 0.385, 0.815, 0.615, 0.865, 0.025)     # 底座
    return m


def v02():
    """声波山岳：山脊就是声波，三峰递增到最高（高潮），峰顶一颗声源。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    base = 0.845
    x0, x1 = 0.09, 0.91

    def ridge(t):
        x = x0 + (x1 - x0) * t
        h = 0.10 + 0.34 * t                          # 越往右越高（积蕴→高潮）
        s = math.sin(math.pi * (0.10 + 2.6 * t))     # 三个起伏
        return (x, base - h * max(s, 0.06))
    pts = smooth(ridge, 320)
    poly(d, pts + [(x1, base + 0.02), (x0, base + 0.02)])
    dot(d, 0.775, 0.335, 0.062)                     # 最高峰顶的声源 / 话筒
    return m


def v03():
    """柱阵渐起：均衡器柱由矮到高，最高一柱顶着声源 —— 学生成长到高潮。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    n, bw = 7, 0.062
    span = 0.80; x0 = 0.5 - span / 2 + bw / 2
    hs = [0.10, 0.15, 0.20, 0.27, 0.34, 0.42, 0.52]
    for i in range(n):
        x = x0 + i * (span - bw) / (n - 1)
        h = hs[i]
        rrect(d, x - bw / 2, 0.80 - h, x + bw / 2, 0.80, bw / 2)
    dot(d, x0 + 6 * (span - bw) / 6, 0.80 - 0.52 - 0.055, 0.055)
    return m


def v04():
    """话筒 + 声弧：话筒在左，三条同心声弧向右辐射（播音的扩散）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    dot(d, 0.375, 0.44, 0.105)                      # 话筒头
    line(d, arc_pts(0.375, 0.44, 0.155, 30, 150), 0.046)
    rrect(d, 0.352, 0.595, 0.398, 0.735, 0.023)
    rrect(d, 0.290, 0.710, 0.460, 0.755, 0.022)
    for i, r in enumerate((0.245, 0.325, 0.405)):   # 声弧：越远越细
        line(d, arc_pts(0.375, 0.50, r, -52, 52), 0.050 - i * 0.007)
    return m


def v05():
    """声波成圆：一条波沿圆周走，右上那一段拱得最高（盘即波，波即峰）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    pts = arc_pts(0.50, 0.50, 0.315, 0, 360, n=400,
                  wob=lambda t: 0.115 * math.sin(12 * math.pi * t) *
                                (0.55 + 0.75 * max(math.cos(2 * math.pi * (t - 0.125)), 0)))
    line(d, pts, 0.050)
    dot(d, 0.50, 0.50, 0.052)                       # 轴心 / 声源
    return m


def v06():
    """声刻机：刻针斜落，针尖处迸出三道声纹（刻 → 声）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    line(d, [(0.895, 0.175), (0.545, 0.545)], 0.052)     # 针臂
    rrect(d, 0.845, 0.130, 0.945, 0.225, 0.045)          # 刻头
    dot(d, 0.545, 0.545, 0.052)                          # 针尖
    for i, r in enumerate((0.145, 0.225, 0.305)):
        line(d, arc_pts(0.545, 0.545, r, -18, 96), 0.046 - i * 0.008)
    line(d, sine(0.545, 0.90, 0.80, 0.045, 1.2), 0.040)  # 被刻出的一道波
    return m


def v07():
    """话筒头由声波卷成：头的上半圈是三个起伏的波，其余仍是话筒。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    pts = arc_pts(0.50, 0.435, 0.155, 180, 360, n=200,
                  wob=lambda t: 0.10 * math.sin(6 * math.pi * t))
    line(d, pts, 0.050)
    line(d, arc_pts(0.50, 0.435, 0.195, 25, 155), 0.050)  # U 托
    rrect(d, 0.470, 0.630, 0.530, 0.780, 0.030)
    rrect(d, 0.400, 0.755, 0.600, 0.805, 0.025)
    return m


def v08():
    """同心刻纹盘：三道刻纹 + 一道斜贯的针痕（声刻机的盘面本身）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    for r in (0.150, 0.235, 0.320):
        ring(d, 0.48, 0.50, r, 0.026)
    dot(d, 0.48, 0.50, 0.062)
    line(d, [(0.905, 0.215), (0.560, 0.640)], 0.048)     # 针痕斜贯盘面
    dot(d, 0.560, 0.640, 0.048)
    for i, r in enumerate((0.115, 0.190)):
        line(d, arc_pts(0.560, 0.640, r, -10, 88), 0.042 - i * 0.008)
    return m


def v09():
    """双波夹声源：上下两道声音包络夹住一颗话筒头（播音 = 说的与听的）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    line(d, sine(0.12, 0.88, 0.335, 0.055, 1.6), 0.046)
    line(d, sine(0.12, 0.88, 0.665, 0.055, 1.6, math.pi), 0.046)
    dot(d, 0.50, 0.50, 0.115)                        # 声源 / 话筒头
    ring(d, 0.50, 0.50, 0.055, 0.030)                # 负形，读出「话筒」
    return m


def v10():
    """由细到粗到高潮：声音曲线一路加厚（积蕴·练萃），末端冲上峰顶（高潮）。"""
    m = new_mask(); d = ImageDraw.Draw(m)

    def path(t):
        x = 0.11 + 0.56 * t
        up = 0.62 - 0.34 * max(0.0, (t - 0.62) / 0.38) ** 1.6
        return (x, up)
    pts = smooth(path, 220)
    # 宽度：细 → 粗（末段略收，冲成尖）
    ribbon(d, pts, lambda t: 0.020 + 0.075 * min(t / 0.75, 1.0) - 0.030 * max(0.0, t - 0.82) / 0.18)
    dot(d, pts[-1][0], pts[-1][1] - 0.012, 0.058)    # 峰顶声源
    return m


def v11():
    """广播核：一颗声源，左右各三道扩散声弧（最经典的 broadcasting 符号）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    dot(d, 0.50, 0.50, 0.095)
    ring(d, 0.50, 0.50, 0.040, 0.028)
    for i, r in enumerate((0.205, 0.290, 0.375)):
        w = 0.052 - i * 0.008
        line(d, arc_pts(0.50, 0.50, r, -46, 46), w)
        line(d, arc_pts(0.50, 0.50, r, 134, 226), w)
    return m


def v12():
    """波围成圆，缺口处托出话筒头：盘是波围的，最高点是话筒（三合一）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    line(d, arc_pts(0.50, 0.52, 0.315, 118, 402, n=300,
                    wob=lambda t: 0.055 * math.sin(9 * math.pi * t)), 0.052)
    dot(d, 0.735, 0.285, 0.088)                      # 缺口处的峰 = 话筒头
    line(d, arc_pts(0.735, 0.285, 0.130, 22, 158), 0.042)
    return m


# ───────────── 配色（底 / 符号 / 点睛） ─────────────
VARIANTS = [
    ("01 话筒即波峰", "波峰 = 话筒头", v01, ((22, 22, 26), (18, 18, 22)), (194, 163, 90), None),
    ("02 声波山岳", "三峰递增到高潮", v02, ((246, 245, 242), (232, 228, 219)), (42, 111, 142), (184, 147, 47)),
    ("03 柱阵渐起", "成长到最高一柱", v03, ((22, 35, 61), (14, 22, 42)), (244, 239, 227), None),
    ("04 话筒声弧", "话筒 + 声纹辐射", v04, ((22, 22, 26), (16, 16, 20)), (244, 239, 227), None),
    ("05 声波成圆", "盘即波，右上成峰", v05, ((242, 236, 221), (228, 220, 202)), (27, 26, 24), None),
    ("06 声刻机", "针落迸出声纹", v06, ((22, 22, 26), (16, 16, 20)), (194, 163, 90), None),
    ("07 波卷话筒", "话筒头由波卷成", v07, ((42, 111, 142), (28, 84, 112)), (244, 239, 227), None),
    ("08 刻纹盘", "同心刻纹 + 针痕", v08, ((246, 245, 242), (230, 226, 216)), (27, 26, 24), None),
    ("09 双波夹声源", "说与听之间", v09, ((22, 22, 26), (16, 16, 20)), (232, 85, 60), None),
    ("10 由细到高潮", "曲线加厚 → 冲顶", v10, ((242, 236, 221), (226, 218, 199)), (27, 26, 24), (184, 147, 47)),
    ("11 广播核", "声源 + 扩散声弧", v11, ((22, 35, 61), (13, 21, 40)), (194, 163, 90), None),
    ("12 波围圆·话筒", "缺口处托出话筒", v12, ((22, 22, 26), (16, 16, 20)), (244, 239, 227), None),
]


def bg_grad(c1, c2):
    t = np.linspace(0, 1, W)[None, :, None] * 0.5 + np.linspace(0, 1, W)[:, None, None] * 0.5
    a = np.array(c1, float); b = np.array(c2, float)
    return Image.fromarray(np.clip(a + (b - a) * t, 0, 255).astype(np.uint8), 'RGB')


def rounded(im, r):
    s = im.size[0]
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    out = im.convert('RGBA'); out.putalpha(m)
    return out


def far_radius(mask):
    """图形层 alpha 的最远半径（maskable 安全自检，上限 0.400）。"""
    a = np.array(mask.resize((256, 256), Image.LANCZOS)) > 96
    ys, xs = np.nonzero(a)
    if len(xs) == 0:
        return 0.0
    return float(np.max(np.hypot(xs / 255.0 - 0.5, ys / 255.0 - 0.5)))


def fit(mask, r):
    """超出安全圆时，以中心为原点等比收进 0.395。"""
    if r <= 0.395:
        return mask
    s = 0.395 / r
    half = (0.5 / s) * W
    need = int(math.ceil(half)) + 2
    c = int(W / 2)
    big = Image.new('L', (need * 2, need * 2), 0)
    big.paste(mask, (need - c, need - c))
    return big.crop((need - half, need - half, need + half, need + half)).resize((W, W), Image.LANCZOS)


icons = []
print("maskable 安全自检（图形层 alpha，上限 %.3f）：" % SAFE)
for name, note, fn, bgc, fg, ac in VARIANTS:
    m = fn()
    r0 = far_radius(m)
    m = fit(m, r0)
    r = far_radius(m)
    print("  %-16s 原始 %.3f → %.3f %s" % (name, r0, r, "OK" if r <= SAFE else "❌"))

    im = bg_grad(bgc[0], bgc[1])
    im.paste(Image.new('RGB', (W, W), fg), (0, 0), m)
    if ac:                                    # 点睛金：只染「最右上」那块 = 高潮处
        am = np.array(m) > 128
        ys, xs = np.nonzero(am)
        yy = np.arange(W)[:, None]; xx = np.arange(W)[None, :]
        sel = am & (yy < np.percentile(ys, 42)) & (xx > np.percentile(xs, 62))
        im.paste(Image.new('RGB', (W, W), ac), (0, 0),
                 Image.fromarray((sel * 255).astype(np.uint8), 'L'))

    im = im.resize((512, 512), Image.LANCZOS)
    im.save(os.path.join(BASE, "砺蕴图标_v14_" + name.replace(' ', '_') + ".png"))
    icons.append((name, note, im))

# ───────────── 总览 ─────────────
HEI = "/System/Library/Fonts/STHeiti Medium.ttc"
from PIL import ImageFont
cell, pad, lh = 250, 26, 54
cols = 4; rows = (len(icons) + cols - 1) // cols
OW = cols * cell + (cols + 1) * pad
OH = rows * (cell + lh) + (rows + 1) * pad
cv = Image.new('RGB', (OW, OH), (238, 234, 226))
f1 = ImageFont.truetype(HEI, 19, index=0); f2 = ImageFont.truetype(HEI, 14, index=0)
dd = ImageDraw.Draw(cv)
for i, (name, note, im) in enumerate(icons):
    r0, c0 = divmod(i, cols)
    x = pad + c0 * (cell + pad); y = pad + r0 * (cell + lh + pad)
    rr = rounded(im.resize((cell, cell), Image.LANCZOS), int(cell * 0.224))
    cv.paste(rr, (x, y), rr)
    dd.text((x, y + cell + 8), name, fill=(54, 46, 38), font=f1)
    dd.text((x, y + cell + 31), note, fill=(126, 112, 94), font=f2)
cv.save(os.path.join(BASE, "砺蕴图标_v14_总览.png"))

# ───────────── 真机小尺寸 ─────────────
sm, gp = 132, 30
sb = Image.new('RGB', (len(icons) * sm + (len(icons) + 1) * gp, sm + 58), (238, 234, 226))
sd = ImageDraw.Draw(sb)
for i, (name, note, im) in enumerate(icons):
    x = gp + i * (sm + gp)
    rr = rounded(im.resize((sm, sm), Image.LANCZOS), int(sm * 0.224))
    sb.paste(rr, (x, 8), rr)
    rt = rounded(im.resize((52, 52), Image.LANCZOS), 12)
    sb.paste(rt, (x + sm - 52, sm - 34), rt)
    sd.text((x + 2, sm + 14), name[:2], fill=(54, 46, 38), font=f2)
sb.save(os.path.join(BASE, "砺蕴图标_v14_真机.png"))
print("ok")
