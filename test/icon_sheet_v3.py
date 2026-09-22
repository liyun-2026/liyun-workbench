#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3：只做「声浪山岳」这一招，4 套非金属配色。裁水印 + 2x2 总览（含真机小尺寸）。"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), '预览')
SRC = [
    ('1 珊瑚红·深炭', 'Flat_mobile_app_icon__square_1_2026-09-20T13-52-54.png'),
    ('2 青绿·海军蓝', 'Flat_mobile_app_icon__square_1_2026-09-20T13-53-11.png'),
    ('3 墨蓝·暖白',   'Flat_mobile_app_icon__square_1_2026-09-20T13-53-27.png'),
    ('4 暖橙·深紫',   'Flat_mobile_app_icon__square_1_2026-09-20T13-53-44.png'),
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
    im.save(os.path.join(OUT, f'图标_v3_{tag}.png'))
    cells.append((tag, im))

PAD, GAP, CW, IMG_H, LBL_H = 46, 24, 380, 320, 44
CELL_H = IMG_H + LBL_H
TITLE_H = 96
COLS, ROWS = 2, 2
W = PAD * 2 + COLS * CW + (COLS - 1) * GAP
H = TITLE_H + ROWS * CELL_H + (ROWS - 1) * GAP + 170 + PAD
cv = Image.new('RGB', (W, H), (247, 246, 243))
d = ImageDraw.Draw(cv)
d.text((PAD, 26), '砺蕴 · 声浪山岳 · 4 套非金属配色', font=font(32), fill=(34, 30, 26))
d.text((PAD, 66), '已弃用金环金属标。全部平面、纯色、无渐变。下排＝真机 120px 圆角方 / 56px',
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

cv.save(os.path.join(OUT, '图标_v3_总览.png'))
print('ok -> 预览/图标_v3_总览.png')
