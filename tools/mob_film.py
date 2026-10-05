#!/usr/bin/env python3
"""把「逐屏拍下来的手机端切片」拼成一张胶片对照图，一眼看完整页。

    python3 tools/mob_film.py <tag> <page> <light|dark> [每行屏数]

读 test/.shots/mobile/_tiles/<tag>_<page>_<scheme>/NN.png
出 test/.shots/mobile/_film/<tag>_<page>_<scheme>_film.png
"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOB = os.path.join(ROOT, 'test', '.shots', 'mobile')
DST = os.path.join(MOB, '_film')
os.makedirs(DST, exist_ok=True)

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'


def font(sz):
    for p in (FONT, '/System/Library/Fonts/Supplemental/Songti.ttc'):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()


def film(tag, page, scheme, cols=6):
    tdir = os.path.join(MOB, '_tiles', f'{tag}_{page}_{scheme}')
    files = sorted(glob.glob(os.path.join(tdir, '*.png')))
    if not files:
        print('没有切片：' + tdir)
        return None
    ims = [Image.open(f).convert('RGB') for f in files]
    W, H = ims[0].size
    gap, label_h = 12, 40
    lw = W + gap
    rows = -(-len(ims) // cols)
    sheet = Image.new('RGB', (cols * lw + gap, rows * (H + label_h) + gap), (245, 244, 241))
    d = ImageDraw.Draw(sheet)
    f = font(28)
    for i, im in enumerate(ims):
        c, r = i % cols, i // cols
        x = gap + c * lw
        y = gap + r * (H + label_h)
        sheet.paste(im, (x, y + label_h))
        d.text((x + 4, y + 8), f'第 {i+1} 屏', font=f, fill=(110, 104, 94))
        d.rectangle([x - 1, y + label_h - 1, x + W, y + label_h + H], outline=(214, 210, 202))
    out = os.path.join(DST, f'{tag}_{page}_{scheme}_film.png')
    sheet.save(out)
    print(f'{out}\n  {sheet.size[0]}×{sheet.size[1]}  {len(ims)} 屏  单屏 {W}×{H}')
    return out


if __name__ == '__main__':
    tag, page, scheme = sys.argv[1], sys.argv[2], sys.argv[3]
    cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
    film(tag, page, scheme, cols)
