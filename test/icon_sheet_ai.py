#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 AI 生成的概念图标整理成一张总览图：
   上排 = 大图（看一眼气质）；下排 = 真机尺寸（120 圆角方 / 56 原样），
   一眼看出谁在手机桌面上立得住。顺手裁掉右下角水印。
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), '预览')
SRC = [
    ('01_鸣禽',     'Mobile_app_icon__square_1024x1_2026-09-20T13-43-08.png'),
    ('02_麦克风',   'Mobile_app_icon__square_1024x1_2026-09-20T13-43-39.png'),
    ('03_金声波',   'Mobile_app_icon__square_1024x1_2026-09-20T13-43-41.png'),
    ('04_舞台',     'Mobile_app_icon__square_1024x1_2026-09-20T13-43-42.png'),
    ('05_3D喇叭',   'Mobile_app_icon__square_1024x1_2026-09-20T13-43-37.png'),
    ('06_金环',     'Mobile_app_icon__square_1024x1_2026-09-20T13-43-44.png'),
]
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'

def font(sz):
    return ImageFont.truetype(FONT, sz)

def clean(p):
    """裁掉四边一圈（右下角 AI 水印所在），保留正中主体。"""
    im = Image.open(p).convert('RGB')
    W, H = im.size
    m = int(W * 0.085)          # 四边各裁 8.5%（水印在右下角，裁掉即可）
    return im.crop((m, 0, W - m, H - m * 1.15))

def rounded(im, size, rad=0.224):
    im = im.resize((size, size), Image.LANCZOS).convert('RGBA')
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * rad), fill=255)
    im.putalpha(m)
    return im

cells = []
for tag, fn in SRC:
    p = os.path.join(OUT, fn)
    im = clean(p)
    im.save(os.path.join(OUT, f'图标概念_{tag}.png'))
    cells.append((tag, im))

# ── 版面 ──
PAD, GAP = 46, 22
COLS = 3
CW = 372                      # 单元格宽
IMG_H = 300                   # 大图区高
LBL_H = 40
CELL_H = IMG_H + LBL_H
TITLE_H = 128
STRIP_H = 210                 # 真机尺寸条
W = PAD * 2 + COLS * CW + (COLS - 1) * GAP
ROWS = 2
H = TITLE_H + ROWS * CELL_H + (ROWS - 1) * GAP + STRIP_H + PAD
cv = Image.new('RGB', (W, H), (247, 246, 243))
d = ImageDraw.Draw(cv)

d.text((PAD, 34), '砺蕴 · 桌面图标 · 概念探索（AI 直出）', font=font(34), fill=(34, 30, 26))
d.text((PAD, 80), '麦克风 / 鸣禽 / 声波 / 舞台 / 3D喇叭 / 金环 —— 六条完全不同的路，不再围着「石头」转',
       font=font(19), fill=(122, 112, 100))

for i, (tag, im) in enumerate(cells):
    r, c = divmod(i, COLS)
    x = PAD + c * (CW + GAP)
    y = TITLE_H + r * (CELL_H + GAP)
    # 底色取四角均值，让大图融进单元格
    px = im.resize((1, 1), Image.LANCZOS).getpixel((0, 0))
    d.rounded_rectangle([x, y, x + CW, y + IMG_H], radius=16, fill=px)
    th = im.copy()
    th.thumbnail((CW - 24, IMG_H - 24), Image.LANCZOS)
    cv.paste(th, (x + (CW - th.width) // 2, y + (IMG_H - th.height) // 2))
    d.text((x + 4, y + IMG_H + 8), tag, font=font(22), fill=(40, 36, 30))

# ── 真机尺寸条 ──
sy = TITLE_H + ROWS * CELL_H + (ROWS - 1) * GAP + 24
d.text((PAD, sy - 34), '真机尺寸（左 120px 圆角方 · 右 56px）—— 缩到桌面还认得出，才叫图标',
       font=font(19), fill=(122, 112, 100))
BIG, SMALL, SGAP = 104, 46, 44
bx = PAD
for tag, im in cells:
    cv.paste(rounded(im, BIG), (bx, sy + 24), rounded(im, BIG))
    sm = rounded(im, SMALL)
    cv.paste(sm, (bx + BIG + 12, sy + 24 + (BIG - SMALL) // 2), sm)
    bx += BIG + 12 + SMALL + SGAP

cv.save(os.path.join(OUT, '图标概念_总览.png'))
print('总览图已出：预览/图标概念_总览.png')
print('单图已另存：图标概念_01..06_*.png')
