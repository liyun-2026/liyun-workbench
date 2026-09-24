#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""字形底稿：把「声」在两种字重下渲染出来，看清笔画结构，才能谈改造。"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
os.makedirs(REVIEW, exist_ok=True)

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
S = 512


def render(ch, weight, size=S, pad=40):
    f = ImageFont.truetype(FONT, size, index=2 if weight == 'W6' else 0)
    img = Image.new('L', (size + pad * 2, size + pad * 2), 0)
    d = ImageDraw.Draw(img)
    d.text((pad, pad), ch, font=f, fill=255)
    bb = img.getbbox()
    return img.crop(bb)


def tile(imgs, labels, path, cell=420):
    n = len(imgs)
    cols = n
    W = cell * cols
    H = cell
    canvas = Image.new('RGB', (W, H), (18, 18, 22))
    d = ImageDraw.Draw(canvas)
    for i, im in enumerate(imgs):
        k = min((cell - 90) / im.width, (cell - 90) / im.height)
        w, h = int(im.width * k), int(im.height * k)
        r = im.resize((w, h), Image.LANCZOS)
        canvas.paste(Image.new('RGB', (w, h), (240, 240, 245)),
                     ((cell - w) // 2 + cell * i, (cell - h) // 2))
        canvas.paste(r.convert('RGB').point(lambda v: 255 - v).convert('RGB'),
                     ((cell - w) // 2 + cell * i, (cell - h) // 2))
    d.text((14, 12), ' | '.join(labels), fill=(250, 250, 250))
    canvas.save(path)
    print('→', path)


if __name__ == '__main__':
    chars = ['声']
    for ch in chars:
        im3 = render(ch, 'W3')
        im6 = render(ch, 'W6')
        tile([im3, im6], [f'{ch} W3 {im3.width}x{im3.height}', f'{ch} W6'],
             os.path.join(REVIEW, '字稿_声_笔画.png'))
        # ASCII 预览：确认结构
        a = np.array(im6.resize((44, 66), Image.LANCZOS)) / 255.0
        print('\n'.join(''.join('##' if v > .55 else ('..' if v > .18 else '  ')
                                for v in row) for row in a))
