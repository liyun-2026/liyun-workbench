# -*- coding: utf-8 -*-
"""砺蕴桌面图标 v12：字标深化 —— 让「砺蕴」两个字自己带上「磨」与「声」。

不是把字打上去就完事，而是对字形做几何处理：
  声波穿字（字被一道声波切开） / 磨角（负形咬掉一角） / 印章收边 / 竖排加金波。
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

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


def glyph_mask(text, font_path, size, gap=0, yshift=0, vertical=False, size_index=0):
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    f = ImageFont.truetype(font_path, size, index=size_index)
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


def paste_glyph(im, mask, color):
    im.paste(Image.new('RGB', (W, W), color), (0, 0), mask)


def wave_band(d, bg, y, amp, width, periods=1.6, x0=-0.06 * W, x1=1.06 * W):
    pts = []
    n = 200
    for i in range(n + 1):
        t = i / n
        pts.append((x0 + (x1 - x0) * t, y - amp * math.sin(2 * math.pi * periods * t)))
    d.line(pts, fill=bg, width=width, joint="curve")
    r = width / 2.0
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=bg)


def corner_bite(d, bg, r=0.46, cx=1.0, cy=-0.16):
    """右上角被一个大圆弧咬掉（负形）—— 石被磨掉的那一角。"""
    rr = W * r
    d.ellipse([W * cx - rr, W * cy - rr, W * cx + rr, W * cy + rr], fill=bg)


def seal_frame(d, color, pad=0.13, width=None):
    w = width or int(W * 0.018)
    p = int(W * pad)
    d.rectangle([p, p, W - p, W - p], outline=color, width=w)


VARIANTS = []


def v12_1():
    """墨底 · 声波穿字：一道声波把「砺蕴」从中间切开。"""
    im = Image.new('RGB', (W, W), INK)
    paste_glyph(im, glyph_mask("砺蕴", HEI, 210, gap=-30), IVORY)
    wave_band(ImageDraw.Draw(im), INK, C, 0.035 * W, int(W * 0.072))
    return im


def v12_2():
    """暖白底 · 磨角字标：墨宋体字的右上角被圆弧磨掉，底下压一道金声波。"""
    im = Image.new('RGB', (W, W), WARM_WHITE)
    d = ImageDraw.Draw(im)
    d.line([(W * 0.16, W * 0.80), (W * 0.84, W * 0.80)], fill=GOLD, width=int(W * 0.022))
    pts = []
    for i in range(121):
        t = i / 120.0
        pts.append((W * 0.16 + W * 0.68 * t, W * 0.80 - 0.05 * W * math.sin(2 * math.pi * 1.5 * t)))
    d.line(pts, fill=GOLD, width=int(W * 0.022), joint="curve")
    paste_glyph(im, glyph_mask("砺蕴", SONG, 205, gap=-28, yshift=-0.045 * W), INK)
    corner_bite(d, WARM_WHITE, r=0.34, cx=1.06, cy=-0.20)
    return im


def v12_3():
    """石青底 · 印章字标：「砺」加白细框，右上磨角。"""
    im = Image.new('RGB', (W, W), AZURITE)
    d = ImageDraw.Draw(im)
    seal_frame(d, IVORY, pad=0.115, width=int(W * 0.020))
    paste_glyph(im, glyph_mask("砺", SONG, 235), IVORY)
    corner_bite(d, AZURITE, r=0.30, cx=1.10, cy=-0.22)
    return im


def v12_4():
    """墨底 · 竖排字标：砺蕴两字上下排，底下托一道金声波。"""
    im = Image.new('RGB', (W, W), INK)
    d = ImageDraw.Draw(im)
    paste_glyph(im, glyph_mask("砺蕴", HEI, 175, vertical=True, yshift=-0.045 * W), IVORY)
    pts = []
    for i in range(121):
        t = i / 120.0
        pts.append((W * 0.20 + W * 0.60 * t, W * 0.845 - 0.038 * W * math.sin(2 * math.pi * 1.5 * t)))
    d.line(pts, fill=GOLD, width=int(W * 0.021), joint="curve")
    return im


VARIANTS = [("1 声波穿字", "声波切开字", v12_1),
            ("2 磨角字标", "字被磨掉一角", v12_2),
            ("3 印章字标", "方框收边", v12_3),
            ("4 竖排字标", "上下排 + 金波", v12_4)]

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
    im.save(os.path.join(BASE, "砺蕴图标_v12_" + name.replace(' ', '_') + ".png"))
    icons.append((name, note, im))

cell, pad, lh = 300, 30, 62
cols, rows = 4, 1
OW = cols * cell + (cols + 1) * pad
OH = rows * (cell + lh) + (rows + 1) * pad
cv = Image.new('RGB', (OW, OH), (242, 236, 221))
f1 = ImageFont.truetype(FONT, 22, index=0)
f2 = ImageFont.truetype(FONT, 17, index=0)
dd = ImageDraw.Draw(cv)
for i, (name, note, im) in enumerate(icons):
    x = pad + i * (cell + pad)
    y = pad
    rr = rounded(im.resize((cell, cell), Image.LANCZOS), int(cell * 0.22))
    cv.paste(rr, (x, y), rr)
    dd.text((x, y + cell + 10), name, fill=(60, 50, 40), font=f1)
    dd.text((x, y + cell + 36), note, fill=(120, 106, 88), font=f2)
cv.save(os.path.join(BASE, "砺蕴图标_v12_总览.png"))
print("ok")
