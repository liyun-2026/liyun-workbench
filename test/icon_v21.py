#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v21 —— 话筒 · 扁平

════════════════════════════════════════════════════════
这一轮改的不是"形"，是"设计哲学"
════════════════════════════════════════════════════════
前 20 轮我一直在做「意义」：砺＝磨石、蕴＝积蕴、声＝声波，
于是每一版都需要*解释*才能看懂。而用户这次的话说得很白：
    「能让一人一眼看出这是什么」
—— 这是**识别**，不是**寓意**。logo 不需要解释，需要一眼认出。

看看用户自己列的参照 App，答案就在里面：
  微信＝绿色底 + 白色对话框     抖音＝黑底 + 音符
  腾讯视频＝蓝底 + 播放三角     小红书＝红底 + 白字
它们**没有一个是"含义"**，全是**一件人人都认得的东西**，
而且是：扁平纯色 + 一个剪影，没有渐变、没有纹理、没有投影。

砺蕴是**播音主持**艺考的工作系统 —— 人人一眼认得的东西就是**话筒**。
所以 v21：整块主色铺满 + 米白的话筒剪影，彻底扁平。

同时一并解决两个旧账：
  1. 品牌矛盾：桌面图标（深咖金）与机构徽章（蓝白 #50638E）两套视觉
     → 新增「博艺蓝」配色，直接用机构色，两边就统一了
  2. v19/v20 的"满铺"结论保留，但去掉渐变/纹理/投影 —— 那才是"简约大方"

用法
----
  python3 test/icon_v21.py                      # 出全部对照图
  python3 test/icon_v21.py --pick=6 --pal=B     # 做成正式图标
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import far_radius
from icon_v18 import (SS, SAFE, ZH_FONT, circle_mask, rrect, poly_mask,
                      stroke, stroke_var, arc_band, union, punched)


# ═══════════════════════════ 配色：扁平纯色 ═══════════════════════════
# 一个底色 + 一个符号色，没有渐变、没有纹理、没有投影。
PAL21 = {
    'B': dict(name='博艺蓝', desc='机构徽章同一个蓝（#50638E）—— 一套视觉，不再打架',
              bg=(80, 99, 142), fg=(247, 244, 236)),
    'G': dict(name='石青绿', desc='《千里江山图》的矿物色，沉静、有文化感',
              bg=(33, 96, 112), fg=(244, 248, 240)),
    'K': dict(name='砺蕴咖', desc='沿用现在的深咖，但改成扁平 —— 沉稳，桌面上偏暗',
              bg=(50, 38, 28), fg=(240, 226, 198)),
    'J': dict(name='暖金', desc='整块暖金 + 深咖话筒 —— 桌面上最跳，也最"贵"',
              bg=(205, 167, 101), fg=(46, 34, 22)),
    'R': dict(name='墨赤', desc='压暗的朱砂 —— 有精神，不俗气',
              bg=(146, 52, 42), fg=(250, 241, 228)),
}
PAL_ORDER = ['B', 'G', 'K', 'J', 'R']


# ═══════════════════════════ 形状：话筒 ═══════════════════════════
def capsule(W, cy, w=0.320, h=0.430, n_slits=3, slit_h=0.056, slit_w=None):
    """话筒的网罩头：一枚**竖着**的胶囊，中间挖几道横向的网缝。

    头一定要比宽高（≈1.34 倍）—— 圆头的话读起来是勺子/灯泡，不像话筒。
    网缝要**粗**（≥0.05）才扛得住 32px —— 细了在小尺寸会糊成一片条纹。
    """
    cap = rrect(W, 0.500, cy, w, h, min(w, h) / 2 * 0.99)
    if n_slits:
        sw = slit_w or (w * 0.74)
        span = h * 0.60
        cuts = []
        for i in range(n_slits):
            t = i / (n_slits - 1) if n_slits > 1 else 0.5
            cuts.append(rrect(W, 0.500, cy - span / 2 + span * t, sw, slit_h, slit_h / 2 * 0.98))
        cap = punched(cap, union(*cuts))
    return cap


def place(W, mask, cap=None):
    """居中 + 缩放到统一的视觉大小。

    手算坐标很容易偏心 / 超标（前几轮反复踩），这一步交给程序：
    bbox 居中 → 整体缩到「最远半径 = 0.92×安全圆」。
    不管形是瘦是扁，出来的分量都一样，并排看才公平。
    """
    cap = cap or SAFE * 0.962
    bb = mask.getbbox()
    if not bb:
        return mask
    bcx, bcy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
    mask = mask.transform((W, W), Image.AFFINE, (1, 0, W / 2 - bcx, 0, 1, W / 2 - bcy),
                          resample=Image.BILINEAR)
    r = far_radius(W, mask)
    if r > 1e-6:
        k = cap / r
        mask = mask.transform((W, W), Image.AFFINE,
                              (1 / k, 0, W / 2 - W / 2 / k, 0, 1 / k, W / 2 - W / 2 / k),
                              resample=Image.BILINEAR)
    return mask.point(lambda v: 255 if v >= 120 else 0)


def trapezoid(W, cy, w_top, w_bot, h, soft=0.006):
    """梯形底座。比"宽扁的方块"像底座 —— 方块当底座会读成"脚"，整个图标就成了小人。"""
    y0, y1 = cy - h / 2, cy + h / 2
    return poly_mask(W, [(0.5 - w_top / 2, y0), (0.5 + w_top / 2, y0),
                         (0.5 + w_bot / 2, y1), (0.5 - w_bot / 2, y1)], soft=soft)


def tilt(mask, deg):
    c = mask.size[0] / 2
    return mask.rotate(deg, resample=Image.BICUBIC, center=(c, c))


def sh_desk(W):
    """01 播音话筒 —— 高身网罩 + 细颈 + 梯形底座。播音台／录音棚里那一支。

    头一定要**比宽高**（0.32×0.48，圆角只占宽的一半 → 是"话筒身"不是"鸡蛋"）；
    底座一定要**梯形**（方块当底座会读成"脚"，整个图标就变成小人了）。
    """
    return union(capsule(W, 0.335, 0.320, 0.480, 3, 0.056),
                 rrect(W, 0.500, 0.625, 0.080, 0.135, 0.040),
                 rrect(W, 0.500, 0.750, 0.340, 0.100, 0.050))


def sh_hand(W):
    """02 手持话筒 —— 网罩 + 收腰 + 锥形握柄 + 尾帽。主持人手里拿的那支。"""
    return union(capsule(W, 0.310, 0.330, 0.430, 3, 0.056),
                 rrect(W, 0.500, 0.545, 0.108, 0.075, 0.037),
                 trapezoid(W, 0.665, 0.150, 0.190, 0.215, soft=0.010),
                 rrect(W, 0.500, 0.795, 0.205, 0.058, 0.029))


def sh_lite(W):
    """03 简话筒 —— 高身网罩 + 细颈，不要底座。最轻。"""
    return union(capsule(W, 0.350, 0.300, 0.480, 3, 0.056),
                 rrect(W, 0.500, 0.645, 0.076, 0.160, 0.038))


def sh_u(W):
    """04 U弧话筒 —— 最"标准答案"的那一版：网罩 + U 型环 + 支杆 + 横条。

    全世界认得的那个"话筒"图标就是这个结构（U 型环是关键，它代表防震架）。
    代价是元素多一个，比 01 热闹一点。
    """
    return union(capsule(W, 0.285, 0.300, 0.400, 3, 0.052),
                 arc_band(W, 0.500, 0.285, 0.232, 0.276, -20, 200),
                 rrect(W, 0.500, 0.618, 0.072, 0.130, 0.036),
                 rrect(W, 0.500, 0.722, 0.380, 0.074, 0.037))


def sh_plain(W):
    """05 净话筒 —— 同 01 但不要网缝：纯剪影。测"网缝到底帮不帮忙"。"""
    return union(rrect(W, 0.500, 0.335, 0.320, 0.480, 0.1584),
                 rrect(W, 0.500, 0.625, 0.080, 0.135, 0.040),
                 rrect(W, 0.500, 0.750, 0.340, 0.100, 0.050))


def sh_wave(W):
    """06 对照 · 声纹 —— v20 那条路（抽象波形）的扁平版：
    它"高级"，但要人猜；话筒不用猜。"""
    env = [0.42, 0.62, 0.86, 1.00, 0.78, 0.96, 0.70, 0.52, 0.38]
    bars = [rrect(W, 0.145 + 0.710 * (i + 0.5) / 9, 0.500, 0.056, 0.64 * env[i], 0.028)
            for i in range(9)]
    return union(*bars)


SHAPES = [
    (1, '播音话筒', sh_desk,  '网罩+细颈+圆条底座 —— 播音台上那一支，最干净'),
    (2, '手持话筒', sh_hand,  '网罩+锥形握柄+尾帽 —— 主持人手里拿的那支'),
    (3, '简话筒',   sh_lite,  '只留网罩和一根细颈，不要底座 —— 最轻'),
    (4, 'U弧话筒',  sh_u,     '网罩+U型环+支杆+横条 —— 全世界认得的标准式'),
    (5, '净话筒',   sh_plain, '同 01 但不要网缝，纯剪影 —— 测网缝帮不帮忙'),
    (6, '声纹(对照)', sh_wave, 'v20 那条路：高级，但要人猜'),
]
BY_ID = {s[0]: s for s in SHAPES}
NAMES = {s[0]: s[1] for s in SHAPES}


# ═══════════════════════════ 渲染：彻底扁平 ═══════════════════════════
def render(size, sid, tag='B', rounded=True):
    pal = PAL21[tag]
    W = size * SS
    cv = Image.new('RGBA', (W, W), tuple(pal['bg']) + (255,))
    mask = place(W, BY_ID[sid][2](W))
    lay = Image.new('RGBA', (W, W), tuple(pal['fg']) + (255,))
    lay.putalpha(mask)
    cv.alpha_composite(lay)
    r = far_radius(W, mask)
    if rounded:
        mm = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mm).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(mm)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ═══════════════════════════ 出图 ═══════════════════════════
def sheet(tag='B'):
    """七个形并排 + 五个真机尺寸。"""
    cols, cw, ch = 4, 356, 522
    rows = math.ceil(len(SHAPES) / cols)
    W = 60 * 2 + cols * cw
    H = 232 + rows * ch + 30
    cv = Image.new('RGB', (W, H), (243, 241, 236))
    d = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 34); f2 = ImageFont.truetype(ZH_FONT, 23)
    f4 = ImageFont.truetype(ZH_FONT, 15)
    INK = (32, 30, 27)
    d.text((60, 30), '砺蕴 · 桌面图标 v21 · 话筒 · 扁平', font=f1, fill=INK)
    d.text((60, 80), '整块主色铺满 + 一个米白的话筒剪影 —— 没有渐变、没有纹理、没有投影。', font=f2, fill=(108, 102, 94))
    d.text((60, 116), '配色：%s —— %s' % (PAL21[tag]['name'], PAL21[tag]['desc']), font=f4, fill=(140, 132, 122))

    for k, (i, name, fn, note) in enumerate(SHAPES):
        r_, c_ = divmod(k, cols)
        x, y = 60 + c_ * cw, 232 + r_ * ch
        big, rr = render(250, i, tag)
        cv.paste(big, (x + 26, y), big)
        yy = y + 250 + 22
        xx = x + 8
        for px in (120, 76, 60, 44, 32):
            im, _ = render(px, i, tag)
            cv.paste(im, (xx, yy + (120 - px) // 2), im)
            xx += px + 12
        d.text((x + 8, yy + 132), '%02d %s' % (i, name), font=f2, fill=INK)
        d.text((x + 8, yy + 166), note[:27], font=f4, fill=(112, 106, 98))
        if len(note) > 27:
            d.text((x + 8, yy + 186), note[27:54], font=f4, fill=(112, 106, 98))
        d.text((x + 8, yy + 212), '安全半径 %.3f / 上限 %.3f ' % (rr, SAFE) +
               ('OK' if rr <= SAFE else '超标'), font=f4,
               fill=(70, 100, 70) if rr <= SAFE else (170, 60, 60))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '图标v21_六案_%s.png' % tag)
    cv.save(p)
    return p


def pal_sheet(shape_ids=(1, 3, 4)):
    cols, cw, ch = len(PAL_ORDER), 300, 348
    W = 120 + cols * cw
    H = 300 + len(shape_ids) * ch + 30
    cv = Image.new('RGB', (W, H), (243, 241, 236))
    d = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 34); f2 = ImageFont.truetype(ZH_FONT, 21)
    f3 = ImageFont.truetype(ZH_FONT, 17); f4 = ImageFont.truetype(ZH_FONT, 14)
    INK = (32, 30, 27)
    d.text((120, 30), '砺蕴 · 桌面图标 v21 · 五套扁平配色', font=f1, fill=INK)
    d.text((120, 80), '形定了再挑颜色。博艺蓝跟机构徽章同色 —— 一套视觉，不再两边打架。', font=f2, fill=(108, 102, 94))
    for c, tag in enumerate(PAL_ORDER):
        p = PAL21[tag]
        d.text((120 + c * cw + 12, 224), p['name'], font=f3, fill=(64, 60, 54))
        d.text((120 + c * cw + 12, 250), p['desc'][:15], font=f4, fill=(146, 140, 132))
    for r_, sid in enumerate(shape_ids):
        y = 300 + r_ * ch
        d.text((18, y + 118), '%02d' % sid, font=f3, fill=(150, 144, 136))
        d.text((14, y + 144), NAMES[sid], font=f3, fill=(110, 104, 96))
        for c, tag in enumerate(PAL_ORDER):
            im, _ = render(252, sid, tag)
            cv.paste(im, (120 + c * cw + 12, y), im)
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '图标v21_五配色.png')
    cv.save(p)
    return p


def home_grid(shape_ids, pal_map=None, stem='图标v21_桌面同屏'):
    """放进真机桌面 —— 「放桌面上好不好看」只有这一张说了算。"""
    pal_map = pal_map or {i: 'B' for i in shape_ids}
    W, H = 960, 1080
    t = np.linspace(0, 1, H)[:, None]
    top, bot = np.array((46, 58, 88), float), np.array((16, 22, 36), float)
    g = top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    cv = Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    dr = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 92); f2 = ImageFont.truetype(ZH_FONT, 26)
    f3 = ImageFont.truetype(ZH_FONT, 21); f4 = ImageFont.truetype(ZH_FONT, 18)
    dr.text((48, 30), '9:41', font=f3, fill=(255, 255, 255))
    dr.text((W - 48, 30), '5G  100%', font=f3, fill=(255, 255, 255), anchor='ra')
    dr.text((W / 2, 132), '9:41', font=f1, fill=(255, 255, 255), anchor='mm')
    dr.text((W / 2, 202), '9月24日 星期四', font=f2, fill=(212, 218, 232), anchor='mm')

    ic, gap, cols = 136, 40, 4
    gw = cols * ic + (cols - 1) * gap
    x0 = (W - gw) // 2
    y0 = 268
    cells = [('now', '现在线上')] + [(i, '%02d %s' % (i, NAMES[i])) for i in shape_ids]
    ph = [(152, 160, 176), (182, 152, 138), (140, 168, 158), (162, 152, 184),
          (184, 172, 142), (142, 160, 188), (170, 142, 152), (148, 172, 152)]
    rows = math.ceil(len(cells) / cols)
    while len(cells) < rows * cols:
        cells.append(('ph', ''))
    for k, (idx, label) in enumerate(cells):
        r_, c_ = divmod(k, cols)
        x, y = x0 + c_ * (ic + gap), y0 + r_ * (ic + 62)
        if idx == 'ph':
            b = Image.new('RGBA', (ic, ic), ph[k % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, y), b)
            continue
        if idx == 'now':
            src = os.path.join(ROOT, 'icon.png')
            im = (Image.open(src).convert('RGBA').resize((ic, ic), Image.LANCZOS)
                  if os.path.exists(src) else render(ic, 6, 'K')[0])
            cv.paste(im, (x, y), im)
            mark = (255, 226, 160)
        else:
            im, _ = render(ic, idx, pal_map.get(idx, 'B'))
            cv.paste(im, (x, y), im)
            mark = (206, 214, 230)
        dr.text((x + ic / 2, y + ic + 6), label, font=f4, fill=mark, anchor='ma')

    dw, dh = W - 140, ic + 34
    dy = y0 + rows * (ic + 62) + 26
    dock = Image.new('RGBA', (dw, dh), (255, 255, 255, 255))
    dm = Image.new('L', (dw, dh), 0)
    ImageDraw.Draw(dm).rounded_rectangle([0, 0, dw - 1, dh - 1], radius=dh * 0.30, fill=255)
    a = Image.new('L', (dw, dh), 30)
    dock.putalpha(Image.composite(a, Image.new('L', (dw, dh), 0), dm))
    cv.alpha_composite(dock, (70, dy))
    dx0 = 70 + (dw - (4 * ic + 3 * gap)) // 2
    for c_ in range(4):
        x = dx0 + c_ * (ic + gap)
        if c_ == 0 and shape_ids:
            im, _ = render(ic, shape_ids[0], pal_map.get(shape_ids[0], 'B'))
            cv.paste(im, (x, dy + 17), im)
        else:
            b = Image.new('RGBA', (ic, ic), ph[(c_ + 3) % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, dy + 17), b)
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '%s.png' % stem)
    cv.convert('RGB').save(p)
    return p


def home_pal(shape_id=1, stem='图标v21_桌面同形五色'):
    """同一个形 × 五套配色，并排放进真机桌面 —— 选颜色该看这一张。"""
    W, H = 960, 1080
    t = np.linspace(0, 1, H)[:, None]
    top, bot = np.array((46, 58, 88), float), np.array((16, 22, 36), float)
    g = top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    cv = Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    dr = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 92); f2 = ImageFont.truetype(ZH_FONT, 26)
    f3 = ImageFont.truetype(ZH_FONT, 21); f4 = ImageFont.truetype(ZH_FONT, 18)
    dr.text((48, 30), '9:41', font=f3, fill=(255, 255, 255))
    dr.text((W - 48, 30), '5G  100%', font=f3, fill=(255, 255, 255), anchor='ra')
    dr.text((W / 2, 132), '9:41', font=f1, fill=(255, 255, 255), anchor='mm')
    dr.text((W / 2, 202), '9月24日 星期四', font=f2, fill=(212, 218, 232), anchor='mm')

    ic, gap, cols = 150, 40, 3
    gw = cols * ic + (cols - 1) * gap
    x0 = (W - gw) // 2
    y0 = 280
    ph = [(152, 160, 176), (182, 152, 138), (140, 168, 158), (162, 152, 184), (184, 172, 142)]
    cells = [('now', '现在线上')] + [('pal', tag) for tag in PAL_ORDER]
    rows = math.ceil(len(cells) / cols)
    while len(cells) < rows * cols:
        cells.append(('ph', ''))
    for k, (kind, val) in enumerate(cells):
        r_, c_ = divmod(k, cols)
        x, y = x0 + c_ * (ic + gap), y0 + r_ * (ic + 74)
        if kind == 'now':
            src = os.path.join(ROOT, 'icon.png')
            im = Image.open(src).convert('RGBA').resize((ic, ic), Image.LANCZOS)
            label, mark = '现在线上', (255, 226, 160)
        elif kind == 'pal':
            im, _ = render(ic, shape_id, val)
            label, mark = PAL21[val]['name'], (206, 214, 230)
        else:
            b = Image.new('RGBA', (ic, ic), ph[k % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, y), b)
            continue
        cv.paste(im, (x, y), im)
        dr.text((x + ic / 2, y + ic + 8), label, font=f4, fill=mark, anchor='ma')
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '%s.png' % stem)
    cv.convert('RGB').save(p)
    return p


def main():
    pick, pal = None, 'B'
    for a in sys.argv[1:]:
        if a.startswith('--pick='):
            pick = int(a.split('=', 1)[1])
        if a.startswith('--pal='):
            pal = a.split('=', 1)[1]

    if pick:
        os.makedirs(REVIEW, exist_ok=True)
        for tag in ('B', 'G', 'K'):
            im, r = render(512, pick, tag)
            im.save(os.path.join(REVIEW, '图标v21_%02d_%s.png' % (pick, tag)))
        print('已出 512 三色：', pick, '安全半径 %.3f' % r)
        return

    print('自检（安全圆上限 %.3f）：' % SAFE)
    for i, name, fn, _ in SHAPES:
        r = far_radius(512, place(512, fn(512)))
        print('  %02d %-10s %.3f %s' % (i, name, r, 'OK' if r <= SAFE else '超标'))
    print('六案（博艺蓝）：', sheet('B'))
    print('六案（砺蕴咖）：', sheet('K'))
    print('五配色：', pal_sheet((1, 3, 4)))
    print('桌面同屏：', home_grid([1, 2, 3, 4, 5, 6],
                                  {1: 'B', 2: 'B', 3: 'B', 4: 'B', 5: 'B', 6: 'G'}))
    print('桌面·同形五色：', home_pal(1))

    for sid in (1, 2, 3, 4):
        for tag in ('B', 'G', 'K'):
            im, _ = render(512, sid, tag)
            im.save(os.path.join(REVIEW, '图标v21_%02d_%s.png' % (sid, tag)))
    print('单图已出：01/02/03/04 × 蓝·青绿·咖')


if __name__ == '__main__':
    main()
