#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v24 —— 话筒的正确比例（窄网罩）

v22/v23 连续两版配色已经对了，但形还是「实物插画」。把 v23 的图放大看，
病根终于找出来了：**网罩太宽**。

    我用的   0.336 × 0.478 → 宽高比 0.70
    该用的   0.235 × 0.400 → 宽高比 0.59

0.70 的网罩一定读成**鸡蛋/奶瓶/灯泡**（v21 起就反复出现这个评语）；
只有窄到 0.58~0.60 才像"话筒身"。这是量出来的，不是感觉出来的 ——
对照物：Lucide 的 mic 图标是 6 × 13 的胶囊（0.46），Material 的 mic 是 0.40，
真实录音棚电容麦的网罩宽高比在 0.55~0.62 之间，**没有一个是 0.70 的**。

另外两处一起修：
  · 网缝的**左右留边**从 30% 提到 40%（缝窄了才像网罩，宽了像斑马）
  · 立式话筒的底座收窄到 0.30 且**加厚圆角** —— 宽底座是"奖杯"的根源
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
from icon_v21 import place, tilt
from icon_v22 import PAL22, PAL_ORDER, bg_mesh, FG, FG2, _fonts, _wallpaper, _chrome
from icon_v23 import gloss_layer


# ═══════════════════════════ 形：话筒（窄网罩） ═══════════════════════════
def head(W, cy, w=0.235, h=0.400, n=3, sh=0.050, swk=0.60, spank=0.54):
    """窄网罩 —— 宽高比 0.59，这才是"话筒身"。

    网缝左右留边 = (1-0.60)/2 = 20% 每侧，缝本身够粗（0.050）扛得住 32px。
    """
    cap = rrect(W, 0.500, cy, w, h, w / 2 * 0.99)
    if n:
        cuts = []
        span = h * spank
        for i in range(n):
            t = i / (n - 1) if n > 1 else 0.5
            cuts.append(rrect(W, 0.500, cy - span / 2 + span * t, w * swk, sh, sh / 2 * 0.98))
        cap = punched(cap, union(*cuts))
    return cap


def sh_stand(W):
    """01 立式话筒 —— 窄网罩 + 短颈 + 圆条底座（桌面/录音棚那一支）。"""
    return union(head(W, 0.268, 0.235, 0.400),
                 rrect(W, 0.500, 0.5560, 0.098, 0.128, 0.0490),
                 rrect(W, 0.500, 0.7180, 0.300, 0.086, 0.0430))


def sh_u(W):
    """02 U弧话筒 ★ —— 窄网罩 + U 型防震架 + 支杆 + 横条。

    这是全世界"话筒"图标的**标准结构**（Material / Phosphor / Lucide 都用它），
    也是六案里唯一在 44px 还看得出"这是一支话筒"的。
    """
    return union(head(W, 0.262, 0.230, 0.392, 3, 0.049, 0.60, 0.54),
                 arc_band(W, 0.500, 0.262, 0.234, 0.290, -28, 208),
                 rrect(W, 0.500, 0.6180, 0.084, 0.140, 0.0420),
                 rrect(W, 0.500, 0.7260, 0.336, 0.072, 0.0360))


def sh_hand(W):
    """03 手持话筒 —— 窄网罩 + 收腰 + 锥形握柄 + 尾帽。"""
    return union(head(W, 0.244, 0.228, 0.376),
                 rrect(W, 0.500, 0.4760, 0.128, 0.088, 0.0440),
                 poly_mask(W, [(0.5 - 0.074, 0.528), (0.5 + 0.074, 0.528),
                               (0.5 + 0.104, 0.712), (0.5 - 0.104, 0.712)], soft=0.012),
                 rrect(W, 0.500, 0.7480, 0.232, 0.062, 0.0310))


def sh_lite(W):
    """04 简话筒 —— 窄网罩 + 短颈，不要底座。最轻。"""
    return union(head(W, 0.280, 0.240, 0.404),
                 rrect(W, 0.500, 0.5640, 0.102, 0.160, 0.0510))


def sh_word(W, ch='声'):
    """05 字标「声」—— 跳出话筒的那条路：2026 第一大趋势，极简字标。"""
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).text((W / 2, W / 2), ch, font=ImageFont.truetype(ZH_FONT, int(W * 0.72)),
                           fill=255, anchor='mm')
    return m


def sh_li(W):
    """06 字标「砺」—— 品牌本名。笔画比「声」多，小尺寸已经开始吃力。"""
    return sh_word(W, '砺')


def sh_wave(W):
    """07 声波 —— 九柱紧凑包络。"""
    env = [0.40, 0.60, 0.84, 1.00, 0.76, 0.94, 0.68, 0.50, 0.36]
    return union(*[rrect(W, 0.150 + 0.700 * (i + 0.5) / 9, 0.500,
                         0.058, 0.640 * env[i], 0.029) for i in range(9)])


SHAPES = [
    (1, '立式话筒', sh_stand, '窄网罩+短颈+圆条底座 —— 桌面那一支'),
    (2, 'U弧话筒', sh_u,     '窄网罩+防震架+支杆+横条 —— 标准结构，44px 还认得出'),
    (3, '手持话筒', sh_hand,  '窄网罩+锥形握柄 —— 主持人手里那支'),
    (4, '简话筒',  sh_lite,  '窄网罩+短颈，无底座 —— 最轻'),
    (5, '字标「声」', sh_word, '跳出话筒：极简字标，2026 第一大趋势'),
    (6, '字标「砺」', sh_li,  '品牌本名；笔画多，小尺寸开始吃力'),
    (7, '声波',    sh_wave,  '九柱紧凑包络 —— 抽象，要人认一下'),
]
BY_ID = {s[0]: s for s in SHAPES}
NAMES = {s[0]: s[1] for s in SHAPES}


# ═══════════════════════════ 渲染 ═══════════════════════════
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
def sheet(tag='A', stem=None, shape_ids=None):
    ids = shape_ids or [s[0] for s in SHAPES]
    cols, cw, ch = 4, 400, 552
    rows = math.ceil(len(ids) / cols)
    W, H = 60 * 2 + cols * cw, 244 + rows * ch + 30
    cv = Image.new('RGB', (W, H), (20, 22, 28))
    d = ImageDraw.Draw(cv)
    f1, f2, f3, f4 = _fonts()
    d.text((60, 30), '砺蕴 · 桌面图标 v24 · 窄网罩', font=f1, fill=(240, 242, 248))
    d.text((60, 82), '网罩宽高比 0.70 → 0.59：0.70 一定读成鸡蛋，0.59 才像话筒身',
           font=f2, fill=(150, 158, 176))
    d.text((60, 124), '配色：%s —— %s' % (PAL22[tag]['name'], PAL22[tag]['desc']),
           font=f4, fill=(120, 128, 148))
    for k, i in enumerate(ids):
        _, name, fn, note = BY_ID[i]
        r_, c_ = divmod(k, cols)
        x, y = 60 + c_ * cw, 244 + r_ * ch
        big, rr = render(258, i, tag)
        cv.paste(big, (x + 30, y), big)
        yy = y + 258 + 24
        xx = x + 10
        for px in (120, 76, 60, 44, 32):
            im, _ = render(px, i, tag)
            cv.paste(im, (xx, yy + (120 - px) // 2), im)
            xx += px + 12
        d.text((x + 10, yy + 136), '%02d %s' % (i, name), font=f2, fill=(236, 240, 248))
        d.text((x + 10, yy + 172), note[:28], font=f4, fill=(140, 148, 166))
        d.text((x + 10, yy + 196), '安全半径 %.3f / %.3f %s' % (rr, SAFE, 'OK' if rr <= SAFE else '超标'),
               font=f4, fill=(110, 190, 140) if rr <= SAFE else (210, 110, 110))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, (stem or '图标v24_七案_%s' % tag) + '.png')
    cv.save(p)
    return p


def pal_sheet(shape_ids=(2, 1, 5), tags=None):
    tags = tags or PAL_ORDER[:5]
    cols = len(tags)
    cw, ch = 302, 356
    W, H = 130 + cols * cw, 292 + len(shape_ids) * ch + 30
    cv = Image.new('RGB', (W, H), (20, 22, 28))
    d = ImageDraw.Draw(cv)
    f1, f2, f3, f4 = _fonts()
    d.text((130, 30), '砺蕴 · 图标 v24 · 五套配色', font=f1, fill=(240, 242, 248))
    d.text((130, 82), '邻近色配对 —— 跨度一大，缩到 44px 就发脏。', font=f2, fill=(150, 158, 176))
    for c, tag in enumerate(tags):
        p = PAL22[tag]
        d.text((130 + c * cw + 12, 220), p['name'], font=f3, fill=(228, 232, 242))
        d.text((130 + c * cw + 12, 246), p['desc'][:15], font=f4, fill=(130, 138, 158))
    for r_, sid in enumerate(shape_ids):
        y = 292 + r_ * ch
        d.text((20, y + 122), '%02d' % sid, font=f3, fill=(150, 158, 176))
        d.text((16, y + 148), NAMES[sid], font=f3, fill=(160, 168, 186))
        for c, tag in enumerate(tags):
            im, _ = render(256, sid, tag)
            cv.paste(im, (130 + c * cw + 12, y), im)
    p = os.path.join(REVIEW, '图标v24_五配色.png')
    cv.save(p)
    return p


def home_grid(shape_ids, pal_map=None, stem='图标v24_桌面同屏'):
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


def home_pal(shape_id=2, tags=None, stem='图标v24_桌面同形五色'):
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
    print('七案（深海极光）：', sheet('A'))
    print('七案（电光蓝）：', sheet('B'))
    print('七案（霞光）：', sheet('D'))
    print('五配色：', pal_sheet())
    print('桌面同屏：', home_grid(list(range(1, 8)), {i: 'A' for i in range(1, 8)}))
    print('桌面同形五色（U弧）：', home_pal(2))
    print('桌面同形五色（字标声）：', home_pal(5, stem='图标v24_桌面同形五色_字标声'))
    for tag in PAL_ORDER[:5]:
        for sid in (1, 2, 3, 5, 6):
            im, _ = render(512, sid, tag)
            im.save(os.path.join(REVIEW, '图标v24_%02d_%s.png' % (sid, tag)))
    print('512 单图已出')


if __name__ == '__main__':
    main()
