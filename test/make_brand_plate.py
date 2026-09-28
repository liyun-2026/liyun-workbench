#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""看板品牌标：博艺圆章**原样裸摆**，砺蕴印章压在「暖米黄圆底」上；**两枚等径**。

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

## 两枚要一样大（2026-09-29 加）

用户：「这两个 logo 要一样大，不能你大我小，它俩是一样的，那就把博艺这个 logo
也放大，放成一样大。」

🔴 病根不在尺寸参数，在**量错了边**：融合标左半画布在博艺圆章右侧还留着一撮
alpha 60~120 的**淡色残影**（x 543..639，97px 宽）。老写法 `square()` 拿整块
bbox 的最长边（623px）当基准去缩，圆章实体只有 526px —— 于是被压成 76%，
屏上 300px，而砺蕴那枚（米黄圆底）是 414px，差 38%。
现在 `emblem()` 用 alpha 卡出**实体**（526×526 正圆，断言校验）再缩，
两枚都以 `h` 为直径 → 结构上就等大，不靠调参凑。

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

# ── 版式（都按「圆径」的比例算，换尺寸不用重算）──
PLATE_PAD = 0.085     # 砺蕴印章比圆底小多少（单边）
GAP = 0.20            # 两枚圆之间的净空隙（≈ 原版 28px @1x 的观感）
INSET = 0.035         # 描边距圆底边缘
STROKE = 0.006        # 描边粗细
SS = 4                # 圆底超采样倍数（圆弧/细描边按目标尺寸画会有锯齿）
SHADOW_PAD = 9        # 圆底画布留的透明边（够阴影铺开，裁切时再去掉）
EMBLEM_THR = 200      # 从融合标里抠博艺圆章的 alpha 门槛（残影在 60~120，卡得掉）

MASTER_H = 414        # 主图高度 = **两枚共同的直径**（= @3x 档）


def emblem(size):
    """博艺圆章：融合标**左半的实体**缩到直径 = size。

    ⚠️ 别按「左半画布 bbox」量边 —— 圆章右侧有一撮 alpha 60~120 的淡色残影
       （x 543..639，97px），会把最长边从 526 虚撑到 623，圆章就被压成 76%。
       用户报的「你大我小」就是这个。用 alpha > EMBLEM_THR 卡出实体。
    """
    a = np.array(Image.open(FUSION).convert("RGBA"))
    half = a[:, :a.shape[1] // 2, :]
    ys, xs = np.where(half[:, :, 3] > EMBLEM_THR)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    w, h = x1 - x0, y1 - y0
    assert abs(w - h) <= max(4, w * 0.02), "博艺圆章该是正圆，抠出来却是 %d×%d" % (w, h)
    return Image.fromarray(half[y0:y1, x0:x1]).resize((size, size), Image.LANCZOS)


def plate_of(art, S, bg=CREAM, line=CREAM_LINE, pad=PLATE_PAD,
             inset=INSET, stroke=STROKE, shadow=SHADOW, ss=SS):
    """圆形底：直径 S，板外透明，章按 pad 内缩居中。

    返回画布恒为 (S + 2*SHADOW_PAD)²，圆盘居中 —— 这样调用方裁
    (SHADOW_PAD, SHADOW_PAD, +S, +S) 就能精确拿到圆盘本体。

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
    src = art.convert("RGBA")
    x0, y0, x1, y1 = _visible(src)
    src = src.crop((x0, y0, x1, y1))
    k = inner / max(src.size)
    src = src.resize((max(1, round(src.size[0] * k)), max(1, round(src.size[1] * k))),
                     Image.LANCZOS)
    out.alpha_composite(src, (o + (inner - src.size[0]) // 2,
                              o + (inner - src.size[1]) // 2))
    p = SHADOW_PAD
    if shadow:
        sh = Image.new("RGBA", (S + p * 2, S + p * 2), (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse([p + 5, p + 7, S + p + 3, S + p + 5], fill=shadow)
        sh = sh.filter(ImageFilter.GaussianBlur(5))
        sh.alpha_composite(out, (p, p))
        return sh
    canvas = Image.new("RGBA", (S + p * 2, S + p * 2), (0, 0, 0, 0))
    canvas.alpha_composite(out, (p, p))
    return canvas


def _visible(im, thr=30):
    """可见主体（alpha > thr）的外接框；空图返回整幅。"""
    a = np.array(im.convert("RGBA"))
    ys, xs = np.where(a[:, :, 3] > thr)
    if not len(xs):
        return 0, 0, im.size[0], im.size[1]
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def lockup(ly=LY_DARK, bg=CREAM, line=CREAM_LINE, pad=PLATE_PAD, h=MASTER_H, shadow=True):
    """整条横版标：左 = 博艺圆章（裸摆、不加底）；右 = 砺蕴印 + 米黄圆底。

    **两枚等径**：都以 h 为直径。左枚没有底，一枚圆章铺满整个 h；右枚的 h 是那块
    圆底的直径（印本体 h/(1+2*pad)，底托着印）。拼装时两块都取**裁紧后的实体**，
    所以中间的净空隙 = gap，量出来就是设计值。
    """
    S = h                                                       # 两枚共同的直径
    boyi = emblem(S)
    padded = plate_of(Image.open(ly).convert("RGBA"), S, bg=bg, line=line,
                      pad=pad, shadow=(SHADOW if shadow else None))
    right = padded.crop((SHADOW_PAD, SHADOW_PAD, SHADOW_PAD + S, SHADOW_PAD + S))
    gap = round(S * GAP)
    out = Image.new("RGBA", (S + gap + S, S), (0, 0, 0, 0))
    out.alpha_composite(boyi, (0, 0))
    out.alpha_composite(right, (S + gap, 0))
    return out


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
        ("① 暖米黄圆底 + 暗金章   ← 定稿（两枚等径）", lockup(LY_DARK, CREAM, CREAM_LINE)),
        ("② 品牌金圆底 + 霜白章", lockup(LY_WHITE, GOLD, (255, 250, 235, 135))),
        ("③ 霁蓝圆底 + 霜白章", lockup(LY_WHITE, (74, 100, 137, 255), GOLD)),
        ("④ 朱砂圆底 + 霜白章", lockup(LY_WHITE, (178, 58, 46, 255), (255, 244, 236, 120))),
        ("⑤ 定稿但去掉极轻暖影（对照：会显得贴不住纸）", lockup(LY_DARK, CREAM, CREAM_LINE, shadow=False)),
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
