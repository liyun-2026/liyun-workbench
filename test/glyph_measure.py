#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""笔画测绘：用形态学 opening 把「声」的横画 / 竖画分开，量出每一笔的精确位置。

设计一个字，得先知道它每一笔在哪。这里不用眼睛估，用行/列形态学分离：
  横画 = 用「1×k 的横条」做 opening（只有够长的横才活得下来）
  竖画 = 用「k×1 的竖条」做 opening
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'


def glyph_mask(ch='声', size=800, index=2):
    f = ImageFont.truetype(FONT, size, index=index)
    img = Image.new('L', (size * 2, size * 2), 0)
    ImageDraw.Draw(img).text((size // 2, size // 2), ch, font=f, fill=255)
    return img.crop(img.getbbox())


def strokes(m):
    H, W = m.shape
    horiz = ndimage.binary_opening(m, structure=np.ones((1, int(H * 0.20)), bool))
    vert = ndimage.binary_opening(m, structure=np.ones((int(H * 0.13), 1), bool))
    out = {}
    for name, arr in (('横', horiz), ('竖', vert)):
        lab, n = ndimage.label(arr)
        rows = []
        for i in range(1, n + 1):
            ys, xs = np.where(lab == i)
            if len(ys) < H * W * 0.002:
                continue
            rows.append(dict(y0=ys.min() / H, y1=ys.max() / H,
                             x0=xs.min() / W, x1=xs.max() / W, area=len(ys) / (H * W)))
        rows.sort(key=lambda r: (r['y0'] if name == '横' else r['x0']))
        out[name] = rows
    return out, H / W


if __name__ == '__main__':
    m = np.array(glyph_mask()) > 127
    H, W = m.shape
    print(f'字面 {W}x{H}  宽高比 {W/H:.3f}  墨占 {m.mean():.3f}')
    info, ratio = strokes(m)
    for k, rows in info.items():
        print(f'\n── {k}画 {len(rows)} 条 ──')
        for r in rows:
            cy, cx = (r['y0'] + r['y1']) / 2, (r['x0'] + r['x1']) / 2
            if k == '横':
                print(f"  中心y={cy:.3f}  厚度={(r['y1']-r['y0']):.3f}  x {r['x0']:.3f}→{r['x1']:.3f} (长{r['x1']-r['x0']:.3f})")
            else:
                print(f"  中心x={cx:.3f}  厚度={(r['x1']-r['x0']):.3f}  y {r['y0']:.3f}→{r['y1']:.3f} (长{r['y1']-r['y0']:.3f})")
