#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成浏览器标签页小图标（favicon）—— 沿用「带米黄底 + 金纹加粗」的砺蕴圆章。

为什么要单独做这个：
  网页内的融合标已换成【米黄底 + 金纹加粗】，但浏览器标签页那个小图标
  仍指向旧的「深墨底」PWA 图标(icon-192.png)，两处不一致，用户反馈
  「砺蕴2026 旁边那个小 logo 还没有换」。

  注意：桌面/PWA 图标（icon.png / icon-192.png / apple-touch-icon.png）**不动**，
  用户明确说过桌面图标不需要我碰。这里只产出 favicon 专用文件。

产出：
  砺蕴工作台/favicon.ico        （16 / 32 / 48 三档打包，兼容性最好）
  砺蕴工作台/favicon-192.png    （192，给支持大图标的浏览器/安卓用）

画法：与 rebuild_brand_lock.py 的 emblem() 同一套管线（MinFilter 加粗 + 重着色），
唯一区别是**不做圆形 alpha 裁切** —— favicon 要的是一枚方形瓷砖：
圆章内切于方，四角自然留米黄底，远看就是「米黄底上一枚金章」。
"""
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = "/Users/xielihui/Desktop/砺蕴教务系统"
EMBLEM_SRC = os.path.join(ROOT, "品牌运营", "砺蕴圆章_带底原稿_1920.jpg")
WEB = os.path.join(ROOT, "砺蕴工作台")

BOLD_RADIUS = 3          # 与网页 logo 同一档加粗（r3），保持品牌一致
EMBLEM_MARGIN = 4        # 裁框相对纹样 bbox 的外扩量(px @1920)
BG = (255, 253, 228)     # 米黄底（取自原稿）
INK = (200, 172, 124)    # 品牌金纹样色（取自原稿）


def emblem_tile():
    """砺蕴圆章：加粗金纹 + 保留米黄底，方形（不裁圆），原尺寸输出。"""
    im = Image.open(EMBLEM_SRC).convert("RGB")
    g = np.array(im.convert("L")).astype(float)
    bg_lum = float(g[5, 5])
    mask = g < bg_lum - 12
    ys, xs = np.where(mask)
    m = EMBLEM_MARGIN
    im = im.crop((xs.min() - m, ys.min() - m, xs.max() + 1 + m, ys.max() + 1 + m))

    g2 = im.convert("L").filter(ImageFilter.MinFilter(BOLD_RADIUS * 2 + 1))
    g2 = np.array(g2).astype(float)
    ink_lum = float(np.percentile(g2, 2))
    t = np.clip((bg_lum - g2) / max(1e-6, bg_lum - ink_lum), 0, 1)

    bg = np.array(BG, float)
    ink = np.array(INK, float)
    h, w = g2.shape
    out = np.zeros((h, w, 3), float)
    for c in range(3):
        out[..., c] = bg[c] * (1 - t) + ink[c] * t
    return Image.fromarray(out.astype(np.uint8), "RGB")


def main():
    src = emblem_tile()
    print("圆章方形原稿:", src.size)

    p192 = os.path.join(WEB, "favicon-192.png")
    src.resize((192, 192), Image.LANCZOS).save(p192, optimize=True)

    pico = os.path.join(WEB, "favicon.ico")
    src.resize((48, 48), Image.LANCZOS).save(
        pico, sizes=[(16, 16), (32, 32), (48, 48)]
    )

    for p in (p192, pico):
        im = Image.open(p)
        a = np.array(im.convert("RGB")).astype(float)
        # 金色像素占比：判断小尺寸下纹样是否还在（而不是糊成一片米黄）
        gold = ((a[:, :, 0] - a[:, :, 2]) > 25).mean() * 100
        print("  -> %-18s %-10s %5d B  金色占比 %.1f%%"
              % (os.path.basename(p), "%dx%d" % im.size, os.path.getsize(p), gold))


if __name__ == "__main__":
    main()
