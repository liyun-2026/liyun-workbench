# -*- coding: utf-8 -*-
"""砺蕴桌面图标 v10：八个「几何构成」方案。

与之前几版的区别：不再画具象实物（唱片、浪、山），而是画**符号**——
负形 / 层叠 / 一笔连续 / 方圆 / 疏密 / 点阵 / 折转曲 / 弧扇。
几何构成可以画准，所以这里用 PIL 精确渲染，不靠生成模型。
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

BASE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/预览"
W = 512
INK = (27, 26, 24)
GOLD = (184, 147, 47)
TILE = (246, 245, 242)
C = W / 2.0
S = 184.0 / 50.0          # 设计坐标 ±50 -> 半径 184（maskable 安全圆 0.40*W = 205）
LW = int(round(5 * S))    # 线宽 ≈ 18

FONT = "/System/Library/Fonts/STHeiti Medium.ttc"


def P(x, y):
    return (C + x * S, C + y * S)


def thick_line(d, p1, p2, w=LW, fill=INK):
    """粗线段：直线 + 两端圆头（避免端点平切）。"""
    d.line([p1, p2], fill=fill, width=w)
    r = w / 2.0
    for p in (p1, p2):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=fill)


def poly_line(d, pts, w=LW, fill=INK):
    for a, b in zip(pts, pts[1:]):
        thick_line(d, a, b, w, fill)


def arc(d, cx, cy, r, a0, a1, w=LW, fill=INK):
    """画圆弧，端点补圆头。角度制，0°=3 点钟，顺时针为正。"""
    rr = r * S
    box = [C + cx * S - rr, C + cy * S - rr, C + cx * S + rr, C + cy * S + rr]
    d.arc(box, a0, a1, fill=fill, width=w)
    hw = w / 2.0
    for a in (a0, a1):
        t = math.radians(a)
        px = C + cx * S + rr * math.cos(t)
        py = C + cy * S + rr * math.sin(t)
        d.ellipse([px - hw, py - hw, px + hw, py + hw], fill=fill)


def sine_pts(x0, x1, y0, amp, periods, n=160):
    pts = []
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        y = y0 - amp * math.sin(2 * math.pi * periods * t)
        pts.append(P(x, y))
    return pts


# ───────────────────────── 八个方案 ─────────────────────────
def m1_grindcorner(d):
    """磨角方 · 砺：方形被一道圆弧磨掉一角（负形）。"""
    d.polygon([P(-50, 50), P(-50, -50), P(0, -50), P(46, -4), P(46, 50)], fill=INK)
    cut = [P(0, -50), P(50, -50)]
    for i in range(37):
        t = math.radians(-i * 2.5)          # 0° -> -90°
        cut.append(P(46 * math.cos(t), -4 + 46 * math.sin(t)))
    d.polygon(cut, fill=TILE)


def m2_strata(d):
    """沉积层 · 积：层层压实，顶上那道是声波。"""
    for y, half in ((34, 44), (16, 36), (-2, 28), (-20, 20)):
        thick_line(d, P(-half, y), P(half, y))
    d.line(sine_pts(-42, 42, -42, 14, 1.5), fill=INK, width=LW, joint="curve")


def m3_spiral(d):
    """一笔螺旋 · 积：一条连续线由外向内收，日复一日。"""
    arc(d, 0, 0, 30, 0, 180)
    arc(d, -6, 0, 24, 180, 360)
    arc(d, -1, 0, 19, 0, 180)
    arc(d, -5, 0, 15, 180, 360)
    arc(d, -2, 0, 12, 0, 180)
    r = LW / 2.0
    px, py = P(-14, 0)
    d.ellipse([px - r, py - r, px + r, py + r], fill=INK)


def m4_square_circle(d):
    """方圆 · 蕴：石（方）中藏声（圆），圆内负形里一道声波。"""
    d.rectangle([P(-46, -46), P(46, 46)], fill=INK)
    rr = 28 * S
    d.ellipse([C - rr, C - rr, C + rr, C + rr], fill=TILE)
    pts = sine_pts(-18, 18, 0, 11, 1.0)
    d.line(pts, fill=INK, width=int(LW * 0.8), joint="curve")


def m5_density(d):
    """疏密线 · 练：间距由疏到密 —— 打磨是「越磨越密」，不是越磨越细。"""
    spec = [(-26, 34), (-16, 22), (-7, 30), (1, 40), (8, 44),
            (14, 36), (19, 26), (23, 18), (26, 14)]
    for x, h in spec:
        thick_line(d, P(x, -h), P(x, h))


def m6_dotwave(d):
    """点阵波 · 蕴：点点聚成一道声波，点随振幅呼吸。"""
    for i in range(13):
        t = math.pi * i / 6.0
        x = -44 + (88.0 / 12) * i
        y = -24 * math.sin(t)
        r = 2 + 3 * abs(math.sin(t))
        px, py = P(x, y)
        rr = r * S
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=GOLD)


def m7_rough_to_smooth(d):
    """折变曲 · 练：左端粗粝的折线，一路被磨成右端平滑的曲线。"""
    zig = [P(-46, 4), P(-34, -14), P(-22, 20), P(-10, -8), P(0, 10)]
    poly_line(d, zig)
    pts = []
    for i in range(61):
        t = i / 60.0
        # 两段三次贝塞尔，从 (0,10) 平滑过渡到 (46,-2)
        if t <= 0.5:
            u = t * 2
            bx = (1 - u) ** 3 * 0 + 3 * (1 - u) ** 2 * u * 8 + 3 * (1 - u) * u * u * 14 + u ** 3 * 22
            by = (1 - u) ** 3 * 10 + 3 * (1 - u) ** 2 * u * 2 + 3 * (1 - u) * u * u * -12 + u ** 3 * -6
        else:
            u = (t - 0.5) * 2
            bx = (1 - u) ** 3 * 22 + 3 * (1 - u) ** 2 * u * 30 + 3 * (1 - u) * u * u * 36 + u ** 3 * 46
            by = (1 - u) ** 3 * -6 + 3 * (1 - u) ** 2 * u * 0 + 3 * (1 - u) * u * u * 10 + u ** 3 * -2
        pts.append(P(bx, by))
    poly_line(d, pts)


def m8_arcfan(d):
    """声纹扇 · 逐：三道同心弧向右扩散，声音一路向外。"""
    ox = -28
    arc(d, ox, 0, 44, -50, 50)
    arc(d, ox, 0, 32, -35, 35)
    arc(d, ox, 0, 20, -20, 20)


MARKS = [
    ("1 磨角方 · 砺", "1_磨角方", m1_grindcorner),
    ("2 沉积层 · 积", "2_沉积层", m2_strata),
    ("3 一笔螺旋 · 积", "3_一笔螺旋", m3_spiral),
    ("4 方圆 · 蕴", "4_方圆", m4_square_circle),
    ("5 疏密线 · 练", "5_疏密线", m5_density),
    ("6 点阵波 · 蕴", "6_点阵波", m6_dotwave),
    ("7 折变曲 · 练", "7_折变曲", m7_rough_to_smooth),
    ("8 声纹扇 · 逐", "8_声纹扇", m8_arcfan),
]


def rounded(im, r):
    s = im.size[0]
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(m)
    return out


icons = []
for name, short, fn in MARKS:
    im = Image.new('RGB', (W, W), TILE)
    fn(ImageDraw.Draw(im))
    im.save(os.path.join(BASE, "砺蕴图标_v10_" + short + ".png"))
    icons.append((name, short, im))

# 总览 4×2
cell, pad, lh = 300, 30, 62
cols, rows = 4, 2
OW = cols * cell + (cols + 1) * pad
OH = rows * (cell + lh) + (rows + 1) * pad
cv = Image.new('RGB', (OW, OH), (242, 236, 221))
f1 = ImageFont.truetype(FONT, 22, index=0)
f2 = ImageFont.truetype(FONT, 17, index=0)
dd = ImageDraw.Draw(cv)
notes = ["磨掉一角是「砺」", "层层压实是「积」", "一笔向内是「积」", "石中藏声是「蕴」",
         "由疏到密才叫磨", "点滴聚成一道声", "由糙到顺是打磨", "声音一路向外去"]
for i, (name, short, im) in enumerate(icons):
    r, cI = divmod(i, cols)
    x = pad + cI * (cell + pad)
    y = pad + r * (cell + lh + pad)
    cv.paste(im.resize((cell, cell), Image.LANCZOS), (x, y))
    dd.text((x, y + cell + 10), name, fill=(60, 50, 40), font=f1)
    dd.text((x, y + cell + 36), notes[i], fill=(120, 106, 88), font=f2)
cv.save(os.path.join(BASE, "砺蕴图标_v10_总览.png"))

# 真机：120 圆角方 + 56
sm, gap = 150, 40
sb = Image.new('RGB', (len(icons) * sm + (len(icons) + 1) * gap, sm + 76), (242, 236, 221))
sd = ImageDraw.Draw(sb)
for i, (name, short, im) in enumerate(icons):
    x = gap + i * (sm + gap)
    rr = rounded(im.resize((sm, sm), Image.LANCZOS), int(sm * 0.22))
    sb.paste(rr, (x, 8), rr)
    rt = rounded(im.resize((56, 56), Image.LANCZOS), 12)
    sb.paste(rt, (x + sm - 56, sm - 40), rt)
    sd.text((x + 2, sm + 24), name, fill=(60, 50, 40), font=f2)
sb.save(os.path.join(BASE, "砺蕴图标_v10_真机.png"))
print("ok")
