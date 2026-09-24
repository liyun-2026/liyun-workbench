#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v30 —— 精修：分量、方孔、一笔穿出

v29 对齐了语言（等粗/圆头/博艺蓝），但看格子时还差口气：
  ① 字只占图标 ~50%，留白太多 → 显得弱（徽章里「博」占内圆 ~62%）
  ② 笔画偏细，没有徽章里「博」那种"实"的分量
  ③ 「声」的撇太短，最能出性格的一笔没使上劲

所以这一版：
  · t 0.118 → 0.145；框加深到 0.32，孔做成接近正方（横竖 1.11:1）
  · 笔画的分布重排，让字面被填满（far_radius 缩定后字占 0.62）
  · 加一个从徽章学来的动作 —— 「博」有一横穿出了内圆，
    这里让「声」的**框底横向右穿出**，与左下的撇形成对角张力
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import far_radius
from icon_v21 import place
from icon_v29 import sheng, render, PAL29, PAL_ORDER, W0, font
from icon_v22 import _wallpaper, _chrome

# ═══════════ 精修骨架：更满、更粗、方孔 ═══════════
SK2 = dict(
    t=0.145,
    H1=0.135, H2=0.362, H3=0.536, H4=0.850,     # 框高 0.314 → 内高 0.169（近方孔）
    FL=0.162, FR=0.838, VM=0.500, TOP=0.500,
    H1U=(0.048, 0.952), H2U=(0.106, 0.894), FU=(0.162, 0.838),
    top0=0.002, top1=0.478,
    vl1=0.905, vr1=0.905,
    pw=0.50, px=1.28, plen=1.44,                # 撇：够长才认得出「声」，末端收到一半
)


def fit(mask, W, target_w=0.590, dy=0.022):
    """按**字面宽度**缩放（不是按最远半径）—— 圆角方形图标的安全区比安全圆大得多，
    把 far_radius 留给 maskable 那一版，方形这一版可以让字占满 0.59。

    dy：光学补偿。「声」的撇伸在左下，bbox 居中后**字身会显得偏右下**，
    所以整体上移 2%（这是老祖宗的口诀：汉字视觉重心要比几何中心略高）。
    """
    bb = mask.getbbox()
    cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
    k = target_w * W / (bb[2] - bb[0])
    return mask.transform((W, W), Image.AFFINE,
                          (1 / k, 0, cx - W / 2 / k, 0, 1 / k, cy + dy * W - W / 2 / k),
                          resample=Image.BILINEAR).point(lambda v: 255 if v >= 120 else 0)


def A(W):
    return fit(sheng(W, **SK2), W)


def B(W):
    """框底横向右穿出 —— 与左下的撇形成对角张力（徽章里「博」的同一招）。"""
    return fit(sheng(W, **dict(SK2, FU=(0.162, 1.055))), W)


def C(W):
    """中轴贯穿 ＋ 长撇（不加穿出，最"正"的一版）。"""
    return fit(sheng(W, **dict(SK2, px=0.95, plen=1.05, pw=0.58,
                               top1=SK2['H4'] + SK2['t'] / 2)), W)


SHAPES = [('A 精修（字面填满）', A), ('B 框底穿出', B), ('C 中轴＋长撇', C)]


def grid():
    tags = ['B', 'D', 'F', 'G']
    cols, cw, ch = len(tags), 300, 400
    W, H = 150 + cols * cw, 258 + len(SHAPES) * ch + 20
    cv = Image.new('RGB', (W, H), (20, 22, 28))
    d = ImageDraw.Draw(cv)
    f1, f2, f3, f4 = font(46), font(23), font(20), font(17)
    d.text((60, 28), '砺蕴 · 桌面图标 v30 · 精修', font=f1, fill=(240, 243, 250))
    d.text((60, 90), '笔画 0.118→0.145，框加深到孔接近正方，字面填满；'
                     '并借用徽章里「博」穿出内圆的那一招。', font=f2, fill=(152, 162, 182))
    for c, tag in enumerate(tags):
        d.text((150 + c * cw + 8, 168), PAL29[tag]['name'], font=f3, fill=(232, 236, 246))
        d.text((150 + c * cw + 8, 196), PAL29[tag]['note'][:20], font=f4, fill=(138, 148, 168))
    for r, (name, fn) in enumerate(SHAPES):
        y = 258 + r * ch
        d.text((22, y + 132), name, font=f3, fill=(226, 232, 244))
        for c, tag in enumerate(tags):
            im = render(268, fn, tag)
            cv.paste(im, (150 + c * cw + 8, y), im)
            for k, s in enumerate((120, 76, 60, 44)):
                sm = render(s, fn, tag)
                cv.paste(sm, (150 + c * cw + 8 + k * (s + 12), y + 282), sm)
        _bb = fn(W0).getbbox()
        d.text((158, y + 344), '字面 %.0f%% · 最远半径 %.3f（maskable 上限 0.400）' %
               ((_bb[2] - _bb[0]) / W0 * 100, far_radius(W0, fn(W0))),
               font=f4, fill=(120, 190, 146))
    p = os.path.join(REVIEW, '图标v30_精修矩阵.png')
    cv.save(p)
    return p


def home(stem='图标v30_桌面同屏'):
    W, H = 1000, 1150
    cv = _wallpaper(W, H)
    _chrome(cv, W, '', '9月24日 星期四')
    f4 = font(24)
    ic, gap, cols = 138, 42, 4
    gw = cols * ic + (cols - 1) * gap
    x0, y0 = (W - gw) // 2, 272
    cells = [('now', None), ('s', (0, 'B')), ('s', (0, 'D')), ('s', (0, 'G')),
             ('s', (0, 'F')), ('s', (2, 'B')), ('s', (2, 'D')), ('s', (1, 'B'))]
    labels = ['现在线上', 'A · 博艺蓝', 'A · 深空蓝', 'A · 石墨',
              'A · 电光蓝', 'C · 博艺蓝', 'C · 深空蓝', 'B · 博艺蓝']
    ph = [(150, 158, 178), (180, 150, 136), (138, 166, 156), (160, 150, 182)]
    rows = math.ceil(len(cells) / cols)
    while len(cells) < rows * cols:
        cells.append(('ph', None))
        labels.append('')
    for k, (kind, val) in enumerate(cells):
        r_, c_ = divmod(k, cols)
        x, y = x0 + c_ * (ic + gap), y0 + r_ * (ic + 62)
        if kind == 'ph':
            b = Image.new('RGBA', (ic, ic), ph[k % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, y), b)
            continue
        if kind == 'now':
            im = Image.open(os.path.join(ROOT, 'icon.png')).convert('RGBA').resize((ic, ic), Image.LANCZOS)
            mark = (255, 214, 150)
        else:
            si, tag = val
            im = render(ic, SHAPES[si][1], tag)
            mark = (214, 222, 238)
        cv.paste(im, (x, y), im)
        ImageDraw.Draw(cv).text((x + ic / 2, y + ic + 8), labels[k], font=f4, fill=mark, anchor='ma')
    p = os.path.join(REVIEW, '%s.png' % stem)
    cv.convert('RGB').save(p)
    return p


if __name__ == '__main__':
    for name, fn in SHAPES:
        m = fn(W0)
        bb = m.getbbox()
        print('%-18s 字面宽 %.3f   最远半径 %.3f / 0.400 %s' %
              (name, (bb[2] - bb[0]) / W0, far_radius(W0, m),
               'OK' if far_radius(W0, m) <= 0.401 else 'maskable 会裁到'))
    print(grid())
    print(home())
