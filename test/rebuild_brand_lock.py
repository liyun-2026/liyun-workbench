#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重建网页 Logo 资产：把「融合标」右侧的砺蕴章，换成【带米黄底 + 金纹加粗】的新版。

背景：原融合标右侧砺蕴只有细金线、无底色，在深色侧栏(#5E3328 等)与手机顶栏上几乎看不清。
用户提供了一张"带底色"的砺蕴圆章，并要求把里面的金纹加粗一点点使其更明显。

链路（稳定源，可重跑）：
  左半 <- 品牌运营/交付/融合logo/融合Logo_横版_透明.png   （博艺徽章 + 分隔线，原样保留）
  右半 <- 品牌运营/砺蕴圆章_带底原稿_1920.jpg              （加粗金纹 + 保留米黄底 + 裁圆）
  产出 -> 砺蕴工作台/assets/brand-lock.png (1024) 与 brand-lock@sm.png (384)

加粗方式：对亮度做最小值滤波(MinFilter, 半径 BOLD_RADIUS) —— 暗处扩张即线变粗，
再把结果按「米黄底 -> 品牌金」重着色，同时保证线条加粗但保留柔和边缘。
"""
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = "/Users/xielihui/Desktop/砺蕴教务系统"
FUSION = os.path.join(ROOT, "品牌运营", "交付", "融合logo", "融合Logo_横版_透明.png")
EMBLEM_SRC = os.path.join(ROOT, "品牌运营", "砺蕴圆章_带底原稿_1920.jpg")
WEB = os.path.join(ROOT, "砺蕴工作台", "assets")

TARGET_W = 1024
BOLD_RADIUS = 3          # 加粗"一点点"：r2 还是偏淡、r4 会糊，r3 = 明显但未糊
EMBLEM_MARGIN = 4        # 裁框相对纹样 bbox 的外扩量(px @1920)
BG = (255, 253, 228)     # 米黄底（取自原稿）
INK = (200, 172, 124)    # 品牌金纹样色（取自原稿）


def left_half():
    """从融合标原稿取左侧：博艺徽章 + 分隔线（原样保留）。"""
    im = Image.open(FUSION).convert("RGBA")
    a = np.array(im)
    ys, xs = np.where(a[:, :, 3] > 20)
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    nh = max(1, round(im.size[1] * TARGET_W / im.size[0]))
    im = im.resize((TARGET_W, nh), Image.LANCZOS)
    # 找右侧砺蕴章段的起始列：取「最后一个较宽的非空 alpha 段」的起点
    cols = np.array(im)[:, :, 3].sum(axis=0)
    segs, s = [], None
    for i, c in enumerate(cols):
        if c > 0 and s is None:
            s = i
        if c == 0 and s is not None:
            segs.append((s, i - 1))
            s = None
    if s is not None:
        segs.append((s, len(cols) - 1))
    wide = [(x, y) for x, y in segs if (y - x) > 100]
    right_start, right_end = wide[-1]
    left = im.crop((0, 0, right_start, nh))
    return left, nh, right_start, right_end


def emblem(height):
    """砺蕴圆章：加粗金纹 + 米黄底 + 圆形裁切，缩放到指定高度。"""
    im = Image.open(EMBLEM_SRC).convert("RGB")
    g = np.array(im.convert("L")).astype(float)
    bg_lum = float(g[5, 5])
    mask = g < bg_lum - 12
    ys, xs = np.where(mask)
    m = EMBLEM_MARGIN
    im = im.crop((xs.min() - m, ys.min() - m, xs.max() + 1 + m, ys.max() + 1 + m))
    side = im.size[0]
    g2 = im.convert("L").filter(ImageFilter.MinFilter(BOLD_RADIUS * 2 + 1))
    g2 = np.array(g2).astype(float)
    ink_lum = float(np.percentile(g2, 2))
    t = np.clip((bg_lum - g2) / max(1e-6, bg_lum - ink_lum), 0, 1)
    bg = np.array(BG, float)
    ink = np.array(INK, float)
    out = np.zeros((side, side, 3), float)
    for c in range(3):
        out[..., c] = bg[c] * (1 - t) + ink[c] * t
    out = Image.fromarray(out.astype(np.uint8), "RGB").convert("RGBA")
    # 圆形 alpha
    r = side / 2.0 - 0.5
    yy, xx = np.mgrid[0:side, 0:side]
    d = np.sqrt((xx - r) ** 2 + (yy - r) ** 2)
    alpha = np.clip(r - d + 0.5, 0, 1) * 255
    out.putalpha(Image.fromarray(alpha.astype(np.uint8)))
    return out.resize((height, height), Image.LANCZOS)


def main():
    left, nh, right_start, right_end = left_half()
    print("融合标左半:", left.size, "| 原砺蕴段 x", right_start, "-", right_end, "| 高", nh)
    em = emblem(nh)
    canvas = Image.new("RGBA", (TARGET_W, nh), (0, 0, 0, 0))
    canvas.paste(left, (0, 0))
    cx = (right_start + right_end) // 2 - nh // 2      # 与原砺蕴段同心
    cx = max(right_start, min(cx, TARGET_W - nh))
    canvas.paste(em, (cx, 0), em)
    print("新砺蕴章 x", cx, "-", cx + nh)

    for name, w in (("brand-lock.png", 1024), ("brand-lock@sm.png", 384)):
        h = max(1, round(nh * w / TARGET_W))
        out = canvas.resize((w, h), Image.LANCZOS).quantize(colors=128, method=Image.FASTOCTREE)
        p = os.path.join(WEB, name)
        out.save(p, optimize=True)
        print("  -> %-18s %dx%d  %5d KB" % (name, w, h, os.path.getsize(p) // 1024))


if __name__ == "__main__":
    main()
