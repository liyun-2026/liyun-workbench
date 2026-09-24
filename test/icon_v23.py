#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v23 —— 把「形」从实物插画打磨成图标

v22 把「年份」拨到 2026（mesh 渐变 + 白符号）之后，配色的问题解决了，
但把图放大一看就露馅：形还是**写实的实物轮廓**（网罩+细颈+圆条底座＝一座奖杯），
不是**图标化的符号**。

现代图标的符号有三个特征，v22 的话筒一条都不占：
  1. **笔画统一** —— 颈、底座、网罩的粗细要有节奏，不能一条细线串一个大块
  2. **重心饱满** —— 不要"上轻下重"，不要细颈吊着大头
  3. **几何化** —— 该方的地方就方，该圆的就圆，不做写实的收腰、尾帽

这一版做四件事：
  · 网罩的缝重新排（更疏、更粗、居中）
  · 颈加粗到 0.115（v22 是 0.080 —— 太细才成了"棒棒糖"）
  · 底座收窄（0.300，v22 是 0.340 —— 太宽就成了"奖杯底座"）
  · 新增一层**斜向高光带**（Liquid Glass 的做法）—— 这一层是"高级感"的来源
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import far_radius
from icon_v18 import SS, SAFE, ZH_FONT, rrect, poly_mask, arc_band, union, punched
from icon_v21 import capsule, place, trapezoid, tilt
from icon_v22 import PAL22, PAL_ORDER, bg_mesh, FG, FG2, _fonts, _wallpaper, _chrome


# ═══════════════════════════ 形：话筒的重新打磨 ═══════════════════════════
def mic_head(W, cy=0.318, w=0.336, h=0.478, n=3, slit_h=0.054, slit_w_k=0.70, span_k=0.56):
    """网罩：竖直胶囊 + n 道横向网缝。

    缝要**疏**（3 道就够）、**粗**（≥0.05）、**居中**（span 不要拉满）——
    拉满会读成"斑马"，太密在 44px 会糊成一片。
    """
    cap = rrect(W, 0.500, cy, w, h, w / 2 * 0.99)
    if n:
        sw = w * slit_w_k
        span = h * span_k
        cuts = []
        for i in range(n):
            t = i / (n - 1) if n > 1 else 0.5
            cuts.append(rrect(W, 0.500, cy - span / 2 + span * t, sw, slit_h, slit_h / 2 * 0.98))
        cap = punched(cap, union(*cuts))
    return cap


def sh_mic1(W):
    """01 立式话筒 —— 网罩 + **粗颈** + **窄圆条底座**。

    跟 v22 的差别就三处，但正是这三处把它从"奖杯"救回来：
      颈 0.080 → 0.115（细颈是"棒棒糖/穿裙子小人"的根源）
      底座 0.340 → 0.300（宽底座＝奖杯）
      底座高度加厚 0.100 → 0.092 不变，但圆角加大 → 更像"横条"不像"托盘"
    """
    return union(mic_head(W, 0.318, 0.336, 0.478),
                 rrect(W, 0.500, 0.606, 0.115, 0.112, 0.0570),
                 rrect(W, 0.500, 0.7400, 0.300, 0.092, 0.0460))


def sh_mic2(W):
    """02 简话筒 —— 网罩 + 粗短颈，不要底座。最轻、最现代。"""
    return union(mic_head(W, 0.330, 0.340, 0.482),
                 rrect(W, 0.500, 0.6250, 0.118, 0.160, 0.0590))


def sh_mic3(W):
    """03 U弧话筒 —— 网罩 + U 型环 + 支杆 + 横条（录音棚防震架）。

    v22 里最"专业"的一版，但环与网罩贴太近。这版把**环的内径拉开**
    （内径 ≥ 网罩半高 + 0.05），并且**环加粗**，44px 才不糊。
    """
    return union(mic_head(W, 0.296, 0.300, 0.408, 3, 0.050, 0.72, 0.54),
                 arc_band(W, 0.500, 0.300, 0.244, 0.300, -22, 204),
                 rrect(W, 0.500, 0.6420, 0.096, 0.140, 0.0480),
                 rrect(W, 0.500, 0.7380, 0.360, 0.078, 0.0390))


def sh_mic4(W):
    """04 斜话筒 —— 手持话筒整体 -22° 斜置。

    斜置＝**不对称**，这是 2026 的一条趋势（一直居中会显得"正确但无聊"）。
    代价：斜的东西在桌面上不如正的稳，所以只做备选。
    """
    body = union(mic_head(W, 0.300, 0.330, 0.430, 3, 0.054, 0.70, 0.56),
                 rrect(W, 0.500, 0.5520, 0.150, 0.090, 0.0450),
                 trapezoid(W, 0.680, 0.168, 0.208, 0.240, soft=0.012),
                 rrect(W, 0.500, 0.8120, 0.222, 0.060, 0.0300))
    return tilt(body, -22)


def sh_word(W, ch='声'):
    """05 字标「声」—— 2026 第一大趋势：极简字标。"""
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).text((W / 2, W / 2), ch, font=ImageFont.truetype(ZH_FONT, int(W * 0.70)),
                           fill=255, anchor='mm')
    return m


def sh_wave(W):
    """06 声波 —— 9 根紧密排布、中线对齐、按包络起伏的短柱。"""
    env = [0.40, 0.60, 0.84, 1.00, 0.76, 0.94, 0.68, 0.50, 0.36]
    return union(*[rrect(W, 0.150 + 0.700 * (i + 0.5) / 9, 0.500,
                         0.058, 0.640 * env[i], 0.029) for i in range(9)])


SHAPES = [
    (1, '立式话筒', sh_mic1, '网罩+粗颈+窄端条 —— 粗颈是关键，v22 的细颈像棒棒糖'),
    (2, '简话筒',  sh_mic2, '网罩+粗短颈，不要底座 —— 最轻、最现代'),
    (3, 'U弧话筒', sh_mic3, '录音棚防震架 —— 最专业，环已拉开间距'),
    (4, '斜话筒',  sh_mic4, '手持话筒 -22° 斜置 —— 不对称，有动感'),
    (5, '字标「声」', sh_word, '极简字标 —— 2026 第一大趋势'),
    (6, '声波',    sh_wave, '九柱紧凑包络 —— 抽象，但要人认一下'),
]
BY_ID = {s[0]: s for s in SHAPES}
NAMES = {s[0]: s[1] for s in SHAPES}


# ═══════════════════════════ 渲染（+ 斜向高光带） ═══════════════════════════
def gloss_layer(W, mask, alpha=0.20, at=0.30, width=0.060):
    """Liquid Glass 的斜向高光：一道 55° 的白色渐隐窄带，只落在符号内部。

    这是"高级感"最省力的一招 —— 安卓 15、iOS 26 的图标都在用。
    强度必须小（≤0.22），大了就变成"符号被划了一刀"。
    """
    ys, xs = np.mgrid[0:W, 0:W].astype(np.float32) / W
    t = (xs * 0.72 + ys * 0.28)
    band = np.exp(-((t - at) ** 2) / (2 * width ** 2))
    a = (band * alpha * 255).astype(np.uint8)
    lay = Image.new('RGBA', (W, W), (255, 255, 255, 255))
    lay.putalpha(Image.composite(Image.fromarray(a, 'L'), Image.new('L', (W, W), 0), mask))
    return lay


def render(size, sid, tag='A', glow=True, gloss=True, rounded=True):
    pal = PAL22[tag]
    W = size * SS
    cv = bg_mesh(W, pal).convert('RGBA')

    mask = place(W, BY_ID[sid][2](W))

    if glow and pal['glowk'] > 0:
        gl = mask.filter(ImageFilter.GaussianBlur(W * 0.020)).point(
            lambda v: int(v * pal['glowk'] * 0.60))
        gl_l = Image.new('RGBA', (W, W), tuple(pal['glow']) + (255,))
        gl_l.putalpha(gl)
        cv.alpha_composite(gl_l)

    g = np.linspace(0, 1, W, dtype=np.float32)[:, None]
    col = np.array(FG, np.float32)[None, :] * (1 - g) + np.array(FG2, np.float32)[None, :] * g
    sym = Image.fromarray(np.repeat(col[:, None, :], W, axis=1).clip(0, 255).astype(np.uint8),
                          'RGB').convert('RGBA')
    sym.putalpha(mask)
    cv.alpha_composite(sym)
    if gloss:
        cv.alpha_composite(gloss_layer(W, mask))

    r = far_radius(W, mask)
    if rounded:
        mm = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mm).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(mm)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ═══════════════════════════ 出图 ═══════════════════════════
def sheet(tag='A', gloss=True, stem=None):
    cols, cw, ch = 3, 420, 566
    rows = math.ceil(len(SHAPES) / cols)
    W, H = 60 * 2 + cols * cw, 250 + rows * ch + 30
    cv = Image.new('RGB', (W, H), (20, 22, 28))
    d = ImageDraw.Draw(cv)
    f1, f2, f3, f4 = _fonts()
    d.text((60, 30), '砺蕴 · 桌面图标 v23 · 形的打磨', font=f1, fill=(240, 242, 248))
    d.text((60, 82), 'mesh 渐变 + 纯白符号 + 斜向高光带 —— 笔画统一、重心饱满、几何化',
           font=f2, fill=(150, 158, 176))
    d.text((60, 124), '配色：%s —— %s%s' % (PAL22[tag]['name'], PAL22[tag]['desc'],
                                            '（含高光带）' if gloss else '（无高光带）'),
           font=f4, fill=(120, 128, 148))
    for k, (i, name, fn, note) in enumerate(SHAPES):
        r_, c_ = divmod(k, cols)
        x, y = 60 + c_ * cw, 250 + r_ * ch
        big, rr = render(280, i, tag, gloss=gloss)
        cv.paste(big, (x + 40, y), big)
        yy = y + 280 + 24
        xx = x + 12
        for px in (120, 76, 60, 44, 32):
            im, _ = render(px, i, tag, gloss=gloss)
            cv.paste(im, (xx, yy + (120 - px) // 2), im)
            xx += px + 14
        d.text((x + 12, yy + 136), '%02d %s' % (i, name), font=f2, fill=(236, 240, 248))
        d.text((x + 12, yy + 172), note[:30], font=f4, fill=(140, 148, 166))
        d.text((x + 12, yy + 196), '安全半径 %.3f / %.3f %s' % (rr, SAFE, 'OK' if rr <= SAFE else '超标'),
               font=f4, fill=(110, 190, 140) if rr <= SAFE else (210, 110, 110))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, (stem or '图标v23_六案_%s' % tag) + '.png')
    cv.save(p)
    return p


def pal_sheet(shape_ids=(1, 2, 3, 5), tags=None):
    tags = tags or PAL_ORDER[:5]
    cols = len(tags)
    cw, ch = 302, 358
    W, H = 132 + cols * cw, 296 + len(shape_ids) * ch + 30
    cv = Image.new('RGB', (W, H), (20, 22, 28))
    d = ImageDraw.Draw(cv)
    f1, f2, f3, f4 = _fonts()
    d.text((132, 30), '砺蕴 · 图标 v23 · 五套配色', font=f1, fill=(240, 242, 248))
    d.text((132, 82), '邻近色配对 —— 跨度一大，缩到 44px 就发脏。', font=f2, fill=(150, 158, 176))
    for c, tag in enumerate(tags):
        p = PAL22[tag]
        d.text((132 + c * cw + 12, 222), p['name'], font=f3, fill=(228, 232, 242))
        d.text((132 + c * cw + 12, 248), p['desc'][:15], font=f4, fill=(130, 138, 158))
    for r_, sid in enumerate(shape_ids):
        y = 296 + r_ * ch
        d.text((20, y + 122), '%02d' % sid, font=f3, fill=(150, 158, 176))
        d.text((16, y + 148), NAMES[sid], font=f3, fill=(160, 168, 186))
        for c, tag in enumerate(tags):
            im, _ = render(258, sid, tag)
            cv.paste(im, (132 + c * cw + 12, y), im)
    p = os.path.join(REVIEW, '图标v23_五配色.png')
    cv.save(p)
    return p


def home_grid(shape_ids, pal_map=None, stem='图标v23_桌面同屏'):
    pal_map = pal_map or {i: 'A' for i in shape_ids}
    W, H = 1000, 1120
    cv = _wallpaper(W, H)
    f4 = _chrome(cv, W, '', '9月24日 星期四')
    ic, gap, cols = 138, 42, 4
    gw = cols * ic + (cols - 1) * gap
    x0, y0 = (W - gw) // 2, 272
    cells = [('now', '现在线上')] + [(i, '%02d %s' % (i, NAMES[i])) for i in shape_ids]
    ph = [(150, 158, 178), (180, 150, 136), (138, 166, 156), (160, 150, 182),
          (182, 170, 140), (140, 158, 186), (168, 140, 150), (146, 170, 150)]
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
            im = Image.open(src).convert('RGBA').resize((ic, ic), Image.LANCZOS)
            mark = (255, 214, 150)
        else:
            im, _ = render(ic, idx, pal_map.get(idx, 'A'))
            mark = (214, 222, 238)
        cv.paste(im, (x, y), im)
        ImageDraw.Draw(cv).text((x + ic / 2, y + ic + 8), label, font=f4, fill=mark, anchor='ma')
    dw, dh = W - 140, ic + 34
    dy = y0 + rows * (ic + 62) + 28
    dock = Image.new('RGBA', (dw, dh), (255, 255, 255, 255))
    dm = Image.new('L', (dw, dh), 0)
    ImageDraw.Draw(dm).rounded_rectangle([0, 0, dw - 1, dh - 1], radius=dh * 0.30, fill=255)
    a = Image.new('L', (dw, dh), 34)
    dock.putalpha(Image.composite(a, Image.new('L', (dw, dh), 0), dm))
    cv.alpha_composite(dock, (70, dy))
    dx0 = 70 + (dw - (4 * ic + 3 * gap)) // 2
    for c_ in range(4):
        x = dx0 + c_ * (ic + gap)
        if c_ == 0 and shape_ids:
            im, _ = render(ic, shape_ids[0], pal_map.get(shape_ids[0], 'A'))
            cv.paste(im, (x, dy + 17), im)
        else:
            b = Image.new('RGBA', (ic, ic), ph[(c_ + 3) % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, dy + 17), b)
    p = os.path.join(REVIEW, '%s.png' % stem)
    cv.convert('RGB').save(p)
    return p


def home_pal(shape_id=1, tags=None, stem='图标v23_桌面同形五色'):
    tags = tags or PAL_ORDER[:5]
    W, H = 1000, 1120
    cv = _wallpaper(W, H)
    f4 = _chrome(cv, W, '', '9月24日 星期四')
    ic, gap, cols = 150, 42, 3
    gw = cols * ic + (cols - 1) * gap
    x0, y0 = (W - gw) // 2, 282
    cells = [('now', '现在线上')] + [('pal', t) for t in tags]
    ph = [(150, 158, 178), (180, 150, 136), (138, 166, 156)]
    rows = math.ceil(len(cells) / cols)
    while len(cells) < rows * cols:
        cells.append(('ph', ''))
    for k, (kind, val) in enumerate(cells):
        r_, c_ = divmod(k, cols)
        x, y = x0 + c_ * (ic + gap), y0 + r_ * (ic + 78)
        if kind == 'now':
            src = os.path.join(ROOT, 'icon.png')
            im = Image.open(src).convert('RGBA').resize((ic, ic), Image.LANCZOS)
            label, mark = '现在线上', (255, 214, 150)
        elif kind == 'pal':
            im, _ = render(ic, shape_id, val)
            label, mark = PAL22[val]['name'], (214, 222, 238)
        else:
            b = Image.new('RGBA', (ic, ic), ph[k % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, y), b)
            continue
        cv.paste(im, (x, y), im)
        ImageDraw.Draw(cv).text((x + ic / 2, y + ic + 10), label, font=f4, fill=mark, anchor='ma')
    p = os.path.join(REVIEW, '%s.png' % stem)
    cv.convert('RGB').save(p)
    return p


def main():
    print('自检（安全圆上限 %.3f）：' % SAFE)
    for i, name, fn, _ in SHAPES:
        r = far_radius(512, place(512, fn(512)))
        print('  %02d %-10s %.3f %s' % (i, name, r, 'OK' if r <= SAFE else '超标'))
    print('六案（深海极光·高光）：', sheet('A', True))
    print('六案（深海极光·无高光）：', sheet('A', False, '图标v23_六案_A_无高光'))
    print('六案（电光蓝）：', sheet('B', True))
    print('五配色：', pal_sheet())
    print('桌面同屏：', home_grid(list(range(1, 7)), {i: 'A' for i in range(1, 7)}))
    print('桌面同形五色：', home_pal(1))
    for tag in PAL_ORDER[:5]:
        im, _ = render(512, 1, tag)
        im.save(os.path.join(REVIEW, '图标v23_01_%s.png' % tag))
    print('01 号 512 · 五配色已出')


if __name__ == '__main__':
    main()
