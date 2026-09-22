#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v5：回到 03金声波+06金环 组合，扁平哑光金，金×白 / 金×黑，高级淡雅。裁水印+2x2+真机。"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), '预览')
SRC = [
    ('A 金线·白底', 'Flat_minimal_mobile_app_icon___2026-09-20T14-01-06.png'),
    ('B 金线·黑底', 'Flat_minimal_mobile_app_icon___2026-09-20T14-01-33.png'),
    ('C 金线·暖白', 'Flat_minimal_mobile_app_icon___2026-09-20T14-01-55.png'),
    ('D 黑底·共鸣弧', 'Flat_minimal_mobile_app_icon___2026-09-20T14-02-13.png'),
]
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'

def font(sz):
    return ImageFont.truetype(FONT, sz)

def clean(fn):
    im = Image.open(os.path.join(OUT, fn)).convert('RGB')
    W, H = im.size
    m = int(W * 0.085)
    return im.crop((m, 0, W - m, H - m * 1.15))

def rounded(im, size, rad=0.224):
    im = im.resize((size, size), Image.LANCZOS).convert('RGBA')
    mk = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mk).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * rad), fill=255)
    im.putalpha(mk)
    return im

cells = []
for tag, fn in SRC:
    im = clean(fn)
    im.save(os.path.join(OUT, f'图标_v5_{tag}.png'))
    cells.append((tag, im))

PAD, GAP, CW, IMG_H, LBL_H = 46, 24, 380, 320, 44
CELL_H = IMG_H + LBL_H
TITLE_H = 96
COLS, ROWS = 2, 2
W = PAD * 2 + COLS * CW + (COLS - 1) * GAP
H = TITLE_H + ROWS * CELL_H + (ROWS - 1) * GAP + 170 + PAD
cv = Image.new('RGB', (W, H), (247, 246, 243))
d = ImageDraw.Draw(cv)
d.text((PAD, 26), '砺蕴 · 03金声波×06金环 · 扁平哑光金', font=font(32), fill=(34, 30, 26))
d.text((PAD, 66), '回到你最初想要的组合：金环里放金浪。扁平哑光金，无渐变无立体。金×白 / 金×黑。下排＝真机 120/56px',
       font=font(18), fill=(122, 112, 100))

for i, (tag, im) in enumerate(cells):
    r, c = divmod(i, COLS)
    x = PAD + c * (CW + GAP)
    y = TITLE_H + r * (CELL_H + GAP)
    px = im.resize((1, 1), Image.LANCZOS).getpixel((0, 0))
    d.rounded_rectangle([x, y, x + CW, y + IMG_H], radius=16, fill=px)
    th = im.copy(); th.thumbnail((CW - 24, IMG_H - 24), Image.LANCZOS)
    cv.paste(th, (x + (CW - th.width) // 2, y + (IMG_H - th.height) // 2))
    d.text((x + 4, y + IMG_H + 8), tag, font=font(22), fill=(40, 36, 30))

sy = TITLE_H + ROWS * CELL_H + (ROWS - 1) * GAP + 24
d.text((PAD, sy - 30), '真机尺寸', font=font(18), fill=(122, 112, 100))
BIG, SMALL, SGAP = 104, 46, 52
bx = PAD
for tag, im in cells:
    cv.paste(rounded(im, BIG), (bx, sy + 18), rounded(im, BIG))
    sm = rounded(im, SMALL)
    cv.paste(sm, (bx + BIG + 12, sy + 18 + (BIG - SMALL) // 2), sm)
    bx += BIG + 12 + SMALL + SGAP

cv.save(os.path.join(OUT, '图标_v5_总览.png'))
print('ok -> 预览/图标_v5_总览.png')
