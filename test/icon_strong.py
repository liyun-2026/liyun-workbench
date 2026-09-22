# -*- coding: utf-8 -*-
"""砺蕴桌面图标 v11：按「成熟 App 图标」的公式重做 —— 强品牌色底 + 单色符号。

参考抖音 / 微信 / 小红书 / 腾讯视频 的共同做法：
  满幅品牌色（可深可浅） + 一个白色（或墨色）符号 + 圆角方。
两种路子并列：图形标（几何符号）与字标（砺 / 砺蕴 字形 + 磨角处理）。
"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/预览"
W = 512
C = W / 2.0
S = 184.0 / 50.0
LW = int(round(5 * S))

INK = (27, 26, 24)
IVORY = (244, 239, 227)
AZURITE = (42, 111, 142)
INDIGO = (31, 58, 110)
WARM_WHITE = (246, 245, 242)
GOLD = (184, 147, 47)

HEI = "/System/Library/Fonts/STHeiti Medium.ttc"
SONG = "/System/Library/Fonts/Supplemental/Songti.ttc"


def P(x, y):
    return (C + x * S, C + y * S)


def thick_line(d, p1, p2, w=LW, fill=IVORY):
    d.line([p1, p2], fill=fill, width=w)
    r = w / 2.0
    for p in (p1, p2):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=fill)


def poly_line(d, pts, w=LW, fill=IVORY):
    for a, b in zip(pts, pts[1:]):
        thick_line(d, a, b, w, fill)


def arc(d, cx, cy, r, a0, a1, w=LW, fill=IVORY):
    import math
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
    import math
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(P(x0 + (x1 - x0) * t, y0 - amp * math.sin(2 * math.pi * periods * t)))
    return out


def tile(color):
    im = Image.new('RGB', (W, W), color)
    return im, ImageDraw.Draw(im)


def corner_cut(d, bg, frac=0.26):
    """把右上角斜切掉一块 —— 「砺」：被磨掉的那一角。"""
    d.polygon([(W * (1 - frac), 0), (W, 0), (W, W * frac)], fill=bg)


def mark_strata(d, col):
    for y, half in ((34, 44), (16, 36), (-2, 28), (-20, 20)):
        thick_line(d, P(-half, y), P(half, y), fill=col)
    d.line(sine_pts(-42, 42, -42, 14, 1.5), fill=col, width=LW, joint="curve")


def mark_rough_smooth(d, col):
    poly_line(d, [P(-46, 4), P(-34, -14), P(-22, 20), P(-10, -8), P(0, 10)], fill=col)
    pts = []
    for i in range(61):
        t = i / 60.0
        if t <= 0.5:
            u = t * 2
            bx = 3 * (1 - u) ** 2 * u * 8 + 3 * (1 - u) * u * u * 14 + u ** 3 * 22
            by = (1 - u) ** 3 * 10 + 3 * (1 - u) ** 2 * u * 2 + 3 * (1 - u) * u * u * -12 + u ** 3 * -6
        else:
            u = (t - 0.5) * 2
            bx = (1 - u) ** 3 * 22 + 3 * (1 - u) ** 2 * u * 30 + 3 * (1 - u) * u * u * 36 + u ** 3 * 46
            by = (1 - u) ** 3 * -6 + 3 * (1 - u) * u * u * 10 + u ** 3 * -2
        pts.append(P(bx, by))
    poly_line(d, pts, fill=col)


def mark_square_circle(d, col, bg):
    d.rectangle([P(-38, -38), P(38, 38)], fill=col)
    rr = 23 * S
    d.ellipse([C - rr, C - rr, C + rr, C + rr], fill=bg)
    d.line(sine_pts(-15, 15, 0, 9, 1.0), fill=col, width=int(LW * 0.75), joint="curve")


def mark_dotwave(d, col):
    import math
    for i in range(13):
        t = math.pi * i / 6.0
        px, py = P(-44 + (88.0 / 12) * i, -24 * math.sin(t))
        rr = (2 + 3 * abs(math.sin(t))) * S
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=col)


def draw_chars(d, text, font_path, size, fill, gap, y=0.0):
    """逐字排版，手动控制字距（中文字标要收紧才精神）。"""
    f = ImageFont.truetype(font_path, size, index=0)
    widths = [f.getbbox(ch)[2] - f.getbbox(ch)[0] for ch in text]
    total = sum(widths) + gap * (len(text) - 1)
    x = C - total / 2.0
    for ch, wch in zip(text, widths):
        d.text((x + wch / 2.0, C + y), ch, font=f, fill=fill, anchor="mm")
        x += wch + gap
    return f


MARKS = []


def add(short, name, note, fn):
    MARKS.append((short, name, note, fn))


add("1", "墨底·折变曲", "由糙到顺", lambda d, bg: mark_rough_smooth(d, IVORY))
add("2", "石青底·方圆", "石中藏声", lambda d, bg: mark_square_circle(d, IVORY, bg))
add("3", "靛蓝底·点阵波", "点滴成声", lambda d, bg: mark_dotwave(d, IVORY))
add("4", "暖白底·沉积层", "层层积累", lambda d, bg: mark_strata(d, INK))
add("5", "石青底·沉积层", "层层积累", lambda d, bg: mark_strata(d, IVORY))
add("6", "墨底·砺蕴字标", "字标 + 磨角", lambda d, bg: (draw_chars(d, "砺蕴", HEI, 200, IVORY, -26), corner_cut(d, bg)))
add("7", "石青底·砺单字", "方章 + 磨角", lambda d, bg: (draw_chars(d, "砺", SONG, 250, IVORY, 0), corner_cut(d, bg, 0.22)))
add("8", "暖白底·砺蕴字标", "宋体 + 金声波", lambda d, bg: (draw_chars(d, "砺蕴", SONG, 200, INK, -26, -8),
                                                     d.line(sine_pts(-38, 38, 40, 9, 1.5), fill=GOLD, width=int(LW * 0.7), joint="curve")))

FONT = HEI


def rounded(im, r):
    s = im.size[0]
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(m)
    return out


tiles = {"1": INK, "2": AZURITE, "3": INDIGO, "4": WARM_WHITE,
         "5": AZURITE, "6": INK, "7": AZURITE, "8": WARM_WHITE}

icons = []
for short, name, note, fn in MARKS:
    bg = tiles[short]
    im, d = tile(bg)
    fn(d, bg)
    im.save(os.path.join(BASE, "砺蕴图标_v11_" + short + "_" + name.split('·')[1] + ".png"))
    icons.append((short + " " + name, note, im))

cell, pad, lh = 300, 30, 62
cols, rows = 4, 2
OW = cols * cell + (cols + 1) * pad
OH = rows * (cell + lh) + (rows + 1) * pad
cv = Image.new('RGB', (OW, OH), (242, 236, 221))
f1 = ImageFont.truetype(FONT, 22, index=0)
f2 = ImageFont.truetype(FONT, 17, index=0)
dd = ImageDraw.Draw(cv)
for i, (name, note, im) in enumerate(icons):
    r, cI = divmod(i, cols)
    x = pad + cI * (cell + pad)
    y = pad + r * (cell + lh + pad)
    rr = rounded(im.resize((cell, cell), Image.LANCZOS), int(cell * 0.22))
    cv.paste(rr, (x, y), rr)
    dd.text((x, y + cell + 10), name, fill=(60, 50, 40), font=f1)
    dd.text((x, y + cell + 36), note, fill=(120, 106, 88), font=f2)
cv.save(os.path.join(BASE, "砺蕴图标_v11_总览.png"))

sm, gap = 150, 40
sb = Image.new('RGB', (len(icons) * sm + (len(icons) + 1) * gap, sm + 62), (242, 236, 221))
sd = ImageDraw.Draw(sb)
for i, (name, note, im) in enumerate(icons):
    x = gap + i * (sm + gap)
    rr = rounded(im.resize((sm, sm), Image.LANCZOS), int(sm * 0.22))
    sb.paste(rr, (x, 8), rr)
    rt = rounded(im.resize((56, 56), Image.LANCZOS), 12)
    sb.paste(rt, (x + sm - 56, sm - 40), rt)
    sd.text((x + 2, sm + 18), name.split('·')[0].strip() + " " + name.split('·')[1].strip(), fill=(60, 50, 40), font=f2)
sb.save(os.path.join(BASE, "砺蕴图标_v11_真机.png"))
print("ok")
