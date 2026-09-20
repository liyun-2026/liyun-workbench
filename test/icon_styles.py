#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 —— **风格探索**（同一符号 × 五种视觉风格）

用户说「多给我设计几个风格」，并点名小红书/抖音/微信/QQ/红果/腾讯视频/芒果TV。
风格参照：
  S1 扁平纯色   —— 小红书式：纯品牌色 + 白色单标（最干净、最省眼）
  S2 双色错位   —— 抖音式：近黑底 + 青/粉错位 + 白面（最有能量、最潮）
  S3 玻璃拟态   —— 通透白玻璃 + 白描边（最「新系统」质感）
  S4 渐变光泽   —— 金/暖渐变 + 顶部高光（现用，最稳）
  S5 暗金浮雕   —— 深咖底 + 暗金 + 底边压暗（最贵气）

符号用两枚：话泡（播音=对话+发声）、麦克风（播音最直白）。
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)
import icon_concepts as IC
from icon_concepts import (SS, SAFE, ZH_FONT, blank, paint, bg, gold, flat, sheen, drop,
                           union, sub, isect, rrect_mask, poly_mask, ring_mask, far_radius)


# ───────────────────────── 两枚符号 ─────────────────────────
def g_bubble(W):
    base = union(rrect_mask(W, 0.5, 0.46, 0.54, 0.54, 0.17),
                 poly_mask(W, [(0.32, 0.70), (0.48, 0.70), (0.28, 0.85)]))
    bars = union(*[rrect_mask(W, 0.30 + i * 0.10, 0.46 + (0.34 - h * 0.34) / 2, 0.052, h * 0.34, 0.026)
                   for i, h in enumerate([0.34, 0.56, 0.80, 0.44, 0.62])])
    return sub(base, bars)


def g_mic(W):
    head = sub(rrect_mask(W, 0.5, 0.385, 0.245, 0.345, 0.1225),
               union(*[rrect_mask(W, 0.5, y, 0.155, 0.018, 0.009) for y in (0.305, 0.365, 0.425, 0.485)]))
    yoke = isect(ring_mask(W, 0.5, 0.44, 0.245, 0.207),
                 poly_mask(W, [(0, 0.44), (1, 0.44), (1, 1), (0, 1)]))
    return union(head, yoke, rrect_mask(W, 0.5, 0.70, 0.048, 0.135, 0.024),
                 rrect_mask(W, 0.5, 0.785, 0.185, 0.048, 0.024))


GLYPHS = {'话泡': g_bubble, '麦克风': g_mic}


# ───────────────────────── 工具 ─────────────────────────
def shift(mask, dx, dy):
    a = np.array(mask); out = np.zeros_like(a); H, Wd = a.shape
    xs0, xs1 = max(0, dx), min(Wd, Wd + dx)
    ys0, ys1 = max(0, dy), min(H, H + dy)
    out[ys0:ys1, xs0:xs1] = a[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return Image.fromarray(out, 'L')


def fit_mask(W, mask, target=0.385):
    r = far_radius(W, mask)
    if r <= target:
        return mask, r
    f = target / r; nw = max(1, int(round(W * f)))
    a = np.array(mask.resize((nw, nw), Image.LANCZOS))
    out = np.zeros((W, W), np.uint8); o = (W - nw) // 2
    out[o:o + nw, o:o + nw] = a
    return Image.fromarray(out, 'L'), far_radius(W, Image.fromarray(out, 'L'))


def solid_bg(W, c):
    return Image.new('RGBA', (W, W), tuple(c) + (255,))


# ───────────────────────── 五种风格 ─────────────────────────
def s_flat(W, m):
    b = solid_bg(W, (240, 42, 64))
    s = blank(W); s.alpha_composite(paint(W, m, flat(W, (255, 255, 255))))
    return b, s


def s_duo(W, m):
    b = solid_bg(W, (16, 16, 21)); s = blank(W); d = int(W * 0.016)
    s.alpha_composite(paint(W, shift(m, -d, d), flat(W, (36, 244, 236))))
    s.alpha_composite(paint(W, shift(m, d, -d), flat(W, (254, 44, 88))))
    s.alpha_composite(paint(W, m, flat(W, (255, 255, 255))))
    return b, s


def s_glass(W, m):
    b = bg(W, (96, 64, 210), (28, 20, 92), (168, 150, 255))
    s = blank(W)
    fill = paint(W, m, flat(W, (255, 255, 255)))
    fill.putalpha(Image.fromarray((np.array(fill)[:, :, 3] * 0.52).astype(np.uint8), 'L'))
    s.alpha_composite(fill)
    s.alpha_composite(paint(W, sub(m.filter(ImageFilter.MaxFilter(9)), m), flat(W, (255, 255, 255))))
    return b, s


def s_gold(W, m):
    b = bg(W, (48, 42, 38), (20, 17, 15), (120, 94, 58))
    s = blank(W)
    s.alpha_composite(paint(W, m, gold(W)))
    return b, sheen(s, W, m)


def s_bevel(W, m):
    b = bg(W, (62, 36, 24), (24, 14, 10), (150, 100, 56))
    s = blank(W)
    s.alpha_composite(paint(W, m, gold(W, 0.42, 0.32, 0.0, 0.62, (255, 226, 164), (146, 100, 54))))
    dark = paint(W, isect(m, shift(m, 0, -int(W * 0.013))), flat(W, (0, 0, 0)))
    dark.putalpha(Image.fromarray((np.array(dark)[:, :, 3] * 0.26).astype(np.uint8), 'L'))
    s.alpha_composite(dark)
    return b, sheen(s, W, m, 0.40, 0.30, 0.34, 0.30)


STYLES = [
    ('S1', '扁平纯色', '小红书式', s_flat),
    ('S2', '双色错位', '抖音式', s_duo),
    ('S3', '玻璃拟态', '通透质感', s_glass),
    ('S4', '渐变光泽', '现用 · 最稳', s_gold),
    ('S5', '暗金浮雕', '最贵气', s_bevel),
]


def render(style_fn, glyph_fn, size, rounded=False):
    W = size * SS
    m, r = fit_mask(W, glyph_fn(W))
    b, s = style_fn(W, m)
    b = drop(b, W, m)
    b.alpha_composite(s)
    im = b.resize((size, size), Image.LANCZOS).convert('RGB')
    if rounded:
        al = Image.new('L', (size, size), 0)
        ImageDraw.Draw(al).rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.224, fill=255)
        im = im.convert('RGBA'); im.putalpha(al)
    return im, r


def sheet(stem):
    rows = list(GLYPHS)
    cw, ch = 250, 470
    W = 40 * 2 + len(STYLES) * cw
    y0 = 158 + ch
    H = y0 + 44 + 120 + 30
    cv = Image.new('RGB', (W, H), (226, 222, 215))
    d = ImageDraw.Draw(cv)
    f = ImageFont.truetype(ZH_FONT, 32); fs = ImageFont.truetype(ZH_FONT, 16); ft = ImageFont.truetype(ZH_FONT, 21)
    d.text((40, 26), '砺蕴 · 桌面图标 · 五种风格（同一符号，换皮对比）', font=f, fill=(34, 31, 26))
    d.text((40, 76), '同一枚符号，只换视觉风格 —— 风格照 小红书 / 抖音 / 苹果新系统 / 现用 / 贵气 五种调性', font=fs, fill=(112, 105, 96))
    for r_i, gname in enumerate(rows):
        yy = 158 + r_i * ch
        d.text((40, yy + 4), f'{gname}', font=ft, fill=(34, 31, 26))
        for c_i, (tag, name, ref, fn) in enumerate(STYLES):
            x = 40 + c_i * cw
            big, r = render(fn, GLYPHS[gname], 210)
            cv.paste(big, (x + 18, yy + 34))
            xx = x + 18
            for px in (76, 60, 44):
                im, _ = render(fn, GLYPHS[gname], px, rounded=True)
                cv.paste(im, (xx, yy + 258), im)
                xx += px + 10
            d.text((x + 18, yy + 336), f'{tag} · {name}', font=ft, fill=(34, 31, 26))
            d.text((x + 18, yy + 368), ref, font=fs, fill=(96, 90, 82))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'{stem}.png')
    cv.save(p)
    return p


def main():
    print('风格探索出图：', sheet('桌面图标_风格探索'))
    for gname, gfn in GLYPHS.items():
        W = 512 * SS
        _, r = fit_mask(W, gfn(W))
        print(f'  {gname} 最远半径 {r:.3f} / {SAFE:.3f} ' + ('OK' if r <= SAFE else '超'))


if __name__ == '__main__':
    main()
