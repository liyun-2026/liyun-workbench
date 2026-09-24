#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v29 —— 对齐博艺徽章的设计语言

这一版的地基是**去看了一眼博艺教育那枚徽章**（assets/boyi-512.png）。
用户说"我博艺那个 logo 也是博的简化、优化、变形" —— 那枚徽章里，
12 画的「博」被简化到 7 笔，**全部笔画等粗、全部圆头、间距均匀**，
而且有一笔穿出内圆。这就是他要的语言，之前 28 轮我一次都没对齐过。

所以 v29 做两件事：

【一 · 把「声」按同一套规范重画】
    等粗 t=0.118、全圆头、间距重排（横距均匀、框加深到孔能撑住 44px）、
    撇**不再收尖**（博艺那枚里没有一根渐细的笔画）。
    并且——「声」的下部是「框＋竖」（竖分两格），
    而博艺的「博」下部是「框＋横」（横分两格），**恰好互为镜像**，
    两枚标天生是一家。

【二 · 色回到品牌】
    桌面图标深咖金、机构徽章蓝白 —— 用户早就说过这两套视觉在打架。
    这一版直接把徽章的蓝拿过来用（含几个更屏幕化的同族变体）。
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import far_radius
from icon_v18 import rrect, union, punched, ZH_FONT
from icon_v21 import place
from icon_v22 import bg_mesh, _wallpaper, _chrome
from icon_v23 import gloss_layer
from icon_v26 import taper, mono, font
from icon_v25 import SS

W0 = 512


# ═══════════════ 配色：全部回到"蓝"这一个色相家族 ═══════════════
PAL29 = {
    'B': dict(name='博艺蓝', note='徽章同一个 #50638E —— 一套视觉，不再打架',
              base=(80, 99, 142), blobs=[(0.20, 0.14, (128, 148, 192), 0.50, 1.9),
                                         (0.84, 0.92, (54, 70, 106), 0.60, 1.9)],
              fgk=(255, 255, 255), fg2=(238, 242, 250), glowk=0.12),
    'C': dict(name='博艺蓝·浅', note='同色相提高明度 —— 干净、可信',
              base=(104, 125, 172), blobs=[(0.18, 0.12, (162, 178, 214), 0.52, 1.9),
                                           (0.86, 0.94, (72, 90, 132), 0.60, 1.9)],
              fgk=(255, 255, 255), fg2=(240, 245, 253), glowk=0.10),
    'D': dict(name='深空蓝', note='近黑的蓝 —— 屏幕感最强，桌面上不抢别人',
              base=(14, 21, 40), blobs=[(0.18, 0.12, (60, 88, 158), 0.62, 1.9),
                                        (0.86, 0.94, (18, 30, 62), 0.66, 1.9)],
              fgk=(255, 255, 255), fg2=(224, 233, 252), glowk=0.15),
    'E': dict(name='墨蓝', note='压暗的深蓝 —— 沉稳，像墨水',
              base=(28, 42, 74), blobs=[(0.20, 0.14, (72, 104, 168), 0.56, 1.9),
                                        (0.84, 0.92, (16, 26, 50), 0.62, 1.9)],
              fgk=(255, 255, 255), fg2=(230, 238, 254), glowk=0.14),
    'F': dict(name='电光蓝', note='高饱和现代蓝 —— 桌面上最跳的那个',
              base=(37, 99, 235), blobs=[(0.18, 0.12, (96, 165, 250), 0.60, 1.8),
                                         (0.86, 0.94, (29, 78, 216), 0.66, 1.8)],
              fgk=(255, 255, 255), fg2=(228, 240, 255), glowk=0.14),
    'G': dict(name='石墨', note='中性深灰 —— 符号最清楚，像工具',
              base=(26, 28, 35), blobs=[(0.20, 0.14, (58, 62, 76), 0.52, 1.9),
                                        (0.84, 0.92, (16, 17, 22), 0.60, 1.9)],
              fgk=(255, 255, 255), fg2=(226, 230, 240), glowk=0.10),
}
PAL_ORDER = ['B', 'D', 'F', 'C', 'E', 'G']


# ═══════════════ 形：按博艺「博」的规范重画的「声」 ═══════════════
SK = dict(
    t=0.118,
    H1=0.132, H2=0.348, H3=0.512, H4=0.808,
    FL=0.160, FR=0.840, VM=0.500, TOP=0.500,
    H1U=(0.050, 0.950), H2U=(0.108, 0.892), FU=(0.160, 0.840),
    top0=0.020, top1=0.548,          # 上竖：也可贯穿（spine）
    vl1=0.872, vr1=0.872,
    pw=1.0, px=1.0,                  # 撇的末端粗细 / 横向长度系数（1.0 = 等粗、原长）
    plen=1.0,                        # 撇的长度系数
)


def sheng(W=W0, **kw):
    s = dict(SK)
    s.update(kw)
    t = s['t']
    H1, H2, H3, H4 = s['H1'], s['H2'], s['H3'], s['H4']
    FL, FR, VM, TOP = s['FL'], s['FR'], s['VM'], s['TOP']
    FW_ = 0.92
    OX = OY = (1 - FW_) / 2

    def U(u):
        return OX + u * FW_

    def V(v):
        return OY + v * FW_

    def HB(v, u0, u1):
        return rrect(W, U((u0 + u1) / 2), V(v), (u1 - u0) * FW_, t * FW_,
                     min((u1 - u0) * FW_, t * FW_) * 0.4995)

    def VB(u, v0, v1):
        return rrect(W, U(u), V((v0 + v1) / 2), t * FW_, (v1 - v0) * FW_,
                     min(t * FW_, (v1 - v0) * FW_) * 0.4995)

    parts = [
        HB(H1, *s['H1U']),               # 士 · 上横
        HB(H2, *s['H2U']),               # 士 · 下横
        VB(TOP, s['top0'], s['top1']),   # 士 · 中竖
        HB(H3, *s['FU']),                # 框 · 顶横
        HB(H4, *s['FU']),                # 框 · 底横
        VB(FL, H3 - t / 2, s['vl1']),    # 框 · 左竖
        VB(FR, H3 - t / 2, s['vr1']),    # 框 · 右竖
        VB(VM, H3 - t / 2, H4 + t / 2),  # 框 · 中竖
    ]
    # 撇：**等粗**（博艺那枚里没有一根渐细的笔画），末端 1.0 就是等粗
    vl = min(1.0, s['vl1'] + 0.012)
    p0 = (FL, vl)
    px = s.get('px', 1.0)
    p1 = (FL - 0.056 * px, vl + 0.086 * s['plen'])
    p2 = (FL - 0.126 * px, vl + 0.108 * s['plen'])
    parts.append(taper([p0, p1, p2], t, t * s['pw'], W=W))
    return union(*parts)


def spine(W=W0, **kw):
    """设计动作：上竖一路连到下框底 —— 全字有了一根中轴。"""
    return sheng(W, top1=SK['H4'] + SK['t'] / 2, **kw)


# ═══════════════ 渲染 ═══════════════
def render(size, shape_fn, tag='B', gloss=True, rounded=True):
    pal = PAL29[tag]
    W = size * SS
    cv = bg_mesh(W, pal).convert('RGBA')
    mask = place(W, shape_fn(W))
    if pal.get('glowk'):
        gl = mask.filter(ImageFilter.GaussianBlur(W * 0.020)).point(lambda v: int(v * pal['glowk'] * 0.60))
        L = Image.new('RGBA', (W, W), (255, 255, 255, 255))
        L.putalpha(gl)
        cv.alpha_composite(L)
    g = np.linspace(0, 1, W, dtype=np.float32)[:, None]
    c1 = np.array(pal['fgk'], np.float32)
    c2 = np.array(pal['fg2'], np.float32)
    col = c1[None, :] * (1 - g) + c2[None, :] * g
    sym = Image.fromarray(np.repeat(col[:, None, :], W, axis=1).clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    sym.putalpha(mask)
    cv.alpha_composite(sym)
    if gloss:
        cv.alpha_composite(gloss_layer(W, mask, alpha=0.14))
    if rounded:
        mm = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mm).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(mm)
    return cv.resize((size, size), Image.LANCZOS).convert('RGBA')


SHAPES = [('声（标准）', lambda W: sheng(W)),
          ('声（中轴贯穿）', lambda W: spine(W)),
          ('声（撇再长一档）', lambda W: sheng(W, plen=1.32))]


# ═══════════════ 出图 ═══════════════
def grid():
    cols, cw, ch = len(PAL_ORDER), 300, 400
    W, H = 150 + cols * cw, 262 + len(SHAPES) * ch + 20
    cv = Image.new('RGB', (W, H), (20, 22, 28))
    d = ImageDraw.Draw(cv)
    f1 = font(46); f2 = font(23); f3 = font(20); f4 = font(17)
    d.text((60, 30), '砺蕴 · 桌面图标 v29 · 回到品牌', font=f1, fill=(240, 243, 250))
    d.text((60, 92), '「声」按博艺徽章「博」的同一套规范重画：等粗、圆头、间距均匀；'
                     '配色回到徽章那个蓝。', font=f2, fill=(152, 162, 182))
    d.text((60, 128), '注意两枚标的关系：博艺的「博」下部是「框＋横」，砺蕴的「声」下部是「框＋竖」—— 互为镜像。',
           font=f4, fill=(124, 134, 154))
    for c, tag in enumerate(PAL_ORDER):
        p = PAL29[tag]
        d.text((150 + c * cw + 8, 190), p['name'], font=f3, fill=(232, 236, 246))
        d.text((150 + c * cw + 8, 218), p['note'][:22], font=f4, fill=(138, 148, 168))
    for r, (name, fn) in enumerate(SHAPES):
        y = 262 + r * ch
        d.text((30, y + 130), name, font=f3, fill=(226, 232, 244))
        for c, tag in enumerate(PAL_ORDER):
            im = render(268, fn, tag)
            cv.paste(im, (150 + c * cw + 8, y), im)
            for k, s in enumerate((120, 76, 60, 44)):
                sm = render(s, fn, tag)
                cv.paste(sm, (150 + c * cw + 8 + k * (s + 12), y + 282), sm)
        d.text((150 + 8, y + 344), '安全半径 %.3f / %.3f' % (far_radius(W0, place(W0, fn(W0))), 0.400),
               font=f4, fill=(120, 190, 146))
    p = os.path.join(REVIEW, '图标v29_形色矩阵.png')
    cv.save(p)
    return p


def home(tags=('B', 'D', 'F'), stem='图标v29_桌面同屏'):
    W, H = 1000, 1150
    cv = _wallpaper(W, H)
    _chrome(cv, W, '', '9月24日 星期四')
    f4 = font(24)
    ic, gap, cols = 138, 42, 4
    gw = cols * ic + (cols - 1) * gap
    x0, y0 = (W - gw) // 2, 272
    cells = [('now', '现在线上')] + [('s', (0, t)) for t in tags] + [('s', (1, tags[0]))]
    ph = [(150, 158, 178), (180, 150, 136), (138, 166, 156), (160, 150, 182)]
    rows = math.ceil(len(cells) / cols)
    while len(cells) < rows * cols:
        cells.append(('ph', None))
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
            label, mark = '现在线上', (255, 214, 150)
        else:
            si, tag = val
            im = render(ic, SHAPES[si][1], tag)
            label, mark = '%s · %s' % (SHAPES[si][0][:7], PAL29[tag]['name']), (214, 222, 238)
        cv.paste(im, (x, y), im)
        ImageDraw.Draw(cv).text((x + ic / 2, y + ic + 8), label, font=f4, fill=mark, anchor='ma')
    p = os.path.join(REVIEW, '%s.png' % stem)
    cv.convert('RGB').save(p)
    return p


def main():
    print('安全半径自检：')
    for name, fn in SHAPES:
        r = far_radius(W0, place(W0, fn(W0)))
        print('  %-14s %.3f  %s' % (name, r, 'OK' if r <= 0.401 else '超标'))
    print('矩阵：', grid())
    print('桌面：', home())


if __name__ == '__main__':
    main()
