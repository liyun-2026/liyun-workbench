#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 桌面图标 —— 四强候选大图对比（复用 icon_mark2 的材质与合成）。"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import icon_mark2 as K
from PIL import Image, ImageDraw, ImageFont

FINALISTS = [
    ('线上现款 · 三柱填充', '米白柱压在金盘上（基准）', K.v01, False),
    ('三柱 · 刻痕',        '柱从金盘挖出，对比更强',   K.v01, True),
    ('单字「声」· 刻痕',    '播音的本命字，笔画少更清楚', K.v09, True),
    ('单字「砺」· 刻痕',    '中文最强的识别资产',      K.v11, True),
]

BIG = 330
cw = 400
pad = 48
W = pad * 2 + cw * len(FINALISTS)
H = 120 + BIG + 150 + 130
cv = Image.new('RGB', (W, H), (231, 227, 220))
d = ImageDraw.Draw(cv)
zh = K.ZH
f = ImageFont.truetype(zh, 36)
ft = ImageFont.truetype(zh, 25)
fs = ImageFont.truetype(zh, 18)

d.text((pad, 34), '砺蕴 · 桌面图标 · 四强候选（同一套材质：深咖底 · 金盘 · 圆头符号）',
       font=f, fill=(34, 31, 27))
d.text((pad, 88), '上排为 App 里的真实形状；下排为桌面真机尺寸 120 / 76 / 60 / 44px。',
       font=fs, fill=(114, 107, 98))

for i, (name, note, fn, cut) in enumerate(FINALISTS):
    x = pad + i * cw
    y = 132
    big, rad = K.compose(BIG, fn, cut, rounded=True)
    cv.paste(big, (x + (cw - BIG) // 2, y), big)
    d.text((x, y + BIG + 18), name, font=ft, fill=(34, 31, 27))
    d.text((x, y + BIG + 54), note, font=fs, fill=(104, 98, 90))
    ok = rad <= K.SAFE
    d.text((x, y + BIG + 82), f'最远半径 {rad:.3f} / 上限 {K.SAFE:.3f} ' + ('OK' if ok else '超标'),
           font=fs, fill=(70, 100, 70) if ok else (168, 58, 58))

    yy = y + BIG + 118
    xx = x
    for px in (120, 76, 60, 44):
        im, _ = K.compose(px, fn, cut, rounded=True)
        cv.paste(im, (xx, yy + (120 - px) // 2), im)
        xx += px + 14

p = os.path.join(K.REVIEW, '砺蕴图标_v17_四强.png')
cv.save(p)
print(p)
