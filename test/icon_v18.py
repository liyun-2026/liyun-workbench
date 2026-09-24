#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v18 —— 母题重探

为什么又推倒
============
v1~v17 全被打回，共同点是：**始终在「声波 / 圆盘 / 话筒」这一小块地方
换排列组合**（三柱、五柱、山岳、唱盘、螺旋、字标……本质都是同一族形）。
横着铺 12 版没有用，因为可选空间本身就是窄的。

所以 v18 换做法：**先把「母题」铺开**——
把「砺 / 蕴 / 逐声」三件事，拆成 22 个互不相同的图形母题，
统一笔法、统一尺寸画出来，先选母题，再谈精修。

母题分五族：
  声（1~5）   声音长什么样
  石（6~10）  砺＝磨石
  蕴（11~13） 蕴＝积蕴
  逐（14~17） 追声的动作
  器·字（18~22）器物与字形

用法
----
  python3 test/icon_v18.py             # 出母题总览 + 四个精选完成品
  python3 test/icon_v18.py --pick=11   # 把某个母题做成正式图标（会提 VERSION）

⚠️ 换图标后必须把 sw.js 的 VERSION 提一档，否则手机上不换。
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import PALETTES, tile, disc_color, far_radius   # 复用同一套材质引擎

SS = 4
SAFE = 0.400
ZH_FONT = '/System/Library/Fonts/StHeiti Medium.ttc'


# ═══════════════════════ 基础绘制（全部归一化 0~1） ═══════════════════════
def circle_mask(W, cx, cy, r):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).ellipse([(cx - r) * W, (cy - r) * W, (cx + r) * W, (cy + r) * W], fill=255)
    return m


def ellipse_mask(W, cx, cy, rx, ry):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).ellipse([(cx - rx) * W, (cy - ry) * W, (cx + rx) * W, (cy + ry) * W], fill=255)
    return m


def rrect(W, cx, cy, w, h, rad):
    m = Image.new('L', (W, W), 0)
    x0, y0, x1, y1 = (cx - w / 2) * W, (cy - h / 2) * W, (cx + w / 2) * W, (cy + h / 2) * W
    r = min(rad * W, (x1 - x0) / 2 * 0.998, (y1 - y0) / 2 * 0.998)
    ImageDraw.Draw(m).rounded_rectangle([x0, y0, x1, y1], radius=max(r, 0.0), fill=255)
    return m


def poly_mask(W, pts, soft=0.008):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).polygon([(x * W, y * W) for x, y in pts], fill=255)
    if soft:
        m = m.filter(ImageFilter.GaussianBlur(W * soft)).point(lambda v: 255 if v >= 128 else 0)
    return m


def stroke(W, pts, width, caps=True):
    """等宽折线笔画。逐段四边形 + 节点补圆 —— PIL 的 line(width=) 在折角处会出毛刺。"""
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    hw = width * W / 2.0
    P = [(x * W, y * W) for x, y in pts]
    for i in range(len(P) - 1):
        x0, y0 = P[i]; x1, y1 = P[i + 1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1e-6
        nx, ny = -dy / L * hw, dx / L * hw
        d.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill=255)
    if caps:
        for x, y in P:
            d.ellipse([x - hw, y - hw, x + hw, y + hw], fill=255)
    return m


def stroke_var(W, pts, widths, caps=True):
    """变宽笔画。widths 与 pts 等长（归一化宽度）。"""
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    P = [(x * W, y * W) for x, y in pts]
    Wd = [w * W for w in widths]
    for i in range(len(P) - 1):
        x0, y0 = P[i]; x1, y1 = P[i + 1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1e-6
        h0, h1 = Wd[i] / 2, Wd[i + 1] / 2
        nx, ny = -dy / L, dx / L
        d.polygon([(x0 + nx * h0, y0 + ny * h0), (x1 + nx * h1, y1 + ny * h1),
                   (x1 - nx * h1, y1 - ny * h1), (x0 - nx * h0, y0 - ny * h0)], fill=255)
    if caps:
        for (x, y), h in zip(P, Wd):
            d.ellipse([x - h / 2, y - h / 2, x + h / 2, y + h / 2], fill=255)
    return m


def arc_band(W, cx, cy, r_in, r_out, a0, a1, steps=90):
    """弧带（外径 r_out、内径 r_in，角度用度）。"""
    m = Image.new('L', (W, W), 0)
    ao = [math.radians(a0 + (a1 - a0) * i / steps) for i in range(steps + 1)]
    pts = [((cx + r_out * math.cos(a)) * W, (cy + r_out * math.sin(a)) * W) for a in ao]
    pts += [((cx + r_in * math.cos(a)) * W, (cy + r_in * math.sin(a)) * W) for a in reversed(ao)]
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m


def wedge(W, cx, cy, r, a0, a1, steps=60):
    m = Image.new('L', (W, W), 0)
    pts = [(cx * W, cy * W)]
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        pts.append(((cx + r * math.cos(a)) * W, (cy + r * math.sin(a)) * W))
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m


def text_mask(W, ch, ratio=0.66):
    m = Image.new('L', (W, W), 0)
    f = ImageFont.truetype(ZH_FONT, int(W * ratio))
    d = ImageDraw.Draw(m)
    bb = d.textbbox((0, 0), ch, font=f)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    d.text((W / 2 - w / 2 - bb[0], W / 2 - h / 2 - bb[1]), ch, font=f, fill=255)
    return m


def _b(a):
    return np.asarray(a, dtype=np.int16)


def union(*masks):
    out = _b(masks[0])
    for m in masks[1:]:
        out = np.maximum(out, _b(m))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'L')


def punched(shape, cut):
    return Image.fromarray(np.clip(_b(shape) - _b(cut), 0, 255).astype(np.uint8), 'L')


# ═══════════════════════════ 22 个母题 ═══════════════════════════
def mo_sound(W):
    """01 立浪 —— 一道粗壮声浪竖向贯穿，中段摆动很小（摆大了就成蛇）。"""
    pts = [(0.50, 0.825), (0.50, 0.720), (0.420, 0.600), (0.580, 0.430), (0.500, 0.305), (0.500, 0.175)]
    return stroke(W, pts, 0.138)


def mo_zigzag(W):
    """02 折浪 —— 声音最通用的写法（心电图），中段振幅最大。"""
    return stroke(W, [(0.18, 0.63), (0.34, 0.36), (0.50, 0.63), (0.66, 0.36), (0.82, 0.63)], 0.098)


def mo_arc(W):
    """03 声弧 —— 一道自下方扬起的厚弧，像声浪的拱起。"""
    return arc_band(W, 0.50, 0.800, 0.315, 0.435, -150, -30)


def mo_packet(W):
    """04 波包 —— 一束声音的「包络」：中段饱满、两端收束。"""
    n = 13
    pts = [(0.50 + 0.040 * math.sin(math.pi * i / (n - 1)), 0.190 + 0.620 * i / (n - 1)) for i in range(n)]
    ws = [0.078 + 0.098 * math.sin(math.pi * i / (n - 1)) for i in range(n)]
    return stroke_var(W, pts, ws)


def mo_grow(W):
    """05 振幅渐增 —— 从左到右越走越大，练声「由弱到强」。"""
    n = 45
    pts, ws = [], []
    for i in range(n):
        t = i / (n - 1)
        amp = 0.010 + 0.078 * t
        pts.append((0.185 + 0.630 * t, 0.525 - amp * math.sin(t * math.pi * 2.7)))
        ws.append(0.052 + 0.058 * t)
    return stroke_var(W, pts, ws)


def mo_stone(W):
    """06 砺石 —— 一块不规则的圆润砺石（唯一的「非几何」外形）。"""
    R = [0.312, 0.288, 0.306, 0.278, 0.300, 0.276, 0.298, 0.282, 0.308, 0.286, 0.302]
    n = len(R)
    pts = [(0.50 + R[i] * math.cos(2 * math.pi * i / n + 0.35),
            0.52 + R[i] * math.sin(2 * math.pi * i / n + 0.35)) for i in range(n)]
    return poly_mask(W, pts, soft=0.020)


def _blob(W, cx, cy, r, phase=0.0, n=9, soft=0.012):
    """不规则圆润块（石头）。正弦扰动轮廓 —— 圆得太规则就没有石头的味道。"""
    R = [1.06, 0.94, 1.03, 0.92, 1.00, 0.93, 1.04, 0.96, 1.02][:n]
    pts = [(cx + r * R[i] * math.cos(2 * math.pi * i / n + phase),
            cy + r * R[i] * math.sin(2 * math.pi * i / n + phase)) for i in range(n)]
    return poly_mask(W, pts, soft=soft)


def mo_stack_stone(W):
    """07 叠石 —— 两块砺石相叠，磨了又磨、一层压一层。"""
    return union(_blob(W, 0.498, 0.660, 0.175, 0.30), _blob(W, 0.520, 0.360, 0.125, 1.10))


def mo_crack(W):
    """08 砺石开缝 —— 石上一道裂缝，声从缝里出来。"""
    s = mo_stone(W)
    c = stroke(W, [(0.47, 0.17), (0.53, 0.39), (0.44, 0.57), (0.53, 0.83)], 0.058)
    return punched(s, c)


def mo_chisel(W):
    """09 凿点 —— 一凿落下，石面迸出六道。"""
    base = circle_mask(W, 0.50, 0.53, 0.300)
    rays = []
    for k in range(6):
        a = -math.pi / 2 + k * math.pi / 3
        rays.append(stroke(W, [(0.50 + 0.058 * math.cos(a), 0.53 + 0.058 * math.sin(a)),
                               (0.50 + 0.262 * math.cos(a), 0.53 + 0.262 * math.sin(a))], 0.052))
    return punched(base, union(*rays))


def mo_grind(W):
    """10 磨面 —— 石上留下两道斜磨痕，一笔一笔磨出来的。"""
    base = circle_mask(W, 0.50, 0.52, 0.300)
    t = math.tan(math.radians(-38))
    marks = []
    for c in (-0.115, 0.115):
        marks.append(stroke(W, [(0.08, 0.52 + (0.08 - 0.5) * t + c),
                                (0.92, 0.52 + (0.92 - 0.5) * t + c)], 0.082))
    return punched(base, union(*marks))


def mo_pagoda(W):
    """11 叠山 —— 四层由下往上收，练萃积蕴、层层成山。"""
    parts = []
    for i, w in enumerate((0.620, 0.490, 0.360, 0.230)):
        parts.append(rrect(W, 0.50, 0.700 - i * 0.175, w, 0.092, 0.046))
    return union(*parts)


def mo_ink(W):
    """12 墨团 —— 一滴墨落纸，浓处成团（蕴＝积）。"""
    blobs = [(0.00, 0.00, 0.200), (-0.135, 0.065, 0.128), (0.140, 0.050, 0.122),
             (0.030, -0.145, 0.128), (-0.070, -0.105, 0.100), (0.075, 0.150, 0.112)]
    return union(*[circle_mask(W, 0.50 + dx, 0.52 + dy, r) for dx, dy, r in blobs])


def mo_strata(W):
    """13 层岩 —— 三层岩层左对齐、逐层收短，是剖面的样子。"""
    parts = []
    for i, w in enumerate((0.600, 0.475, 0.350)):
        parts.append(rrect(W, 0.20 + w / 2, 0.700 - i * 0.185, w, 0.102, 0.051))
    return union(*parts)


def mo_echo(W):
    """14 回声环 —— 一环留口，缺口里还留着一小段没散尽的声。"""
    ring = punched(circle_mask(W, 0.50, 0.52, 0.338), circle_mask(W, 0.50, 0.52, 0.248))
    ring = punched(ring, wedge(W, 0.50, 0.52, 0.44, -88, -22))
    inner = arc_band(W, 0.50, 0.52, 0.262, 0.318, -80, -38)
    return union(ring, inner)


def mo_rise(W):
    """15 上升折线 —— 由平到扬，一条线拐上去。"""
    return stroke(W, [(0.260, 0.685), (0.460, 0.685), (0.755, 0.325)], 0.112)


def mo_spread(W):
    """16 双翼 —— 自一点向上张开，追逐声的形状。"""
    return union(stroke(W, [(0.500, 0.800), (0.250, 0.270)], 0.105),
                 stroke(W, [(0.500, 0.800), (0.750, 0.270)], 0.105))


def mo_cone(W):
    """17 声锥 —— 一点声源向上散开成面。"""
    return poly_mask(W, [(0.415, 0.775), (0.585, 0.775), (0.755, 0.245), (0.245, 0.245)], soft=0.018)


def mo_chime(W):
    """18 磬 —— 中国最古的石制乐器，折角悬挂。砺＝石，磬＝石之声。"""
    return stroke(W, [(0.225, 0.685), (0.500, 0.290), (0.775, 0.685)], 0.105)


def mo_gate(W):
    """19 声之门 —— 一个口子，声从框里透出来。系统入口的意思。"""
    frame = punched(rrect(W, 0.50, 0.520, 0.630, 0.630, 0.155),
                    rrect(W, 0.50, 0.520, 0.450, 0.450, 0.100))
    wave = stroke(W, [(0.360, 0.650), (0.440, 0.545), (0.560, 0.545), (0.640, 0.430)], 0.090)
    return union(frame, wave)


def mo_inkstone(W):
    """20 砚 —— 圆砚开方池，磨墨积蕴的地方。"""
    ring = punched(circle_mask(W, 0.50, 0.520, 0.338), circle_mask(W, 0.50, 0.520, 0.248))
    return union(ring, rrect(W, 0.50, 0.520, 0.240, 0.240, 0.065))


def mo_sheng(W):
    """21 声字 —— 只七画的「声」，一个字的图形。"""
    return text_mask(W, '声', 0.615)


def mo_li(W):
    """22 砺字 —— 「砺」，形声字，从石。"""
    return text_mask(W, '砺', 0.590)


def mo_peaks(W):
    """23 声之峰 —— 实心块：底是石，顶是声。山与声长在同一个形上，不是并排摆。"""
    n = 260
    x0, x1, base = 0.215, 0.785, 0.620
    pts = []
    for i in range(n + 1):
        t = i / n
        env = 0.70 + 0.30 * math.sin(math.pi * t)                  # 中峰最高
        h = 0.250 * env * abs(math.sin(3 * math.pi * t)) ** 1.5
        pts.append((x0 + (x1 - x0) * t, base - h))
    pts += [(x1, base + 0.135), (x0, base + 0.135)]
    return poly_mask(W, pts, soft=0.010)


def mo_waveblock(W):
    """24 山峦 —— 连绵起伏的一列山脊，声浪的模样（峰高不等，才像山不像皇冠）。"""
    n = 320
    x0, x1, base = 0.205, 0.795, 0.700
    peaks = [(0.11, 0.170), (0.30, 0.255), (0.52, 0.205), (0.74, 0.275), (0.93, 0.155)]
    pts = []
    for i in range(n + 1):
        t = i / n
        y = base
        for (pt_, ph) in peaks:
            d = abs(t - pt_)
            if d < 0.20:
                y = min(y, base - ph * math.cos(d / 0.20 * math.pi / 2) ** 1.35)
        pts.append((x0 + (x1 - x0) * t, y))
    pts += [(x1, base + 0.055), (x0, base + 0.055)]
    return poly_mask(W, pts, soft=0.010)


FAMILY = {
    '声': [1, 2, 3, 4, 5, 23, 24],
    '石': [6, 7, 8, 9, 10],
    '蕴': [11, 12, 13],
    '逐': [14, 15, 16, 17],
    '器·字': [18, 19, 20, 21, 22],
}

MOTS = [
    (1, '贯穿浪', mo_sound), (2, '折浪', mo_zigzag), (3, '声弧', mo_arc),
    (4, '波包', mo_packet), (5, '振幅渐增', mo_grow),
    (6, '砺石', mo_stone), (7, '叠石', mo_stack_stone), (8, '砺石开缝', mo_crack),
    (9, '凿点', mo_chisel), (10, '磨面', mo_grind),
    (11, '叠山', mo_pagoda), (12, '墨团', mo_ink), (13, '层岩', mo_strata),
    (14, '回声环', mo_echo), (15, '上升折线', mo_rise), (16, '双翼', mo_spread),
    (17, '声锥', mo_cone),
    (18, '磬', mo_chime), (19, '声之门', mo_gate), (20, '砚', mo_inkstone),
    (21, '声字', mo_sheng), (22, '砺字', mo_li),
    (23, '声之峰', mo_peaks), (24, '山峦', mo_waveblock),
]


def motif_mask(W, idx):
    for i, _, fn in MOTS:
        if i == idx:
            return fn(W)
    raise KeyError(idx)


# ═══════════════════════ 渲染：母题总览（看形态） ═══════════════════════
def sheet():
    cols, cw, ch = 4, 300, 322
    rows = math.ceil(len(MOTS) / cols)
    W = 60 * 2 + cols * cw
    H = 168 + rows * ch + 40
    cv = Image.new('RGB', (W, H), (243, 241, 236))
    d = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 34); f2 = ImageFont.truetype(ZH_FONT, 20)
    f3 = ImageFont.truetype(ZH_FONT, 17); f4 = ImageFont.truetype(ZH_FONT, 15)
    INK = (32, 30, 27)

    d.text((60, 30), '砺蕴 · 桌面图标 · 母题重探（22 个）', font=f1, fill=INK)
    d.text((60, 80), '先选「母题」——哪几个形对；选定后再谈配色与精修。符号统一笔法、统一尺寸，便于比。',
           font=f2, fill=(108, 102, 94))

    fam_color = {'声': (176, 108, 56), '石': (86, 96, 116), '蕴': (108, 116, 84),
                 '逐': (140, 96, 116), '器·字': (96, 90, 100)}
    of = {}
    for fam, idxs in FAMILY.items():
        for i in idxs:
            of[i] = fam

    for k, (i, name, fn) in enumerate(MOTS):
        r, c = divmod(k, cols)
        x, y = 60 + c * cw, 168 + r * ch
        m = fn(240 * SS)
        icon = Image.new('RGBA', (240 * SS,) * 2, (0, 0, 0, 0))
        solid = Image.new('RGBA', (240 * SS,) * 2, INK + (255,))
        solid.putalpha(m)
        icon.alpha_composite(solid)
        small = icon.resize((168, 168), Image.LANCZOS)
        cv.paste(small, (x + 36, y), small)
        # 真机尺寸
        tiny = icon.resize((44, 44), Image.LANCZOS)
        cv.paste(tiny, (x + 220, y + 124), tiny)
        for sx in (120, 76, 60, 44, 32):
            t = icon.resize((sx, sx), Image.LANCZOS)
            cv.paste(t, (x + 8, y + 200 + (120 - sx) // 2), t)
        d.text((x + 4, y + 4), f'{i:02d}', font=f2, fill=fam_color[of[i]])
        d.text((x + 40, y + 3), name, font=f2, fill=INK)
        d.text((x + 4, y + 176), f'族：{of[i]}', font=f4, fill=(150, 144, 136))
        d.text((x + 210, y + 172), '44px', font=f4, fill=(150, 144, 136))
        rr = far_radius(240 * SS, m)
        d.text((x + 4, y + 292), f'半径 {rr:.3f}' + ('' if rr <= SAFE else ' 超'),
               font=f4, fill=(90, 118, 90) if rr <= SAFE else (178, 60, 60))

    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '图标v18_母题总览.png')
    cv.save(p)
    return p


# ═══════════════════════ 渲染：完成品（复用深咖金材质） ═══════════════════════
def finish(size, idx, pal_tag='C', rounded=False):
    W = size * SS
    pal = PALETTES.get(pal_tag) or EXTRA_PAL[pal_tag]
    cv = tile(W, pal)
    m = motif_mask(W, idx)
    sh = m.filter(ImageFilter.GaussianBlur(W * 0.020))
    sh = sh.point(lambda v: int(v * 0.30))
    sc = Image.new('RGBA', (W, W), pal['shadow'] + (255,))
    sc.putalpha(sh)
    plate = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    plate.paste(sc, (0, int(W * 0.015)))
    cv.alpha_composite(plate)
    gold = disc_color(W, pal)
    gold.putalpha(m)
    cv.alpha_composite(gold)
    r = far_radius(W, m)
    if rounded:
        mm = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mm).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(mm)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# 另外两套配色体系：机构蓝（跟博艺教育徽章统一）／宣纸墨（跟系统「极简·暖」统一）
EXTRA_PAL = {
    'N': dict(name='博艺蓝 · 深', desc='跟机构徽章同色系，机构一套视觉',
              tile=((62, 78, 112), (24, 34, 56)), glow=(104, 132, 176),
              disc=((238, 243, 251), (168, 186, 214)), bar=None, shadow=(0, 0, 0)),
    'W': dict(name='宣纸 · 浅', desc='跟系统界面同色系，米白 + 墨',
              tile=((251, 249, 244), (228, 221, 209)), glow=(255, 248, 232),
              disc=((64, 58, 49), (26, 24, 20)), bar=None, shadow=(120, 110, 96)),
}

SELECTED = [6, 8, 20, 23, 24, 11]


def pick_sheet():
    names = {i: n for i, n, _ in MOTS}
    cols = 3
    rows = math.ceil(len(SELECTED) / cols)
    cw, ch = 404, 486
    W = 56 * 2 + cols * cw
    H = 190 + rows * ch + 30
    cv = Image.new('RGB', (W, H), (243, 241, 236))
    d = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 34); f2 = ImageFont.truetype(ZH_FONT, 22)
    f3 = ImageFont.truetype(ZH_FONT, 17)
    INK = (32, 30, 27)
    d.text((56, 30), '砺蕴 · 桌面图标 v18 · 六个精选（做成实物）', font=f1, fill=INK)
    d.text((56, 80), '仍是深咖底 + 暖金 mark + 极轻落影（沿用现在这套材质，一个像素没改），只把「符号」换掉。',
           font=f2, fill=(108, 102, 94))

    for k, idx in enumerate(SELECTED):
        r, c = divmod(k, cols)
        x, y = 56 + c * cw, 180 + r * ch
        big, rr = finish(280, idx)
        cv.paste(big, (x + 46, y))
        yy = y + 280 + 34
        xx = x + 16
        for px in (120, 76, 60, 44, 32):
            im, _ = finish(px, idx, rounded=True)
            cv.paste(im, (xx, yy + (120 - px) // 2), im)
            xx += px + 13
        d.text((x + 16, yy + 142), f'{idx:02d} · {names[idx]}', font=f2, fill=INK)
        d.text((x + 16, yy + 174), f'最远半径 {rr:.3f} / 上限 {SAFE:.3f} ' +
               ('OK' if rr <= SAFE else '超标'), font=f3,
               fill=(70, 100, 70) if rr <= SAFE else (170, 60, 60))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '图标v18_六选.png')
    cv.save(p)
    return p


def home_grid(idxs, stem):
    """把「现在线上的」和几个候选**并排放进同一张手机桌面** ——
    单独看每张图都会觉得还行，只有并排才能看出谁在桌面上最跳、谁最糊。"""
    W, H = 960, 1000
    t = np.linspace(0, 1, H)[:, None]
    top, bot = np.array((46, 58, 88), float), np.array((16, 22, 36), float)
    g = top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    cv = Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    dr = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 92); f2 = ImageFont.truetype(ZH_FONT, 26)
    f3 = ImageFont.truetype(ZH_FONT, 21); f4 = ImageFont.truetype(ZH_FONT, 19)
    dr.text((48, 30), '9:41', font=f3, fill=(255, 255, 255))
    dr.text((W - 48, 30), '5G  100%', font=f3, fill=(255, 255, 255), anchor='ra')
    dr.text((W / 2, 132), '9:41', font=f1, fill=(255, 255, 255), anchor='mm')
    dr.text((W / 2, 202), '9月23日 星期三', font=f2, fill=(212, 218, 232), anchor='mm')

    ic, gap = 136, 40
    cols = 4
    gw = cols * ic + (cols - 1) * gap
    x0 = (W - gw) // 2
    y0 = 268

    # 第一格永远是现在线上那枚，方便直接比
    cells = [('now', '现在线上')] + [(i, f'{i:02d} {dict((a, b) for a, b, _ in MOTS)[i]}') for i in idxs]
    # 先用几个中性图标把格子填满，保证是「桌面」而不是「陈列柜」
    ph = [(152, 160, 176), (182, 152, 138), (140, 168, 158), (162, 152, 184),
          (184, 172, 142), (142, 160, 188), (170, 142, 152), (148, 172, 152)]
    total = 8
    while len(cells) < total:
        cells.append(('ph', ''))

    for k, (idx, label) in enumerate(cells):
        r, c = divmod(k, cols)
        x, y = x0 + c * (ic + gap), y0 + r * (ic + 66)
        if idx == 'ph':
            b = Image.new('RGBA', (ic, ic), ph[k % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, y), b)
            continue
        if idx == 'now':
            im = Image.open(os.path.join(ROOT, 'icon.png')).convert('RGBA').resize((ic, ic), Image.LANCZOS)
            cv.paste(im, (x, y), im)
            mark = (255, 226, 160)
        else:
            im, _ = finish(ic, idx, rounded=True)
            cv.paste(im, (x, y), im)
            mark = (206, 214, 230)
        dr.text((x + ic / 2, y + ic + 8), label, font=f4, fill=mark, anchor='ma')

    dw, dh = W - 140, ic + 34
    dy = y0 + 2 * (ic + 66) + 30
    dock = Image.new('RGBA', (dw, dh), (255, 255, 255, 255))
    dm = Image.new('L', (dw, dh), 0)
    ImageDraw.Draw(dm).rounded_rectangle([0, 0, dw - 1, dh - 1], radius=dh * 0.30, fill=255)
    a = Image.new('L', (dw, dh), 30)
    dock.putalpha(Image.composite(a, Image.new('L', (dw, dh), 0), dm))
    cv.alpha_composite(dock, (70, dy))
    dx0 = 70 + (dw - (4 * ic + 3 * gap)) // 2
    for c in range(4):
        x = dx0 + c * (ic + gap)
        if c == 0:
            im, _ = finish(ic, 11, rounded=True)
            cv.paste(im, (x, dy + 17), im)
        else:
            b = Image.new('RGBA', (ic, ic), ph[(c + 3) % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, dy + 17), b)
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'{stem}.png')
    cv.convert('RGB').save(p)
    return p


def pal_sheet():
    """同一批母题 × 三套配色体系 —— 先定颜色体系，再定形。"""
    names = {i: n for i, n, _ in MOTS}
    PAL_TAGS = [('C', '深咖 · 暖金（现在这套）'), ('N', '博艺蓝（跟机构徽章同色）'), ('W', '宣纸 · 墨（跟系统界面同色）')]
    cols, cw, ch = 3, 336, 322
    rows = len(SELECTED)
    W = 60 * 2 + cols * cw
    H = 196 + rows * ch + 30
    cv = Image.new('RGB', (W, H), (243, 241, 236))
    d = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 34); f2 = ImageFont.truetype(ZH_FONT, 22)
    f3 = ImageFont.truetype(ZH_FONT, 18)
    INK = (32, 30, 27)
    d.text((60, 30), '砺蕴 · 桌面图标 v18 · 三套配色体系对照', font=f1, fill=INK)
    d.text((60, 80), '同一个母题，换三套颜色体系 —— 形定了之后颜色还能单独调，先看哪套气质对。',
           font=f2, fill=(108, 102, 94))
    for c, (tag, label) in enumerate(PAL_TAGS):
        d.text((60 + c * cw + 12, 146), label, font=f3, fill=(84, 78, 71))
    for r, idx in enumerate(SELECTED):
        y = 196 + r * ch
        d.text((14, y + 122), f'{idx:02d}', font=f3, fill=(150, 144, 136))
        d.text((4, y + 146), names[idx], font=f3, fill=(110, 104, 96))
        for c, (tag, _) in enumerate(PAL_TAGS):
            im, _ = finish(250, idx, tag)
            cv.paste(im, (60 + c * cw + 12, y))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '图标v18_三配色.png')
    cv.save(p)
    return p


def main():
    pick = None
    for a in sys.argv[1:]:
        if a.startswith('--pick='):
            pick = int(a.split('=', 1)[1])

    print('maskable 安全自检（图形层 alpha 最远半径，上限 %.3f）：' % SAFE)
    bad = []
    for i, name, fn in MOTS:
        m = fn(512)
        r = far_radius(512, m)
        if r > SAFE:
            bad.append((i, name, r))
        print(f'  {i:02d} {name:<6} {r:.3f}  ' + ('OK' if r <= SAFE else '❌ 超'))
    if bad:
        print('⚠️ 超标：', '、'.join(f'{n}({r:.3f})' for _, n, r in bad))

    print('母题总览：', sheet())
    print('六选实物：', pick_sheet())
    print('三配色比：', pal_sheet())
    print('桌面同屏：', home_grid(SELECTED, '图标v18_桌面同屏'))

    # 三强单图（圆角方，给网页放大看用）
    for idx in (23, 20, 8):
        for tag in ('C', 'N', 'W'):
            im, _ = finish(512, idx, tag, rounded=True)
            im.save(os.path.join(REVIEW, f'图标v18_{idx:02d}_{tag}.png'))
    print('三强单图已出：23 声之峰 / 20 砚 / 08 砺石开缝 × 三配色')

    if pick is not None:
        made = []
        for px, name in [(512, 'icon.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
            im, r = finish(px, pick)
            if r > SAFE:
                print('❌ 超出 maskable 安全圆，先改几何'); sys.exit(1)
            im.convert('RGB').save(os.path.join(ROOT, name))
            made.append(name)
        print('正式图标 = %02d，写出：%s' % (pick, '、'.join(made)))
        print('⚠️ 记得把 sw.js 的 VERSION 提一档再推。')


if __name__ == '__main__':
    main()
