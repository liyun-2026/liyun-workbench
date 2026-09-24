#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v28 —— 重设比例 + 五条设计语言

v27 的问题：在字体骨架上改粗细（0.095→0.135），框内空间被吃光，两格挤成两个小方块。
**加粗不等于字标化 —— 重设比例才是。**

这一版先干一件正经事：把「声」的骨架**按图标重新设计**——
  t=0.128、四横重新等距、框加深到 0.31（孔才撑得住 44px）、撇加长。
然后再谈"设计动作"，而且这次是五条**不同的设计语言**，不是同一个形的微调：

  R     重字标        —— 新比例，干净、专业（"得到 / 喜茶"那一路）
  Rspine 中轴贯穿     —— 上竖与下框中竖本是同一条线，连成一根脊梁
  Rflow  左侧一笔到底 —— 左竖一路弯下去变撇，整条左边是一道弧
  Rflat  矩形化       —— 四横左右齐边，字变成一个规整的块（最"图标"）
  box    实心双孔     —— 下半直接做成"扬声器正面"：整块实心 + 两个负空间孔
  min    极简         —— 只留最能识字的骨架
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from icon_v18 import rrect, union, punched, poly_mask
from icon_v21 import place
from icon_v26 import taper, U, V, FW, mono, font

W = 512

# ═══════════════ 重设后的骨架（这一版的地基） ═══════════════
G = dict(
    t=0.128,
    H1=0.130, H2=0.336, H3=0.508, H4=0.812,   # 四横轴线（重新等距）
    FL=0.150, FR=0.850, VM=0.500, TOP=0.500,
    H1U=(0.058, 0.942), H2U=(0.118, 0.882),   # 横的左右端
    FRAMEU=(0.150, 0.850),                    # 框的左右端
    top0=0.024,                                # 上竖的顶端
    top1=0.400,                                # 上竖的下端
    vl1=0.876, vr1=0.905,                      # 左右竖伸出框底到哪（轴线）
    pl=(0.150, 0.876),                         # 撇的起点
    p2=(0.098, 0.936), p3=(0.036, 0.984),      # 撇的中间点 / 终点
    spine=False, flowL=False,
    solid=False, solid_n=2, solid_v=(0.470, 0.900), solid_u=(0.112, 0.888),
    drop_h2=False, drop_vm=False,
)


def hbar(v, u0, u1, t):
    return rrect(W, U((u0 + u1) / 2), V(v), (u1 - u0) * FW, t * FW,
                 min((u1 - u0) * FW, t * FW) * 0.4995)


def vbar(u, v0, v1, t):
    return rrect(W, U(u), V((v0 + v1) / 2), t * FW, (v1 - v0) * FW,
                 min(t * FW, (v1 - v0) * FW) * 0.4995)


def build(**kw):
    s = dict(G)
    s.update(kw)
    t = s['t']
    H1, H2, H3, H4 = s['H1'], s['H2'], s['H3'], s['H4']
    FL, FR, VM, TOP = s['FL'], s['FR'], s['VM'], s['TOP']
    fl, fr = s['FRAMEU']
    parts = []

    # 上半「士」
    parts.append(hbar(H1, *s['H1U'], t))
    if not s['drop_h2']:
        parts.append(hbar(H2, *s['H2U'], t))
    parts.append(vbar(TOP, s['top0'], H4 + t / 2 if s['spine'] else s['top1'], t))

    # 下半
    if s['solid']:
        u0, u1 = s['solid_u']
        v0, v1 = s['solid_v']
        blk = rrect(W, U((u0 + u1) / 2), V((v0 + v1) / 2), (u1 - u0) * FW, (v1 - v0) * FW,
                    (v1 - v0) * FW * 0.20)
        n = s['solid_n']
        gap = 0.070
        inner_u = (u0 + t / 2 + 0.026, u1 - t / 2 - 0.026)
        inner_v = (v0 + 0.052, v1 - 0.052)
        hw = ((inner_u[1] - inner_u[0]) - gap * (n - 1)) / n
        holes = []
        for i in range(n):
            cu = inner_u[0] + hw / 2 + i * (hw + gap)
            holes.append(rrect(W, U(cu), V((inner_v[0] + inner_v[1]) / 2),
                               hw * FW, (inner_v[1] - inner_v[0]) * FW,
                               min(hw, inner_v[1] - inner_v[0]) * FW * 0.30))
        parts.append(punched(blk, union(*holes)))
    else:
        parts += [hbar(H3, *s['FRAMEU'], t), hbar(H4, *s['FRAMEU'], t)]
        parts.append(vbar(FR, H3 - t / 2, s['vr1'], t))
        if not s['drop_vm']:
            parts.append(vbar(VM, H3 - t / 2, H4 + t / 2, t))
        if s['flowL']:
            pts = [(FL, H3 - t / 2), (FL, 0.620), (FL - 0.006, 0.740),
                   (0.108, 0.858), (0.058, 0.936), s['p3']]
            parts.append(taper(pts, t, t * 0.30, wbreak=(0.66, 1.0)))
        else:
            parts.append(vbar(FL, H3 - t / 2, s['vl1'], t))
            parts.append(taper([s['pl'], s['p2'], s['p3']], t, t * 0.34))
    parts.extend(s.get('extra', ()))
    return union(*parts)


def flat(**kw):
    """矩形化：四横左右齐边 —— 字变成一个规整的块。"""
    kw.setdefault('H1U', (0.058, 0.942))
    kw['H2U'] = (0.058, 0.942)
    kw['FRAMEU'] = (0.058, 0.942)
    return build(**kw)


def sheet(items, path, cols=3, cell=380):
    rows = (len(items) + cols - 1) // cols
    cv = Image.new('RGB', (cols * cell, rows * (cell + 30)), (24, 24, 29))
    d = ImageDraw.Draw(cv)
    f = font(int(cell * 0.048))
    for i, (lab, im) in enumerate(items):
        r, c = divmod(i, cols)
        x, y = c * cell, r * (cell + 30)
        cv.paste(mono(im, cell), (x, y))
        d.text((x + 10, y + cell + 7), lab, font=f, fill=(228, 228, 236))
    cv.save(path)
    return path


def main():
    print('v28 重设比例 …')
    cands = [
        ('01 重字标（新比例）', build()),
        ('02 中轴贯穿', build(spine=True)),
        ('03 左侧一笔到底', build(flowL=True)),
        ('04 矩形化（四横齐边）', flat()),
        ('05 实心双孔', build(solid=True)),
        ('06 实心三孔', build(solid=True, solid_n=3)),
        ('07 中轴＋左弧', build(spine=True, flowL=True)),
        ('08 极简（去下横＋去中竖）', build(drop_h2=False, drop_vm=True)),
        ('09 矩形化＋中轴贯穿', flat(spine=True)),
    ]
    items = [(lab, place(W, m)) for lab, m in cands]
    sheet(items, os.path.join(REVIEW, '图标v28_九案_A.png'), cols=3, cell=400)

    sizes = [44, 92, 140]
    CW, CH = 165, 172
    cv = Image.new('RGB', (CW * len(sizes), CH * len(items)), (24, 24, 29))
    d = ImageDraw.Draw(cv)
    f = font(16)
    for r, (lab, im) in enumerate(items):
        for c, s in enumerate(sizes):
            cv.paste(mono(im, s), (c * CW + (CW - s) // 2, r * CH + (CH - s) // 2 + 8))
        d.text((6, r * CH + 2), lab[:14], font=f, fill=(230, 230, 238))
    cv.save(os.path.join(REVIEW, '图标v28_小尺寸.png'))
    print('→ 图标v28_九案_A.png / 图标v28_小尺寸.png')


if __name__ == '__main__':
    main()
