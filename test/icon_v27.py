#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v27 —— 「声」的设计动作

v26 的六案给我自己判了个死刑：
  ✅ 02 几何重画 —— 干净，但"干净"＝平庸，就是把字写圆了
  ❌ 03 双撇回声 —— 变成划痕和碎点
  ❌ 05 切片错位 —— 字被切碎，像图片加载失败
  ❌ 06 负形波 —— 像被划了一刀
  ~  04 横向振动 —— 像手抖

结论：**"把字扭曲"不是字标设计。** 真正的字标设计（也是博艺那枚的做法）是三件事：
  ① 简化 —— 砍掉多余的笔画与结构
  ② 优化 —— 重定骨架比例：粗细 / 间距 / 重心 / 端头
  ③ 变形 —— 给某一笔一个"设计动作"，让它成为这个字独一份的特征

所以这一版只做**建设性**的动作：
  A geo    重画底（对照）
  B spine  中轴 —— 上部中竖与下框中竖本是同一条线，把它连成一根贯穿到底的脊梁
  C flowL  左侧一笔到底 —— 左竖不再只是竖，一路弯下去变成撇，整条左边是一道弧
  D bold   加重 —— 笔画加粗到 0.135，从"字体"变成"字标"（重字标才有图标的分量）
  E ital   斜切 8° —— 给静态的字一个速度
  F solid  下部实心 ＋ 负空间双孔 —— 上轻下重的尺度对比
  G hero   组合：spine + flowL + bold（把三个最好的动作叠在一起）
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from icon_v18 import circle_mask, rrect, poly_mask, union, punched, ZH_FONT
from icon_v21 import place
from icon_v26 import taper, U, V, FW, T as T0, she_raw, mono, font

W = 512

# ═══════════════════ 一套可覆盖的规格 ═══════════════════
SPEC = dict(
    t=0.095,                     # 笔画粗细
    H1=0.142, H2=0.315, H3=0.470, H4=0.665,     # 四横的轴线
    FL=0.155, FR=0.852,          # 下部框左右竖
    VM=0.500, TOP=0.500,         # 中竖（上下两段同一条线）
    top_end=0.362,               # 上中竖的下端
    spine=False,                 # 上中竖是否贯穿到下框
    vl_end=0.720, vr_end=0.775,  # 左右竖伸出框底的长度
    vh_end=None,                 # 中竖下端（None = 到框底）
    flowL=False,                 # 左侧一笔到底（左竖＋撇合成一道弧）
    swash=1.0,                   # 撇的长度系数
)


def hbar(v, u0, u1, t):
    return rrect(W, U((u0 + u1) / 2), V(v), (u1 - u0) * FW, t * FW,
                 min((u1 - u0) * FW, t * FW) * 0.5 * 0.995)


def vbar(u, v0, v1, t):
    return rrect(W, U(u), V((v0 + v1) / 2), t * FW, (v1 - v0) * FW,
                 min(t * FW, (v1 - v0) * FW) * 0.5 * 0.995)


def build(**kw):
    s = dict(SPEC)
    s.update(kw)
    t, FL, FR, VM, TOP = s['t'], s['FL'], s['FR'], s['VM'], s['TOP']
    H1, H2, H3, H4 = s['H1'], s['H2'], s['H3'], s['H4']
    bl, br = FL - t / 2, FR + t / 2
    parts = []
    if s.get('solid'):
        # 下部整块实心（圆角），再挖两个孔 —— 上轻下重
        blk = rrect(W, U((bl + br) / 2), V((H3 + H4) / 2),
                    (br - bl) * FW, (H4 - H3 + t) * FW, (H4 - H3 + t) * FW * 0.17)
        ih = (H4 - H3 - t) - 0.048
        iw = (VM - t / 2 - 0.030) - (FL + t / 2 + 0.030)
        holes = []
        for cu in ((FL + t / 2 + 0.030 + iw / 2), (VM + t / 2 + 0.030 + iw / 2)):
            holes.append(rrect(W, U(cu), V((H3 + H4) / 2), iw * FW, ih * FW, ih * FW * 0.16))
        parts.append(punched(blk, union(*holes)))
    else:
        parts += [hbar(H3, bl, br, t), hbar(H4, bl, br, t),
                  vbar(FL, H3 - t / 2, s['vl_end'] if not s.get('flowL') else H3 + 0.02, t),
                  vbar(FR, H3 - t / 2, s['vr_end'], t),
                  vbar(VM, H3 - t / 2, s['vh_end'] or (H4 + t / 2), t)]

    parts += [hbar(H1, 0.045, 0.955, t), hbar(H2, 0.105, 0.905, t)]
    # 上中竖：spine 时一直连到下框底
    parts.append(vbar(TOP, 0.000, H4 + t / 2 if s.get('spine') else s['top_end'], t))

    # 撇：flowL 时与左竖合成一道连续的弧
    if s.get('flowL'):
        pts = [(FL, H3 + 0.01), (FL, 0.560), (FL - 0.008, 0.690),
               (0.118, 0.822), (0.062, 0.930), (0.038, 0.972 * s['swash'])]
        parts.append(taper(pts, t, t * 0.26, wbreak=(0.72, 1.0)))
    else:
        pts = [(FL, 0.700), (0.128, 0.858), (0.048, 0.968 * s['swash'])]
        parts.append(taper(pts, t, t * 0.30))
    parts.extend(s.get('extra', ()))
    return union(*parts)


def ital(mask, deg=8.0):
    k = math.tan(math.radians(deg))
    return mask.transform((W, W), Image.AFFINE, (1, k, -k * W / 2, 0, 1, 0),
                          resample=Image.BILINEAR).point(lambda v: 255 if v >= 120 else 0)


# ═══════════════════ 出图 ═══════════════════
def sheet(items, path, cols=4, cell=360):
    rows = (len(items) + cols - 1) // cols
    cv = Image.new('RGB', (cols * cell, rows * (cell + 28)), (24, 24, 29))
    d = ImageDraw.Draw(cv)
    f = font(int(cell * 0.048))
    for i, (lab, im) in enumerate(items):
        r, c = divmod(i, cols)
        x, y = c * cell, r * (cell + 28)
        cv.paste(mono(im, cell), (x, y))
        d.text((x + 10, y + cell + 6), lab, font=f, fill=(228, 228, 236))
    cv.save(path)
    return path


def main():
    print('v27 设计动作 …')
    B = dict(t=0.135, H3=0.452, H4=0.696, FL=0.150, FR=0.856)   # 加重版的框要加深
    cands = [
        ('A 重画底',        build()),
        ('B 中轴贯穿',      build(spine=True)),
        ('C 左侧一笔到底',  build(flowL=True)),
        ('D 加粗重体',      build(**B)),
        ('E 斜切 8°',       ital(build())),
        ('F 下部实心双孔',  build(**B, solid=True)),
        ('G 合体（中轴＋左弧＋加粗）', build(**B, spine=True, flowL=True)),
        ('H 合体＋斜切',    ital(build(**B, spine=True, flowL=True))),
    ]
    items = [(lab, place(W, m)) for lab, m in cands]
    sheet(items, os.path.join(REVIEW, '图标v27_八案_A.png'), cols=4, cell=380)

    # 小尺寸
    sizes = [44, 92, 140]
    CW, CH = 170, 175
    cv = Image.new('RGB', (CW * len(sizes), CH * len(items)), (24, 24, 29))
    d = ImageDraw.Draw(cv)
    f = font(17)
    for r, (lab, im) in enumerate(items):
        for c, s in enumerate(sizes):
            cv.paste(mono(im, s), (c * CW + (CW - s) // 2, r * CH + (CH - s) // 2 + 8))
        d.text((6, r * CH + 2), lab, font=f, fill=(230, 230, 238))
    cv.save(os.path.join(REVIEW, '图标v27_小尺寸.png'))
    print('→ 图标v27_八案_A.png / 图标v27_小尺寸.png')


if __name__ == '__main__':
    main()
