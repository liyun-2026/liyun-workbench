#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""渲染页质检：把每页切成网格，输出各格的内容密度，用于发现版面空洞或元素缺失。
用法：python3 test/qa.py <渲染目录> [列数]
"""
import sys, os, glob
import numpy as np
from PIL import Image

d = sys.argv[1]
COLS = int(sys.argv[2]) if len(sys.argv) > 2 else 12

files = sorted(glob.glob(os.path.join(d, "p*.png")))
RAMP = " .:-=+*#%@"

print("%-6s %-7s %s" % ("页", "内容率", "网格密度（上→下，左→右）"))
print("-" * 100)
for f in files:
    im = Image.open(f).convert("RGB")
    a = np.array(im).astype(float)
    h, w = a.shape[:2]
    rows = max(2, int(COLS * h / w * 0.5))

    lum = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    # 以整体亮度中位数为基准，偏离即视为"有内容"
    base = np.median(lum)
    content = np.abs(lum - base) > 18

    # 网格化
    gh, gw = h // rows, w // COLS
    grid = []
    for r in range(rows):
        line = []
        for c in range(COLS):
            blk = content[r * gh:(r + 1) * gh, c * gw:(c + 1) * gw]
            v = blk.mean() if blk.size else 0
            line.append(RAMP[min(len(RAMP) - 1, int(v * 3.2 * (len(RAMP) - 1) + 0.3))])
        grid.append("".join(line))

    name = os.path.basename(f).replace(".png", "")
    print("%-6s %5.1f%%  %s" % (name, content.mean() * 100, grid[0]))
    for g in grid[1:]:
        print("%-6s %-7s %s" % ("", "", g))
    print()
