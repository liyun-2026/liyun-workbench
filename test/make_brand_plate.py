#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""看板品牌标：博艺圆章**原样**，砺蕴印章压在「暖米黄圆底」上（v43 定稿）。

## 为什么是这个做法

看板是整屏宣纸米白（`#FAF7F0`）。而融合标里的**砺蕴印章是「品牌金细线描」**——
那是给深色底做的线，直接贴在纸上化成一团浅色。用户连着报了几次「看不清晰」。

中间试过「整条加一块**深墨**底板」：清晰是清晰了，但被否了——
「整体都是白色的，突然有一个黑色的很丑……博艺的 logo 是白色跟蓝色的」。
于是改成 **只给砺蕴那半加底**（用户原话：「只给砺蕴的 logo 加个底色」），
底色走**暖米黄**（跟宣纸同族，不发暗），印章换成官方**暗金**版
（暗金 `#9A7B45` 压在米黄 `#F3E7CD` 上对比度约 3.3:1，浅底上读得出）。

造型上用**圆形**底而不是圆角方底：砺蕴那枚本身就是圆印，圆底跟左边的博艺圆章
并排成「一对印」，不是两块形状各异的贴纸。底内一道品牌金细描边 + 极轻暖影。

博艺圆章（左）**不加任何底色**、原样裸摆——它本来就是蓝 + 白，浅底上读得清。

## 产出

- 网页三档：`assets/brand-plate.png` / `@2x` / `@3x`（看板顶带用；文件名不变，HTML 无需改）
- 桌面归档：`~/Desktop/砺蕴logo_五版颜色/砺蕴横版组合标_砺蕴章米黄圆底.png`

## 用法

    python3 test/make_brand_plate.py           # 出三档 + 桌面归档
    python3 test/make_brand_plate.py --sheet   # 另出配色/造型对比图到 /tmp/plate_sheet.png
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = "/Users/xielihui/Desktop/砺蕴教务系统"
BRAND = os.path.join(ROOT, "品牌运营")
FUSION = os.path.join(BRAND, "交付", "融合logo", "融合Logo_横版_透明.png")  # 博艺圆章取自这里
LY_DARK = os.path.join(BRAND, "assets", "logo_logo1_暗金.png")              # 砺蕴主标识·暗金
LY_WHITE = os.path.join(BRAND, "assets", "logo_logo1_霜白.png")
WEB = os.path.join(ROOT, "砺蕴工作台", "assets")
DESK = os.path.expanduser("~/Desktop/砺蕴logo_五版颜色/砺蕴横版组合标_砺蕴章米黄圆底.png")

# ── 定色 ──
CREAM = (243, 231, 205, 255)        # #F3E7CD 暖米黄圆底（同宣纸一族，但压得住纸）
CREAM_LINE = (190, 160, 100, 130)   # 圆底内一道品牌金细描边
SHADOW = (150, 138, 116, 36)        # 极轻暖影（在纸面上立起来一点点）
GOLD = (201, 171, 124, 255)         # 品牌金（对比图用）

# ── 版式（都按「章高」的比例算，换尺寸不用重算）──
PLATE_PAD = 0.085     # 圆底比章大多少（单边）
INSET = 0.035         # 描边距圆底边缘
STROKE = 0.006        # 描边粗细
GAP = 0.062           # 博艺圆章与砺蕴圆底之间
SS = 4                # 圆底超采样倍数（圆弧/细描边按目标尺寸画会有锯齿）

MASTER_H = 414        # 主图高度（= 3x 档）；章 354 / 圆底 414


def bbox(im):
    a = np.array(im.convert("RGBA"))
    ys, xs = np.where(a[:, :, 3] > 30)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def square(im, size):
    """取内容、按最长边装进 size×size 方盒（居中）。"""
    x0, y0, x1, y1 = bbox(im)
    c = im.crop((x0, y0, x1, y1)).convert("RGBA")
    s = size / max(c.size)
    c = c.resize((max(1, round(c.size[0] * s)), max(1, round(c.size[1] * s))), Image.LANCZOS)
    cv = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cv.alpha_composite(c, ((size - c.size[0]) // 2, (size - c.size[1]) // 2))
    return cv


def plate_of(art, S, bg=CREAM, line=CREAM_LINE, pad=PLATE_PAD,
             inset=INSET, stroke=STROKE, shadow=SHADOW, ss=SS):
    """圆形底：直径 S，板外透明，章按 pad 内缩居中。

    ⚠️ 只把**圆底**放在 ss 倍超采样下画、再降采样回来（圆弧与细描边直接按
       目标尺寸画会有锯齿）；章始终以**原生像素**贴上去，不放大再缩回。
    """
    big = Image.new("RGBA", (S * ss, S * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    d.ellipse([0, 0, S * ss - 1, S * ss - 1], fill=bg)
    if line:
        i = round(S * inset) * ss
        d.ellipse([i, i, S * ss - 1 - i, S * ss - 1 - i], outline=line,
                  width=max(ss, round(S * stroke) * ss))
    out = big.resize((S, S), Image.LANCZOS)
    inner = round(S / (1 + pad * 2))
    o = (S - inner) // 2
    out.alpha_composite(square(art, inner), (o, o))
    if shadow:
        p = 9
        sh = Image.new("RGBA", (S + p * 2, S + p * 2), (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse([p + 5, p + 7, S + p + 3, S + p + 5], fill=shadow)
        sh = sh.filter(ImageFilter.GaussianBlur(5))
        sh.alpha_composite(out, (p, p))
        return sh
    return out


def lockup(ly=LY_DARK, bg=CREAM, line=CREAM_LINE, pad=PLATE_PAD, h=MASTER_H, shadow=True):
    """整条横版标：左 = 博艺圆章（裸摆、不加底）；右 = 砺蕴印 + 圆底。"""
    inner = round(h / (1 + pad * 2))
    fusion = Image.open(FUSION).convert("RGBA")
    fw, fh = fusion.size
    boyi = square(fusion.crop((0, 0, fw // 2, fh)), inner)      # 左半就是博艺圆章
    right = plate_of(Image.open(ly).convert("RGBA"), h, bg=bg, line=line,
                     pad=pad, shadow=(SHADOW if shadow else None))
    gap = round(inner * GAP)
    W = boyi.size[0] + gap + right.size[0]
    H = max(boyi.size[1], right.size[1])
    out = Image.new("RGBA", (W + 12, H + 12), (0, 0, 0, 0))
    out.alpha_composite(boyi, (6, (H - boyi.size[1]) // 2 + 6))
    out.alpha_composite(right, (6 + boyi.size[0] + gap, (H - right.size[1]) // 2 + 6))
    x0, y0, x1, y1 = bbox(out)
    return out.crop((x0, y0, x1, y1))


def main():
    master = lockup()
    print("成品 %dx%d  宽高比 %.3f" % (master.size[0], master.size[1],
                                       master.size[0] / master.size[1]))
    for name, k in (("brand-plate@3x.png", 1.0), ("brand-plate@2x.png", 2 / 3),
                    ("brand-plate.png", 1 / 3)):
        w = max(1, round(master.size[0] * k))
        hh = max(1, round(master.size[1] * k))
        p = os.path.join(WEB, name)
        master.resize((w, hh), Image.LANCZOS).save(p, optimize=True)
        print("  -> %-22s %dx%d  %4d KB" % (name, w, hh, os.path.getsize(p) // 1024))
    master.save(DESK, "PNG")
    print("  -> 桌面归档 %s  %d KB" % (DESK, os.path.getsize(DESK) // 1024))


def sheet():
    from PIL import ImageFont
    paper = (250, 247, 240, 255)
    H = 58
    f = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 18)
    opts = [
        ("① 暖米黄圆底 + 暗金章   ← 定稿", lockup(LY_DARK, CREAM, CREAM_LINE)),
        ("② 品牌金圆底 + 霜白章", lockup(LY_WHITE, GOLD, (255, 250, 235, 135))),
        ("③ 霁蓝圆底 + 霜白章", lockup(LY_WHITE, (74, 100, 137, 255), GOLD)),
        ("④ 朱砂圆底 + 霜白章", lockup(LY_WHITE, (178, 58, 46, 255), (255, 244, 236, 120))),
        ("⑤ 米黄方底（对照：圆底更好看）", lockup(LY_DARK, CREAM, CREAM_LINE, shadow=False)),
    ]
    blocks = []
    for lab, im in opts:
        b = Image.new("RGBA", (1180, 30 + H + 12 + im.size[1] // 3), paper)
        d = ImageDraw.Draw(b)
        d.text((8, 4), lab, font=f, fill=(52, 46, 40, 255))
        b.alpha_composite(im.resize((round(im.size[0] * H / im.size[1]), H), Image.LANCZOS), (8, 30))
        b.alpha_composite(im.resize((im.size[0] // 3, im.size[1] // 3), Image.LANCZOS), (8, 30 + H + 12))
        blocks.append(b)
    gap = 20
    s = Image.new("RGBA", (1196, sum(x.size[1] + gap for x in blocks) + 12), paper)
    y = 12
    for b in blocks:
        s.alpha_composite(b, (8, y))
        y += b.size[1] + gap
    s.convert("RGB").save("/tmp/plate_sheet.png")
    print("对比图 -> /tmp/plate_sheet.png", s.size)


if __name__ == "__main__":
    if "--sheet" in sys.argv:
        sheet()
    main()
