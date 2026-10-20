#!/usr/bin/env python3
"""图 C：手机端 390 长图。

输入：test/.shots/mobile/_tiles/390_hours_light/*.png（capture_mobile_shots.mjs 产出）
处理：
  · 先比较相邻切片是否几乎相同（内容比一屏矮时，后面的切片是重复的）→ 重复的不拼。
  · 相同则只取第一片；否则按文件名顺序纵向拼接。
  · 4x(1560宽) 降采样到 2x(780宽)，等价于 iPhone 14 的原生截图尺寸。
输出：test/.shots/plan-keshitongji/stage1/C_手机端390.png
"""
import glob, os, sys
from PIL import Image, ImageChops

SRC = 'test/.shots/mobile/_tiles/390_hours_light'
OUT = 'test/.shots/plan-keshitongji/stage1/C_手机端390.png'

files = sorted(glob.glob(os.path.join(SRC, '*.png')))
assert files, '没有切片：' + SRC
imgs = [Image.open(f).convert('RGB') for f in files]

keep = [imgs[0]]
for i in range(1, len(imgs)):
    a, b = imgs[i - 1], imgs[i]
    diff = ImageChops.difference(a, b)
    bbox = diff.getbbox()
    changed = 0
    if bbox:
        # 统计显著变化的像素比例（阈值 12）
        g = diff.convert('L')
        import numpy as np
        changed = int((np.array(g) > 12).sum())
    total = a.width * a.height
    ratio = changed / total
    print(f'  {os.path.basename(files[i])}: diff bbox={bbox} 变化像素占比={ratio:.4%}')
    if ratio > 0.002:
        keep.append(b)

w = max(im.width for im in keep)
H = sum(im.height for im in keep)
canvas = Image.new('RGB', (w, H), (255, 255, 255))
y = 0
for im in keep:
    canvas.paste(im, (0, y)); y += im.height
print(f'拼接 {len(keep)}/{len(imgs)} 片 -> {canvas.size}')

final = canvas.resize((canvas.width // 2, canvas.height // 2), Image.LANCZOS)
final.save(OUT)
print(f'已写出 {OUT}  {final.width}x{final.height}')
