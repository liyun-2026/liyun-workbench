#!/usr/bin/env python3
"""把逐屏切片纵向拼成一张长图（按每片真实 scrollTop 精确裁切，不重复、不断行）。

    python3 stitch_vert.py <tiles_dir> <out.png>

tiles_dir/meta.json 形如：
    {"scale":2,"h":900,"scrollH":1110,"w":1044,"tiles":[{"f":"01.png","y":0},{"f":"02.png","y":210}]}
- h/CSS：滚动容器可视高度；y：截图那一刻容器里真实 scrollTop（会被 scrollHeight 夹住）。
- 第 i>0 片裁掉顶部 (y[i-1] + h - y[i]) * scale 像素，正好接上一片末尾。
- 最后一片只保留到内容总高 scrollH 为止（裁掉多余的底部）。
"""
import sys, os, json
from PIL import Image

d, out = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf-8'))
sc, h, scrollH, tiles = meta['scale'], meta['h'], meta['scrollH'], meta['tiles']

parts = []
for i, t in enumerate(tiles):
    im = Image.open(os.path.join(d, t['f'])).convert('RGB')
    top_css = 0 if i == 0 else max(0, (tiles[i - 1]['y'] + h) - t['y'])
    bot_css = h if i < len(tiles) - 1 else max(0, scrollH - t['y'])
    top, bot = int(round(top_css * sc)), int(round(min(h, bot_css) * sc))
    top = max(0, min(top, im.height - 1))
    bot = max(top + 1, min(bot, im.height))
    parts.append((im.crop((0, top, im.width, bot)), t['f'], top_css, bot_css))

w = max(p[0].width for p in parts)
H = sum(p[0].height for p in parts)
canvas = Image.new('RGB', (w, H), (255, 255, 255))
y = 0
for p, fn, tc, bc in parts:
    canvas.paste(p, (0, y)); y += p.height
    print(f'  {fn}: crop_top={tc}css keep_h={bc}css -> {p.width}x{p.height}')
canvas.save(out)
print(f'stitched {len(parts)} tiles -> {canvas.width}x{canvas.height}')
