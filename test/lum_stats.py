#!/usr/bin/env python3
"""截一块图，报它的亮度分布与对比度（WCAG 相对亮度）。

用途：量化榜在深蓝看板上到底看得清不清 —— 不靠肉眼，靠像素。

取法说明：文字在大块面板里只占百分之几的像素（这张图里亮字约 0.3%），
拿 95% 分位当「字色」会一直取到底色，算出 1.2:1 这种假数。
所以：底色取 10% 分位（大面积面板底），字色取最亮像素（文字实心笔画）。
对比度 = (L_hi + .05) / (L_lo + .05)。正文大字 ≥ 3:1 即可读，这里按 4.5 卡。
"""
import sys, json
from PIL import Image

im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
px = list(im.getdata())


def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


lums = sorted(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) for r, g, b in px)
n = len(lums)
lo = lums[int(n * 0.10)]
hi = lums[-1]
ratio = (hi + 0.05) / (lo + 0.05)
print(json.dumps({
    'w': w, 'h': h, 'n': n,
    'lo': round(lo, 4), 'hi': round(hi, 4),
    'mean': round(sum(lums) / n, 4),
    'ratio': round(ratio, 2),
}))
