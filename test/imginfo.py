#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""素材体检：量出截图的有效内容边界、留白比例、主色，供版式规划使用。
用法：python3 test/imginfo.py <素材目录>
"""
import sys, os, glob
from PIL import Image
import numpy as np


def analyze(path):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    h, w = a.shape[:2]
    rgb, alpha = a[:, :, :3].astype(int), a[:, :, 3]

    # 背景色取四角众数
    corners = [rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]]
    bg = np.median(np.array(corners), axis=0)

    diff = np.abs(rgb - bg).sum(axis=2)
    mask = (diff > 24) & (alpha > 24)

    rows = mask.any(axis=1)
    cols = mask.any(axis=0)
    if rows.any():
        top, bottom = int(np.argmax(rows)), int(h - np.argmax(rows[::-1]))
        left, right = int(np.argmax(cols)), int(w - np.argmax(cols[::-1]))
    else:
        top, bottom, left, right = 0, h, 0, w

    ink = mask.mean()  # 内容像素占比
    nz = alpha.mean() / 255 if alpha.min() < 255 else 1.0

    return dict(
        size=(w, h), ratio=w / h, box=(left, top, right, bottom),
        box_ratio=(right - left) / max(1, bottom - top),
        ink=ink, opacity=nz, bg=tuple(int(v) for v in bg),
        alpha=alpha.min() < 255,
    )


def main():
    d = sys.argv[1]
    files = sorted(glob.glob(os.path.join(d, "*.png")) + glob.glob(os.path.join(d, "*.jpg")))
    print(f"{'文件':<26}{'尺寸':<13}{'比例':<7}{'内容框(左,上,右,下)':<26}{'内容占比':<10}{'底色'}")
    print("-" * 96)
    for f in files:
        r = analyze(f)
        box = "%d,%d,%d,%d" % r["box"]
        print(f"{os.path.basename(f):<26}{r['size'][0]}x{r['size'][1]:<8}{r['ratio']:<7.2f}{box:<26}{r['ink']*100:>6.1f}%   {r['bg']}"
              + ("  [带透明]" if r["alpha"] else ""))


if __name__ == "__main__":
    main()
