# -*- coding: utf-8 -*-
"""砺蕴桌面图标 v15：声音元素「简化 + 融合」十二版 —— 修正版。

v14 的问题：波形周期太多（成土豆/花）、符号被自动缩得过小、部分撞车（靶心/信号格）。
本版：① 波形只留 1.5~2 个周期、幅度加大；② 符号设计时就撑满安全圆（减少自动缩放）；
③ 每个方案让 2~3 个元素长在同一个形状上（融合），不是并排拼贴。
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageChops, ImageFont

BASE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/预览"
SS = 4
W = 512 * SS
SAFE = 0.400
HEI = "/System/Library/Fonts/STHeiti Medium.ttc"


# ───────────── 底层 ─────────────
def new_mask():
    return Image.new('L', (W, W), 0)


def line(d, pts, w):
    p = [(x * W, y * W) for x, y in pts]
    d.line(p, fill=255, width=int(w * W), joint="curve")
    r = w * W / 2.0
    for a, b in p:
        d.ellipse([a - r, b - r, a + r, b + r], fill=255)


def smooth(fn, n=280, t0=0.0, t1=1.0):
    return [fn(t0 + (t1 - t0) * i / n) for i in range(n + 1)]


def arc_pts(cx, cy, r, a0, a1, n=180, wob=None):
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


def sine(x0, x1, y, amp, periods, phase=0.0, n=260):
    return smooth(lambda t: (x0 + (x1 - x0) * t,
                             y - amp * math.sin(2 * math.pi * periods * t + phase)), n)


def wave_mask(x0, x1, y, amp, periods, w, phase=0.0):
    m = new_mask()
    line(ImageDraw.Draw(m), sine(x0, x1, y, amp, periods, phase), w)
    return m


def sub(a, b):
    return ImageChops.subtract(a, b)


def mic(d, cx, cy, hr, tr, base_y):
    """标准话筒三件套：圆头（可选）/ U 形托 / 立柱 + 底座。base_y = 底座底边绝对 y。"""
    if hr > 0:
        dot(d, cx, cy, hr)
    line(d, arc_pts(cx, cy, tr, 26, 154), 0.048)          # U 形托（下半圈）
    top = cy + tr + 0.022                                  # 托底往下接柱
    rrect(d, cx - 0.030, top, cx + 0.030, base_y - 0.046, 0.028)
    rrect(d, cx - 0.116, base_y - 0.046, cx + 0.116, base_y, 0.023)


# ───────────── 十二个方案 ─────────────
def v01():
    """波杆话筒：话筒的立柱本身就是一道声波（话筒即声源）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    dot(d, 0.50, 0.375, 0.145)
    line(d, arc_pts(0.50, 0.375, 0.212, 26, 154), 0.050)
    line(d, smooth(lambda t: (0.50 + 0.052 * math.sin(2 * math.pi * 1.5 * t),
                              0.645 + 0.168 * t), 200), 0.048)
    rrect(d, 0.386, 0.775, 0.614, 0.822, 0.024)
    return m


def v02():
    """头中有波：话筒头里挖出一道完整声波（话筒本身就是发声体）。"""
    head = new_mask(); dot(ImageDraw.Draw(head), 0.50, 0.375, 0.172)
    m = sub(head, wave_mask(0.352, 0.648, 0.375, 0.046, 1.5, 0.036))
    d = ImageDraw.Draw(m)
    line(d, arc_pts(0.50, 0.375, 0.225, 26, 154), 0.048)
    rrect(d, 0.470, 0.622, 0.530, 0.760, 0.028)
    rrect(d, 0.384, 0.755, 0.616, 0.802, 0.024)
    return m


def v03():
    """声波山岳：三个峰一座比一座高，脊线即声波 —— 日积月累到高潮。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    x0, x1, base = 0.160, 0.800, 0.785
    peaks = ((0.295, 0.155, 0.088), (0.515, 0.275, 0.082), (0.715, 0.435, 0.076))

    def ridge(t):
        x = x0 + (x1 - x0) * t
        y = base
        for c, h, s in peaks:
            y -= h * math.exp(-((x - c) / s) ** 2)
        return (x, y)
    pts = smooth(ridge, 360)
    poly(d, pts + [(x1, base), (x0, base)])
    dot(d, 0.715, base - 0.435 - 0.052, 0.052)
    return m


def v04():
    """柱阵渐起：五根柱一节比一节高（成长 → 高潮）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    n, bw, span, base = 5, 0.082, 0.60, 0.775
    hs = [0.13, 0.21, 0.30, 0.40, 0.51]
    x0 = 0.5 - span / 2 + bw / 2
    for i in range(n):
        x = x0 + i * (span - bw) / (n - 1)
        rrect(d, x - bw / 2, base - hs[i], x + bw / 2, base, bw / 2)
    return m


def v05():
    """话筒向上发声：话筒在上方散出三道声弧 —— 声音朝上、朝理想去。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    for i, r in enumerate((0.135, 0.212, 0.289)):
        line(d, arc_pts(0.50, 0.455, r, -128, -52), 0.050 - i * 0.008)
    mic(d, 0.50, 0.575, 0.108, 0.152, 0.845)
    return m


def v06():
    """话筒向右扩散：话筒在左，三道声纹朝右叠出 —— 播音的扩散。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    for i, r in enumerate((0.215, 0.295, 0.375)):
        line(d, arc_pts(0.395, 0.50, r, -48, 48), 0.054 - i * 0.008)
    mic(d, 0.395, 0.50, 0.112, 0.155, 0.845)
    return m


def v07():
    """环中声波：细圆环 + 一道穿过它的声波（穿透感）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    ring(d, 0.50, 0.50, 0.288, 0.048)
    line(d, sine(0.128, 0.872, 0.500, 0.078, 2.5), 0.042)
    return m


def v08():
    """阶梯声波：一步一级往上走 —— 积蕴、精进、到高潮。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    pts = [(0.192, 0.728)]
    for i in range(5):
        x = 0.192 + 0.104 + i * 0.122
        pts.append((x, 0.728 - i * 0.083))
        pts.append((x, 0.728 - (i + 1) * 0.083))
    line(d, pts, 0.052)
    dot(d, pts[-1][0], pts[-1][1], 0.056)
    return m


def v09():
    """唱针迸声：针臂斜落，针尖处迸出三道声纹（刻 → 声）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    line(d, [(0.765, 0.255), (0.545, 0.475)], 0.062)
    dot(d, 0.545, 0.475, 0.058)
    for i, r in enumerate((0.132, 0.206, 0.280)):
        line(d, arc_pts(0.545, 0.475, r, 118, 212), 0.046 - i * 0.008)
    return m


def v10():
    """声源出波：中心声源 + 外圈 + 右上三道渐散声弧（有方向、有层次）。"""
    m = new_mask(); d = ImageDraw.Draw(m)
    for i, r in enumerate((0.285, 0.338, 0.388)):
        line(d, arc_pts(0.50, 0.50, r, -74, -16), 0.046 - i * 0.008)
    ring(d, 0.50, 0.50, 0.222, 0.050)
    dot(d, 0.50, 0.50, 0.090)
    return m


def v11():
    """话筒头的均衡器：话筒头里立着三根音柱（话筒 = 正在发声的乐器）。"""
    m = new_mask()
    head = new_mask(); dot(ImageDraw.Draw(head), 0.50, 0.372, 0.178)
    slots = new_mask(); sd = ImageDraw.Draw(slots)
    for x, h in ((0.447, 0.130), (0.500, 0.196), (0.553, 0.104)):
        rrect(sd, x - 0.018, 0.372 - h / 2, x + 0.018, 0.372 + h / 2, 0.018)
    m = sub(head, slots)
    mic(ImageDraw.Draw(m), 0.50, 0.372, 0.0, 0.252, 0.815)
    return m


def v12():
    """负形盘：圆盘上把一道声波整条挖空（波从盘里透出底色）。"""
    disc = new_mask(); dot(ImageDraw.Draw(disc), 0.50, 0.50, 0.345)
    m = sub(disc, wave_mask(0.155, 0.845, 0.50, 0.092, 1.5, 0.060))
    return m


VARIANTS = [
    ("01 波杆话筒", "话筒的杆即声波", v01, ((23, 23, 27), (16, 16, 20)), (194, 163, 90)),
    ("02 头中有波", "话筒头挖出声波", v02, ((246, 245, 242), (231, 227, 218)), (27, 26, 24)),
    ("03 声波山岳", "三峰一座比一座高", v03, ((242, 236, 221), (228, 221, 205)), (42, 111, 142)),
    ("04 柱阵渐起", "成长到最高一柱", v04, ((22, 35, 61), (13, 21, 40)), (244, 239, 227)),
    ("05 话筒向上", "声朝上、朝理想", v05, ((23, 23, 27), (16, 16, 20)), (244, 239, 227)),
    ("06 话筒扩散", "声纹朝右叠出", v06, ((42, 111, 142), (28, 83, 110)), (244, 239, 227)),
    ("07 环中声波", "波穿过圆环", v07, ((23, 23, 27), (16, 16, 20)), (194, 163, 90)),
    ("08 阶梯声浪", "一步一级往上", v08, ((242, 236, 221), (227, 219, 201)), (27, 26, 24)),
    ("09 唱针迸声", "针尖迸出声纹", v09, ((23, 23, 27), (16, 16, 20)), (244, 239, 227)),
    ("10 声源出波", "声源 + 渐散声弧", v10, ((246, 245, 242), (230, 226, 217)), (30, 58, 95)),
    ("11 头内音柱", "话筒 = 发声体", v11, ((22, 35, 61), (13, 21, 40)), (194, 163, 90)),
    ("12 负形盘", "波从盘里透出", v12, ((246, 245, 242), (231, 227, 218)), (42, 111, 142)),
]


def bg_grad(c1, c2):
    t = np.linspace(0, 1, W)[None, :, None] * .5 + np.linspace(0, 1, W)[:, None, None] * .5
    a, b = np.array(c1, float), np.array(c2, float)
    return Image.fromarray(np.clip(a + (b - a) * t, 0, 255).astype(np.uint8), 'RGB')


def rounded(im, r):
    s = im.size[0]
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    out = im.convert('RGBA'); out.putalpha(m)
    return out


def far_radius(mask):
    a = np.array(mask.resize((256, 256), Image.LANCZOS)) > 96
    ys, xs = np.nonzero(a)
    if len(xs) == 0:
        return 0.0
    return float(np.max(np.hypot(xs / 255.0 - 0.5, ys / 255.0 - 0.5)))


def fit(mask, r):
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
print("maskable 安全自检（上限 %.3f）：" % SAFE)
for name, note, fn, bgc, fg in VARIANTS:
    m = fn()
    r0 = far_radius(m)
    m = fit(m, r0)
    print("  %-16s %.3f → %.3f %s" % (name, r0, far_radius(m), "🟢" if far_radius(m) <= SAFE else "❌"))
    im = bg_grad(bgc[0], bgc[1])
    im.paste(Image.new('RGB', (W, W), fg), (0, 0), m)
    im = im.resize((512, 512), Image.LANCZOS)
    im.save(os.path.join(BASE, "砺蕴图标_v15_" + name.replace(' ', '_') + ".png"))
    icons.append((name, note, im))

cell, pad, lh = 250, 26, 54
cols = 4; rows = (len(icons) + cols - 1) // cols
cv = Image.new('RGB', (cols * cell + (cols + 1) * pad, rows * (cell + lh) + (rows + 1) * pad), (238, 234, 226))
f1 = ImageFont.truetype(HEI, 19, index=0); f2 = ImageFont.truetype(HEI, 14, index=0)
dd = ImageDraw.Draw(cv)
for i, (name, note, im) in enumerate(icons):
    r0, c0 = divmod(i, cols)
    x = pad + c0 * (cell + pad); y = pad + r0 * (cell + lh + pad)
    rr = rounded(im.resize((cell, cell), Image.LANCZOS), int(cell * 0.224))
    cv.paste(rr, (x, y), rr)
    dd.text((x, y + cell + 8), name, fill=(54, 46, 38), font=f1)
    dd.text((x, y + cell + 31), note, fill=(126, 112, 94), font=f2)
cv.save(os.path.join(BASE, "砺蕴图标_v15_总览.png"))

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
sb.save(os.path.join(BASE, "砺蕴图标_v15_真机.png"))
print("ok")
