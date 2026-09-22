# -*- coding: utf-8 -*-
"""砺蕴桌面图标 v13：声波 × 圆盘 × 字标 —— 八种真正不同的构图。

每版都围绕「声波」「圆盘」这两个用户点名的元素，但构图手法完全不同：
圆环字标 / 圆环单字 / 盘上单字 / 声波成圆 / 上下双波 / 竖排环抱 / 负形字 / 印章加波。
"""
import math, os
from PIL import Image, ImageDraw, ImageFont, ImageChops

BASE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/预览"
W = 512
C = W / 2.0
INK = (27, 26, 24)
IVORY = (244, 239, 227)
AZURITE = (42, 111, 142)
WARM_WHITE = (246, 245, 242)
GOLD = (184, 147, 47)

HEI = "/System/Library/Fonts/STHeiti Medium.ttc"
SONG = "/System/Library/Fonts/Supplemental/Songti.ttc"


def glyph_mask(text, font_path, size, gap=0, yshift=0, vertical=False):
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    f = ImageFont.truetype(font_path, size, index=0)
    if vertical:
        step = size * 0.94
        y0 = C + yshift - step * (len(text) - 1) / 2.0
        for i, ch in enumerate(text):
            d.text((C, y0 + i * step), ch, font=f, fill=255, anchor="mm")
    else:
        ws = [f.getbbox(ch)[2] - f.getbbox(ch)[0] for ch in text]
        total = sum(ws) + gap * (len(text) - 1)
        x = C - total / 2.0
        for ch, wch in zip(text, ws):
            d.text((x + wch / 2.0, C + yshift), ch, font=f, fill=255, anchor="mm")
            x += wch + gap
    return m


def paste_layer(im, mask, color):
    im.paste(Image.new('RGB', (W, W), color), (0, 0), mask)


def circle_mask(r, cx=C, cy=C, width=None):
    m = Image.new('L', (W, W), 0)
    box = [cx - r, cy - r, cx + r, cy + r]
    if width:
        ImageDraw.Draw(m).ellipse(box, outline=255, width=width)
    else:
        ImageDraw.Draw(m).ellipse(box, fill=255)
    return m


def wave(d, y, amp, x0, x1, periods, color, bottom=0, width=None):
    pts = []
    n = 200
    for i in range(n + 1):
        t = i / n
        pts.append((x0 + (x1 - x0) * t, y - amp * math.sin(2 * math.pi * periods * t)))
    w = width or int(W * 0.021)
    d.line(pts, fill=color, width=w, joint="curve")
    r = w / 2.0
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)
    return pts


def v1():
    """圆环字标：细圆环内横排「砺蕴」（校徽式）。"""
    im = Image.new('RGB', (W, W), INK)
    paste_layer(im, circle_mask(W * 0.355, width=int(W * 0.020)), IVORY)
    paste_layer(im, glyph_mask("砺蕴", HEI, 165, gap=-22), IVORY)
    return im


def v2():
    """圆环单字：细圆环内一个「砺」（宋体，印章气）。"""
    im = Image.new('RGB', (W, W), INK)
    paste_layer(im, circle_mask(W * 0.365, width=int(W * 0.020)), IVORY)
    paste_layer(im, glyph_mask("砺", SONG, 215), IVORY)
    return im


def v3():
    """盘上单字：实心圆盘上开一口负形，字反白，盘下一道金波。"""
    im = Image.new('RGB', (W, W), WARM_WHITE)
    d = ImageDraw.Draw(im)
    paste_layer(im, circle_mask(W * 0.335, cy=C - W * 0.045), INK)
    paste_layer(im, glyph_mask("砺", SONG, 190, yshift=-0.045 * W), WARM_WHITE)
    wave(d, W * 0.855, W * 0.030, W * 0.20, W * 0.80, 1.5, GOLD)
    return im


def v4():
    """声波成圆：一条声波沿着圆周走，圆本身就是波（盘与波合一）。"""
    im = Image.new('RGB', (W, W), WARM_WHITE)
    d = ImageDraw.Draw(im)
    R, amp = W * 0.330, W * 0.042
    pts = []
    for i in range(241):
        t = 2 * math.pi * i / 240
        r = R + amp * math.sin(6 * t)
        pts.append((C + r * math.cos(t), C + r * math.sin(t)))
    d.line(pts, fill=INK, width=int(W * 0.026), joint="curve")
    d.ellipse([C - W * 0.036, C - W * 0.036, C + W * 0.036, C + W * 0.036], fill=INK)
    return im


def v5():
    """上下双波：横排「砺蕴」，上方一道波、下方一道波夹住（声在字间）。"""
    im = Image.new('RGB', (W, W), AZURITE)
    d = ImageDraw.Draw(im)
    wave(d, W * 0.255, W * 0.030, W * 0.16, W * 0.84, 1.4, IVORY)
    paste_layer(im, glyph_mask("砺蕴", HEI, 185, gap=-26), IVORY)
    wave(d, W * 0.775, W * 0.030, W * 0.16, W * 0.84, 1.4, IVORY)
    return im


def v6():
    """竖排环抱：竖排「砺蕴」被一个圆环抱住。"""
    im = Image.new('RGB', (W, W), INK)
    paste_layer(im, circle_mask(W * 0.375, width=int(W * 0.018)), GOLD)
    paste_layer(im, glyph_mask("砺蕴", HEI, 150, vertical=True), IVORY)
    return im


def v7():
    """负形字：墨圆盘上把「砺」字挖空（负形），字从盘里透出底色。"""
    im = Image.new('RGB', (W, W), WARM_WHITE)
    disc = circle_mask(W * 0.360)
    inv = ImageChops.invert(glyph_mask("砺", SONG, 250))
    paste_layer(im, ImageChops.multiply(disc, inv), INK)
    return im


def v8():
    """印章加波：方形印章框 + 「砺」 + 框外一道声波。"""
    im = Image.new('RGB', (W, W), WARM_WHITE)
    d = ImageDraw.Draw(im)
    p = int(W * 0.145)
    d.rectangle([p, p, W - p, W - p], outline=INK, width=int(W * 0.020))
    paste_layer(im, glyph_mask("砺", SONG, 190, yshift=-0.02 * W), INK)
    wave(d, W * 0.855, W * 0.028, W * 0.30, W * 0.70, 1.2, GOLD, width=int(W * 0.019))
    return im


VARIANTS = [("1 圆环字标", "校徽式环内横排", v1),
            ("2 圆环单字", "环内一个砺字", v2),
            ("3 盘上单字", "圆盘 + 反白字", v3),
            ("4 声波成圆", "波沿着圆走", v4),
            ("5 上下双波", "波夹住字", v5),
            ("6 竖排环抱", "金环抱竖字", v6),
            ("7 负形字", "盘上挖空砺字", v7),
            ("8 印章加波", "方框 + 声波", v8)]

FONT = HEI


def rounded(im, r):
    s = im.size[0]
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(m)
    return out


icons = []
for name, note, fn in VARIANTS:
    im = fn()
    im.save(os.path.join(BASE, "砺蕴图标_v13_" + name.replace(' ', '_') + ".png"))
    icons.append((name, note, im))

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
cv.save(os.path.join(BASE, "砺蕴图标_v13_总览.png"))

sm, gap = 150, 40
sb = Image.new('RGB', (len(icons) * sm + (len(icons) + 1) * gap, sm + 62), (242, 236, 221))
sd = ImageDraw.Draw(sb)
for i, (name, note, im) in enumerate(icons):
    x = gap + i * (sm + gap)
    rr = rounded(im.resize((sm, sm), Image.LANCZOS), int(sm * 0.22))
    sb.paste(rr, (x, 8), rr)
    rt = rounded(im.resize((56, 56), Image.LANCZOS), 12)
    sb.paste(rt, (x + sm - 56, sm - 40), rt)
    sd.text((x + 2, sm + 18), name.replace(' ', ''), fill=(60, 50, 40), font=f2)
sb.save(os.path.join(BASE, "砺蕴图标_v13_真机.png"))
print("ok")
