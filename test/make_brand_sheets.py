#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 test/.shots/brand/ 里的门头实拍拼成交付图（给用户挑/存档用）：

  电脑端_A_竖式门头.png      1440×900 四格：登录页浅/深 + 工作台浅/深
  手机端_A_竖式门头.png      390×844  四格：同上
  门头四个字对中核对.png      手机与电脑各一条，画中轴虚线 + 墨迹左右边

  python3 test/make_brand_sheets.py <输出目录>
  python3 test/make_brand_sheets.py ../砺蕴工作系统-使用手册/预览

先跑 `node test/brand_shots.mjs` 出图，再跑本脚本。

⚠️ 本机没有 PingFang.ttc，PIL 用它画中文会静默回落成方框 —— 只用
   STHeiti Medium.ttc / Songti.ttc。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, '.shots', 'brand')
SANS = '/System/Library/Fonts/STHeiti Medium.ttc'
SERIF = '/System/Library/Fonts/Songti.ttc'
GOLD = (201, 171, 124)
INK = (30, 28, 24)
PAD = 44
GAP = 26

f = lambda s: ImageFont.truetype(SANS, s)
fs = lambda s: ImageFont.truetype(SERIF, s)


def cell(sheet, d, x, y, w, h, path, title):
    d.text((x, y), title, font=f(28), fill=INK)
    sheet.paste(Image.open(os.path.join(SHOTS, path)).resize((w, h), Image.LANCZOS), (x, y + 58))
    d.rectangle([x - 1, y + 57, x + w, y + 58 + h], outline='#D8D3C8')


def quad(out, tag, sub, cells, cw, ch, title):
    w = PAD * 2 + cw * 2 + GAP
    h = 190 + (58 + ch + GAP) * 2
    s = Image.new('RGB', (w, h), '#F6F5F2')
    d = ImageDraw.Draw(s)
    d.rectangle([0, 0, w, 9], fill=GOLD)
    d.text((PAD, 44), title, font=fs(56), fill=INK)
    d.text((PAD, 124), sub, font=f(27), fill='#6B6459')
    for i, (t, fn) in enumerate(cells):
        cell(s, d, PAD + (i % 2) * (cw + GAP), 190 + (i // 2) * (58 + ch + GAP), cw, ch, fn, t)
    p = os.path.join(out, tag)
    s.save(p)
    print('  ✔', p, s.size)


def dash(d, x, y0, y1, col, seg=18, gap=13, w=4):
    y = y0
    while y < y1:
        d.line([(x, y), (x, min(y + seg, y1))], fill=col, width=w)
        y += seg + gap


def ink_bbox(path, y0, y1):
    """「文字灰」像素的外接框：三通道接近、且偏暗（排除徽章的蓝与金色的字标）"""
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    mx, mn = a.max(axis=2), a.min(axis=2)
    t = (mx - mn < 46) & (a.mean(axis=2) < 178)
    t[:y0] = False
    t[y1:] = False
    xs = np.where(t.sum(axis=0) > 0)[0]
    return int(xs.min()), int(xs.max())


def centering(out):
    rows = [('手机 390×844', 'm-gate-A.png', (0, 120, 780, 700), (334, 365)),
            ('电脑 1440×900', 'd-gate-A.png', (720, 120, 2160, 900), (445, 495))]
    cw = 1180
    scales = [cw / (r[2][2] - r[2][0]) for r in rows]
    heights = [int((r[2][3] - r[2][1]) * sc) for r, sc in zip(rows, scales)]
    h = 214 + sum(x + 100 for x in heights) + 30
    s = Image.new('RGB', (PAD * 2 + cw, h), '#F6F5F2')
    d = ImageDraw.Draw(s)
    d.rectangle([0, 0, PAD * 2 + cw, 9], fill=GOLD)
    d.text((PAD, 44), '四个字，正对中轴', font=fs(56), fill=INK)
    d.text((PAD, 126), '金色虚线是页面正中轴，红色线段是「博艺教育」四个字的实际墨迹宽度 —— 两侧等长才算真的对中',
           font=f(26), fill='#6B6459')
    y = 214
    for (tag, path, cb, by), sc, hh in zip(rows, scales, heights):
        full = os.path.join(SHOTS, path)
        im = Image.open(full).convert('RGB').crop(cb).resize((cw, hh), Image.LANCZOS)
        x0i, x1i = ink_bbox(full, by[0] - 4, by[1] + 4)
        wc = cb[2] - cb[0]
        left, right = x0i - cb[0], cb[2] - 1 - x1i
        ax = int(PAD + cw * ((x0i + x1i) / 2.0 - cb[0]) / wc)
        bl, br = int(PAD + left * sc), int(PAD + (wc - right) * sc)
        my = int(y + (((by[0] + by[1]) / 2.0) - cb[1]) * sc)
        d.text((PAD, y - 40), tag, font=f(28), fill=INK)
        d.text((PAD + 250, y - 40), '左 %d px ／ 右 %d px（差 %d px，墨迹宽 %d）'
               % (round(left), round(right), round(left - right), x1i - x0i + 1), font=f(26), fill='#8C857A')
        s.paste(im, (PAD, y))
        dash(d, ax, y, y + hh, GOLD)
        for xx in (bl, br):
            d.line([(xx, my - 30), (xx, my + 30)], fill=INK, width=3)
        d.line([(bl, my), (br, my)], fill=(210, 90, 80), width=3)
        y += hh + 100
    p = os.path.join(out, '门头四个字对中核对.png')
    s.save(p)
    print('  ✔', p, s.size)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '.shots', 'brand')
    os.makedirs(out, exist_ok=True)
    if not os.path.isdir(SHOTS):
        sys.exit('先跑 node test/brand_shots.mjs 出图')
    print('输出 →', out)
    quad(out, '电脑端_A_竖式门头.png',
         '1440×900 实拍：门头按屏幕尺度放大成一枚牌匾，背后一枚完整的机构徽章印记；表单仍旧收在 400 的窄栏',
         [('登录页 · 浅色', 'd-gate-A.png'), ('登录页 · 深色', 'd-gate-A-dark.png'),
          ('工作台 · 浅色', 'd-app-A.png'), ('工作台 · 深色', 'd-app-A-dark.png')],
         1296, 810, '电脑端 · A · 竖式门头')
    quad(out, '手机端_A_竖式门头.png',
         '390×844 实拍：徽章 → 博艺教育 → 金线 → 砺蕴 → 砺蕴工作系统，自上而下压在中轴；四个字正对正中',
         [('登录页 · 浅色', 'm-gate-A.png'), ('登录页 · 深色', 'm-gate-A-dark.png'),
          ('工作台 · 浅色', 'm-app-A.png'), ('工作台 · 深色', 'm-app-A-dark.png')],
         600, 1298, '手机端 · A · 竖式门头')
    centering(out)


if __name__ == '__main__':
    main()
