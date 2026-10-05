# -*- coding: utf-8 -*-
"""拼出 previews/07_空态插图集.png。

输入（先按截图配方产出）：
    /tmp/illu_light.png  ← empty-states.html          1440x3000 @2x
    /tmp/illu_dark.png   ← empty-states.html#dark      1440x3000 @2x
输出：
    previews/07_空态插图集.png           左「浅色态」栏 + 右「深色态」栏 + 卡片效果（一张看全）
    previews/07b_空态插图集_深色页面.png  #dark 整页（佐证深色 chrome）
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/docs/redesign-2026-10"
PREV = os.path.join(ROOT, "previews")
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"   # PingFang.ttc 会 OSError
BG = (238, 235, 228)
INK = (30, 28, 24)

L = Image.open("/tmp/illu_light.png").convert("RGB")
D = Image.open("/tmp/illu_dark.png").convert("RGB")

# ── 用块平均找到「深色态」栏的包围盒（页面里唯一的大片暗区）───────────────
g = np.asarray(L.convert("L"), dtype=np.uint8)
B = 24
h, w = g.shape
gh, gw = h // B, w // B
blocks = g[:gh * B, :gw * B].reshape(gh, B, gw, B).mean(axis=(1, 3))
dark = blocks < 100
rows = dark.sum(axis=1)
ys = np.where(rows > 30)[0]
dy0, dy1 = int(ys.min()) * B, int(ys.max()) * B + B
sub = dark[ys.min():ys.max() + 1]
cols = sub.sum(axis=0)
xs = np.where(cols > 4)[0]
dx0, dx1 = int(xs.min()) * B, int(xs.max()) * B + B
print("dark pane bbox", dx0, dy0, dx1, dy1)

lx0, lx1 = 60, dx0 - 44                       # 浅色栏按布局推算
light = L.crop((lx0, dy0, lx1, dy1))
dplace = L.crop((dx0, dy0, dx1, dy1))
print("light pane", light.size, "dark pane", dplace.size)

# ── 页面底部裁掉多余留白 ─────────────────────────────────────────────────
gA = np.asarray(L.convert("RGB"), dtype=np.int16)
bg = np.array([246, 245, 242])
diff = np.abs(gA - bg).sum(axis=2) > 12
last = int(np.where(diff.any(axis=1))[0].max())
card = L.crop((40, dy1 + 10, 2840, min(last + 30, L.height)))
print("cards strip", card.size)


def band(text, w, hh, size, fg, bgc, pad=56):
    im = Image.new("RGB", (w, hh), bgc)
    d = ImageDraw.Draw(im)
    d.text((pad, hh // 2), text, font=ImageFont.truetype(FONT, size), fill=fg, anchor="lm")
    return im


W = 2880
title = band("砺蕴教务系统 · 空态线描插图集", W, 132, 54, INK, BG)
sub = band("单线白描 1.5px　·　全部 fill=none　·　每张仅一处金 #C9AB7C　·　深浅同源（CSS 变量）　·　7 空态 + 1 进度环 + 1 章节分隔",
           W, 72, 32, (110, 104, 92), BG)
capcards = None
GAPX = 44
H = title.height + sub.height + 22 + light.height + 26 + card.height
sheet = Image.new("RGB", (W, H), BG)
y = 0
sheet.paste(title, (0, y)); y += title.height
sheet.paste(sub, (0, y)); y += sub.height + 22
sheet.paste(light, (60, y))
sheet.paste(dplace, (60 + light.width + GAPX, y))
y += light.height + 26
sheet.paste(card, (40, y)); y += card.height
os.makedirs(PREV, exist_ok=True)
sheet.save(os.path.join(PREV, "07_空态插图集.png"))
print("sheet", sheet.size)

# 深色 chrome 整页（裁掉底部留白）
gD = np.asarray(D.convert("RGB"), dtype=np.int16)
bdark = np.array([30, 28, 24])
diffd = np.abs(gD - bdark).sum(axis=2) > 12
lastd = int(np.where(diffd.any(axis=1))[0].max())
D.crop((0, 0, D.width, min(lastd + 40, D.height))).save(
    os.path.join(PREV, "07b_空态插图集_深色页面.png"))
print("dark page saved")
