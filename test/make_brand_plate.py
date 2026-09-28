#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""带【深墨底板】的横版组合标 —— 一劳永逸版。

## 为什么要这个

`brand-lock.png`（米黄底版）与 `brand-lock-alpha.png`（透明底版）其实是**两个用途**：
- 米黄底版：右侧砺蕴章自带米黄圆盘 + 品牌金纹（从「砺蕴圆章_带底原稿」重着色来的），
  **浅底上读得清**。
- 透明底版：右侧砺蕴章是**给深色底做的米黄细线描**，本身**没有底色**。
  贴到纸上（看板 #FAF7F0）就化成一团浅色 —— 看板左上角「看不清晰」就是这个原因，
  不是分辨率不够，是把「深底专用」的那一版贴到了浅底上。

用户要的是：**给组合标加一块底板**，这样不管贴到什么颜色的背景上都能看清，
以后不用再一版一版地修。

## 做法

底板 = 深墨 `#1A1815`（和 `make_fusion_v2.py` 里 `DARK` 同色）的圆角矩形，
外面透明 —— 于是这张图**同时**能在浅底（墨板立得住）和深底（墨板融进背景、
只剩金色与蓝色内容）上成立。内容取 `融合Logo_横版_透明.png` 的**内容区**原样贴上去，
一个像素都不重画。

⚠️ 深墨版 `融合Logo_横版_深墨.png` 是同一份内容铺在一块**满幅**墨底上的成品；
这里不用它，是为了自己掌控圆角、内边距与描边 —— 直接裁它的圆角会在边缘留下硬边。

## 产出

- 桌面归档（用户口头指定的「桌面那个 logo 的文件」）：
  `~/Desktop/砺蕴logo_五版颜色/砺蕴横版组合标_深墨底板.png`
- 网页三档：`砺蕴工作台/assets/brand-plate.png` / `@2x` / `@3x`

重跑：`~/.workbuddy/binaries/python/envs/default/bin/python3 test/make_brand_plate.py`
另加 `--sheet` 会在 /tmp 出几张对比图（几档内边距 × 几档显示尺寸），供挑版式用。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = "/Users/xielihui/Desktop/砺蕴教务系统"
SRC = os.path.join(ROOT, "品牌运营", "交付", "融合logo", "融合Logo_横版_透明.png")
WEB = os.path.join(ROOT, "砺蕴工作台", "assets")
DESK_LOGO_DIR = os.path.expanduser("~/Desktop/砺蕴logo_五版颜色")

INK = (26, 24, 21, 255)          # #1A1815 深墨（与 make_fusion_v2.py 的 DARK 同色）
GOLD = (201, 171, 124)           # #C9AB7C 品牌金

# 版式参数（都按「内容高度」的比例来，换尺寸不用重算）
PAD_Y = 0.150        # 上下内边距（0.17 版留白更足但字变小；0.10 版太挤，取中间）
PAD_X = 0.230        # 左右内边距
RADIUS = 0.115       # 圆角半径（按底板高度）
HAIRLINE = True      # 板内压一道品牌金细描边：让它读起来像一块「匾」，不是一块黑方块
HAIRLINE_INSET = 0.048   # 描边距板边
HAIRLINE_W = 0.0055      # 描边粗细（按底板高度）


def content(src=SRC):
    """取透明底融合标的**内容区**（去掉四周空白），原样返回。"""
    im = Image.open(src).convert("RGBA")
    a = np.array(im)
    ys, xs = np.where(a[:, :, 3] > 30)
    return im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def plate_of(art, pad_y=PAD_Y, pad_x=PAD_X, radius=RADIUS,
             hairline=HAIRLINE, ink=INK, ss=4):
    """把内容贴到一块圆角深墨底板上，板外透明。

    ⚠️ 只把**底板**放在 `ss` 倍超采样下画、再降采样回来（圆角与 1px 级描边
       直接按目标尺寸画会有锯齿）；内容始终以**原生像素**贴上去，不缩放 ——
       否则等于把图放大了再缩回来，白掉一层锐度（第一版就踩了这个：
       整块画布按 ss 倍放大、内容却按 1 倍贴，结果缩成左上角一小坨）。
    """
    cw, ch = art.size
    py, px = round(ch * pad_y), round(ch * pad_x)
    W, H = cw + px * 2, ch + py * 2
    big = Image.new("RGBA", (W * ss, H * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    r = round(H * radius) * ss
    d.rounded_rectangle([0, 0, W * ss - 1, H * ss - 1], radius=r, fill=ink)
    if hairline:
        ins = round(H * HAIRLINE_INSET) * ss
        hw = max(ss // 2, round(H * HAIRLINE_W) * ss)
        d.rounded_rectangle([ins, ins, W * ss - 1 - ins, H * ss - 1 - ins],
                            radius=max(1, r - ins), outline=GOLD + (150,), width=hw)
    plate = big.resize((W, H), Image.LANCZOS)
    plate.alpha_composite(art, (px, py))
    return plate


def check_on(im, bg, pad=0):
    """把成品贴到指定底色上，看它在那个底上成不成立。"""
    w, h = im.size
    canvas = Image.new("RGBA", (w + pad * 2, h + pad * 2), bg)
    canvas.alpha_composite(im, (pad, pad))
    return canvas.convert("RGB")


def main():
    art = content()
    print("内容区", art.size, "宽高比 %.3f" % (art.size[0] / art.size[1]))
    os.makedirs(DESK_LOGO_DIR, exist_ok=True)

    # ── 正式产出 ──
    master = plate_of(art)
    print("底板成品", master.size, "宽高比 %.3f" % (master.size[0] / master.size[1]))

    arc = os.path.join(DESK_LOGO_DIR, "砺蕴横版组合标_深墨底板.png")
    master.save(arc)
    print("  -> 桌面归档 %s  %d KB" % (arc, os.path.getsize(arc) // 1024))

    W0 = master.size[0]
    for name, w in (("brand-plate.png", 300), ("brand-plate@2x.png", 600),
                    ("brand-plate@3x.png", 900)):
        h = max(1, round(master.size[1] * w / W0))
        p = os.path.join(WEB, name)
        master.resize((w, h), Image.LANCZOS).save(p, optimize=True)
        print("  -> %-20s %dx%d  %4d KB" % (name, w, h, os.path.getsize(p) // 1024))

    if "--sheet" not in sys.argv:
        return

    # ── 挑版式用的对比图（不进仓库） ──
    variants = {
        "A_无描边": plate_of(art, hairline=False),
        "B_带金线": plate_of(art, hairline=True),
        "C_紧凑": plate_of(art, pad_y=0.10, pad_x=0.16, radius=0.09, hairline=True),
        "D_宽松": plate_of(art, pad_y=0.24, pad_x=0.32, radius=0.14, hairline=True),
    }
    for k, v in variants.items():
        v.save("/tmp/plate_%s.png" % k)
        print("  对比 %-10s %s" % (k, v.size))

    # 在真实底色上看：宣纸米白 / 纯白 / 深墨
    backgrounds = {"paper": (250, 247, 240, 255), "white": (255, 255, 255, 255),
                   "ink": (26, 24, 21, 255)}
    for k, v in variants.items():
        for bn, bg in backgrounds.items():
            check_on(v.resize((300, round(300 * v.size[1] / v.size[0])), Image.LANCZOS),
                     bg, 24).save("/tmp/chk_%s_%s.png" % (k, bn))

    # 三档显示尺寸（看板实际约 130px 宽）
    for w in (130, 200, 300):
        v = variants["B_带金线"]
        check_on(v.resize((w, round(w * v.size[1] / v.size[0])), Image.LANCZOS),
                 (250, 247, 240, 255), 30).save("/tmp/size_%d.png" % w)
    print("对比图 -> /tmp/plate_*.png /tmp/chk_*.png /tmp/size_*.png")


if __name__ == "__main__":
    main()
