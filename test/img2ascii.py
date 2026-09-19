#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把图片转成字符画，用于在无图像能力时核对版面结构。
用法：python3 test/img2ascii.py <图片> [宽字符数=70]
亮度用字符梯度表示，另可选叠加"彩色区"标记。
"""
import sys
import numpy as np
from PIL import Image

RAMP = " .:-=+*#%@"          # 由暗到亮


def gray_art(a, cols):
    h, w = a.shape[:2]
    rows = max(1, int(cols * h / w * 0.5))       # 终端字符高宽比约 1:2
    lum = (0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]).astype(np.uint8)
    im = Image.fromarray(lum, mode="L").resize((cols, rows), Image.LANCZOS)
    g = np.array(im).astype(float)
    g = (g - g.min()) / max(1e-6, g.max() - g.min())
    out = []
    for r in range(rows):
        out.append("".join(RAMP[min(len(RAMP) - 1, int(v * (len(RAMP) - 1) + 0.5))] for v in g[r]))
    return out


def hue_art(a, cols):
    """用符号标出金色区域（品牌色）的位置，便于确认 logo 落位。"""
    h, w = a.shape[:2]
    rows = max(1, int(cols * h / w * 0.5))
    im = Image.fromarray(a).resize((cols, rows), Image.LANCZOS)
    b = np.array(im).astype(int)
    r, g, bl = b[:, :, 0], b[:, :, 1], b[:, :, 2]
    gold = (r > 140) & (r - bl > 28) & (abs(r - g) < 70)     # 暖金色调
    dark = (0.299 * r + 0.587 * g + 0.114 * bl) < 90
    out = []
    for y in range(rows):
        line = []
        for x in range(cols):
            if gold[y, x]:
                line.append("G")
            elif dark[y, x]:
                line.append("#")
            else:
                line.append(".")
        out.append("".join(line))
    return out


def main():
    path = sys.argv[1]
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 70
    im = Image.open(path).convert("RGB")
    a = np.array(im)
    print(f"### {path}  {im.width}x{im.height}  ({im.width/im.height:.2f})")
    print("--- 明暗 ---")
    for line in gray_art(a, cols):
        print(line)
    print("--- 色块（G=金色  #=深色  .=浅底）---")
    for line in hue_art(a, cols):
        print(line)


if __name__ == "__main__":
    main()
