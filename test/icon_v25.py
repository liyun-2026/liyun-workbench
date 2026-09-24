#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v25 —— 精修 + 真正"跳"的亮色

v24 出图后逐张看，结论很干净：
  ✅ U 弧话筒（窄网罩 + 防震架 + 支杆 + 横条）—— 六案里唯一在 44px 还认出是话筒的
  ✅ 字标「声」—— 跳出话筒的那条路，极简、有品牌感
  ❌ 立式/手持/简话筒 —— 全是"细颈吊大头"，读成棒棒糖 / 台灯 / 烛台
     （全世界的话筒图标都用 U 弧结构，不是巧合）

所以这一版砍掉全部失败形，只做两件事：
  1. 把 U 弧话筒**精修**（网罩加宽到饱满、环的间距收紧、底座加宽）
  2. **补上亮色配色** —— v22~v24 的六套偏"高级暗调"，
     但用户列的参照（微信绿 / 抖音黑+霓虹 / 小红书红）全是**强饱和**的。
     桌面上真正"跳"的是亮色，不是高级灰。这一版加到七套，含亮柠檬与霓虹黑。
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import far_radius
from icon_v18 import SS, SAFE, ZH_FONT, circle_mask, rrect, poly_mask, arc_band, union, punched
from icon_v21 import place, tilt
from icon_v22 import bg_mesh, _fonts, _wallpaper, _chrome
from icon_v23 import gloss_layer
from icon_v24 import head


# ═══════════════════════════ 配色：七套（含亮色） ═══════════════════════════
# base 底色 / blobs 光斑 / fgk 符号色 / glowk 柔光强度
PAL25 = {
    'A': dict(name='深海极光', desc='深空 + 青紫双光斑 —— 最"2026"，OLED 上发光',
              base=(12, 18, 38), blobs=[(0.24, 0.16, (34, 211, 238), 0.62, 1.9),
                                        (0.82, 0.90, (109, 93, 246), 0.66, 1.9),
                                        (0.92, 0.10, (56, 189, 248), 0.40, 0.9)],
              fgk=(255, 255, 255), fg2=(226, 234, 250), glowk=0.34, glowc=(120, 220, 255)),
    'B': dict(name='电光蓝', desc='青→蓝→靛 —— 专业、通透',
              base=(29, 78, 216), blobs=[(0.20, 0.14, (56, 189, 248), 0.66, 1.8),
                                         (0.84, 0.92, (67, 56, 202), 0.70, 1.8)],
              fgk=(255, 255, 255), fg2=(228, 238, 255), glowk=0.16, glowc=(255, 255, 255)),
    'C': dict(name='紫梦', desc='淡紫→靛 —— 创意、教育、有 AI 味',
              base=(109, 40, 217), blobs=[(0.18, 0.12, (192, 132, 252), 0.64, 1.9),
                                          (0.86, 0.94, (79, 70, 229), 0.70, 1.9)],
              fgk=(255, 255, 255), fg2=(238, 232, 255), glowk=0.16, glowc=(255, 255, 255)),
    'D': dict(name='霞光', desc='橙→玫红 —— 舞台、聚光灯、年轻',
              base=(244, 63, 94), blobs=[(0.20, 0.14, (253, 186, 116), 0.64, 1.8),
                                         (0.84, 0.92, (190, 24, 93), 0.70, 1.8)],
              fgk=(255, 255, 255), fg2=(255, 236, 240), glowk=0.14, glowc=(255, 240, 220)),
    'E': dict(name='翠玉青', desc='绿松石→湖蓝 —— 清爽，有文化气',
              base=(13, 148, 136), blobs=[(0.20, 0.14, (94, 234, 212), 0.64, 1.8),
                                          (0.84, 0.92, (2, 132, 199), 0.70, 1.8)],
              fgk=(255, 255, 255), fg2=(230, 255, 250), glowk=0.15, glowc=(255, 255, 255)),
    'G': dict(name='柠檬金', desc='亮黄→琥珀 + 近黑符号 —— 七套里最跳，像交通灯',
              base=(246, 199, 32), blobs=[(0.20, 0.12, (255, 232, 120), 0.66, 1.9),
                                          (0.86, 0.94, (245, 158, 11), 0.70, 1.9)],
              fgk=(26, 20, 8), fg2=(46, 36, 14), glowk=0.0, glowc=(255, 255, 255)),
    'H': dict(name='霓虹黑', desc='近黑 + 青绿霓虹 —— 抖音的做法，桌面上穿透力最强',
              base=(10, 12, 20), blobs=[(0.22, 0.14, (16, 185, 129), 0.58, 1.7),
                                        (0.84, 0.92, (13, 148, 136), 0.66, 1.7),
                                        (0.90, 0.12, (34, 211, 238), 0.38, 0.8)],
              fgk=(245, 255, 252), fg2=(206, 245, 236), glowk=0.40, glowc=(80, 255, 200)),
}
PAL_ORDER = ['A', 'B', 'C', 'D', 'E', 'G', 'H']


# ═══════════════════════════ 形：只有两个值得留 ═══════════════════════════
def sh_u(W):
    """★ U弧话筒（精修）—— 网罩加宽到饱满、环间距收紧、底座加宽。

    参数是量出来的，不是感觉出来的：
      网罩 0.245×0.392（宽高比 0.625 —— 落在真实电容麦的 0.55~0.62 区间上沿）
      U 环内径 0.238 —— 环内侧到网罩底留 0.042 空隙（512 下 21px），再小就糊一起
      底座 0.400 宽 —— 与环的最外沿齐平，不然会读成"支杆插在一个小托盘上"
    """
    return union(head(W, 0.262, 0.245, 0.392, 3, 0.050, 0.62, 0.54),
                 arc_band(W, 0.500, 0.262, 0.238, 0.300, -30, 210),
                 rrect(W, 0.500, 0.6160, 0.090, 0.136, 0.0450),
                 rrect(W, 0.500, 0.7300, 0.400, 0.076, 0.0380))


def sh_word(W, ch='声'):
    """★ 字标「声」—— 笔画用高斯阈值加粗一次。

    STHeiti Medium 的字重偏轻，在渐变底上会显"单薄/廉价"。
    先在高斯模糊后取阈值 = 便宜又干净的"膨胀"，笔画变粗变圆，小尺寸不掉。
    """
    raw = Image.new('L', (W, W), 0)
    ImageDraw.Draw(raw).text((W / 2, W / 2), ch, font=ImageFont.truetype(ZH_FONT, int(W * 0.68)),
                             fill=255, anchor='mm')
    thick = raw.filter(ImageFilter.GaussianBlur(W * 0.0075)).point(lambda v: 255 if v > 78 else 0)
    return thick


def sh_neg(W):
    """负空间话筒 —— 白色实心圆里挖出一支话筒。

    这是把"背景变主体"的做法（Paul Rand 的路子），在一堆渐变方块里最不容易撞车。
    代价：网缝挖不出来（挖了跟底色一样），所以只能靠**轮廓**认话筒，
    因此网罩、颈、底座全要加粗 —— 细一点点就认不出。
    """
    disc = rrect(W, 0.500, 0.500, 0.784, 0.784, 0.392)
    inner = union(rrect(W, 0.500, 0.3180, 0.268, 0.352, 0.1340),
                  rrect(W, 0.500, 0.5380, 0.120, 0.090, 0.0600),
                  rrect(W, 0.500, 0.6520, 0.320, 0.096, 0.0480))
    return punched(disc, inner)


def sh_wave(W):
    """声波 —— 九柱紧凑包络。"""
    env = [0.40, 0.60, 0.84, 1.00, 0.76, 0.94, 0.68, 0.50, 0.36]
    return union(*[rrect(W, 0.150 + 0.700 * (i + 0.5) / 9, 0.500,
                         0.058, 0.640 * env[i], 0.029) for i in range(9)])


SHAPES = [
    (1, 'U弧话筒', sh_u,     '★ 窄网罩 + 防震架 + 支杆 + 横条 —— 44px 还认得出'),
    (2, '字标「声」', sh_word, '★ 跳出话筒：极简字标，2026 第一大趋势'),
    (3, '负空间话筒', sh_neg, '白圆里挖出话筒 —— 最不容易撞车，但要靠轮廓认'),
    (4, '声波',    sh_wave,  '九柱紧凑包络 —— 抽象，要人认一下'),
]
BY_ID = {s[0]: s for s in SHAPES}
NAMES = {s[0]: s[1] for s in SHAPES}


# ═══════════════════════════ 渲染 ═══════════════════════════
def render(size, sid, tag='A', gloss=True, rounded=True):
    pal = PAL25[tag]
    W = size * SS
    cv = bg_mesh(W, pal).convert('RGBA')
    mask = place(W, BY_ID[sid][2](W))

    if pal['glowk'] > 0:
        gl = mask.filter(ImageFilter.GaussianBlur(W * 0.020)).point(
            lambda v: int(v * pal['glowk'] * 0.62))
        gl_l = Image.new('RGBA', (W, W), tuple(pal['glowc']) + (255,))
        gl_l.putalpha(gl)
        cv.alpha_composite(gl_l)

    g = np.linspace(0, 1, W, dtype=np.float32)[:, None]
    c1 = np.array(pal['fgk'], np.float32); c2 = np.array(pal['fg2'], np.float32)
    col = c1[None, :] * (1 - g) + c2[None, :] * g
    sym = Image.fromarray(np.repeat(col[:, None, :], W, axis=1).clip(0, 255).astype(np.uint8),
                          'RGB').convert('RGBA')
    sym.putalpha(mask)
    cv.alpha_composite(sym)
    if gloss:
        a = 0.10 if sum(pal['fgk']) < 380 else 0.20     # 深符号上高光要更轻
        cv.alpha_composite(gloss_layer(W, mask, alpha=a))

    r = far_radius(W, mask)
    if rounded:
        mm = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mm).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(mm)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ═══════════════════════════ 出图 ═══════════════════════════
def sheet(tag='A', stem=None):
    cols, cw, ch = 4, 400, 556
    W, H = 60 * 2 + cols * cw, 250 + ch + 30
    cv = Image.new('RGB', (W, H), (20, 22, 28))
    d = ImageDraw.Draw(cv)
    f1, f2, f3, f4 = _fonts()
    d.text((60, 30), '砺蕴 · 桌面图标 v25 · 精修', font=f1, fill=(240, 242, 248))
    d.text((60, 82), '砍掉全部"细颈吊大头"，只留 U 弧话筒与字标；配色加到七套（含亮色）',
           font=f2, fill=(150, 158, 176))
    d.text((60, 124), '配色：%s —— %s' % (PAL25[tag]['name'], PAL25[tag]['desc']),
           font=f4, fill=(120, 128, 148))
    for k, (i, name, fn, note) in enumerate(SHAPES):
        x, y = 60 + k * cw, 250
        big, rr = render(260, i, tag)
        cv.paste(big, (x + 30, y), big)
        yy = y + 260 + 24
        xx = x + 10
        for px in (120, 76, 60, 44, 32):
            im, _ = render(px, i, tag)
            cv.paste(im, (xx, yy + (120 - px) // 2), im)
            xx += px + 12
        d.text((x + 10, yy + 136), '%02d %s' % (i, name), font=f2, fill=(236, 240, 248))
        d.text((x + 10, yy + 172), note[:30], font=f4, fill=(140, 148, 166))
        d.text((x + 10, yy + 196), '安全半径 %.3f / %.3f %s' % (rr, SAFE, 'OK' if rr <= SAFE else '超标'),
               font=f4, fill=(110, 190, 140) if rr <= SAFE else (210, 110, 110))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, (stem or '图标v25_四案_%s' % tag) + '.png')
    cv.save(p)
    return p


def pal_sheet(shape_ids=(1, 2), tags=None):
    tags = tags or PAL_ORDER
    cols = len(tags)
    cw, ch = 272, 330
    W, H = 118 + cols * cw, 268 + len(shape_ids) * ch + 24
    cv = Image.new('RGB', (W, H), (20, 22, 28))
    d = ImageDraw.Draw(cv)
    f1, f2, f3, f4 = _fonts()
    d.text((118, 30), '砺蕴 · 图标 v25 · 七套配色', font=f1, fill=(240, 242, 248))
    d.text((118, 82), '邻近色配对；最后两套是"强饱和"档 —— 桌面上真正跳的是亮色，不是高级灰。',
           font=f2, fill=(150, 158, 176))
    for c, tag in enumerate(tags):
        p = PAL25[tag]
        col = (150, 158, 176) if sum(p['fgk']) > 380 else (230, 210, 150)
        d.text((118 + c * cw + 10, 200), p['name'], font=f3, fill=(228, 232, 242))
        d.text((118 + c * cw + 10, 226), ('深符号' if sum(p['fgk']) < 380 else '白符号'),
               font=f4, fill=col)
    for r_, sid in enumerate(shape_ids):
        y = 268 + r_ * ch
        d.text((18, y + 110), '%02d' % sid, font=f3, fill=(150, 158, 176))
        d.text((14, y + 136), NAMES[sid], font=f3, fill=(160, 168, 186))
        for c, tag in enumerate(tags):
            im, _ = render(248, sid, tag)
            cv.paste(im, (118 + c * cw + 10, y), im)
    p = os.path.join(REVIEW, '图标v25_七配色.png')
    cv.save(p)
    return p


def home_grid(shape_ids, pal_map=None, stem='图标v25_桌面同屏'):
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


def home_pal(shape_id=1, tags=None, stem='图标v25_桌面同形七色'):
    tags = tags or PAL_ORDER
    W, H = 1000, 1180
    cv = _wallpaper(W, H)
    f4 = _chrome(cv, W, '', '9月24日 星期四')
    ic, gap, cols = 150, 42, 4
    gw = cols * ic + (cols - 1) * gap
    x0, y0 = (W - gw) // 2, 276
    cells = [('now', '现在线上')] + [('pal', t) for t in tags]
    ph = [(150, 158, 178), (180, 150, 136), (138, 166, 156)]
    rows = math.ceil(len(cells) / cols)
    while len(cells) < rows * cols:
        cells.append(('ph', ''))
    for k, (kind, val) in enumerate(cells):
        r_, c_ = divmod(k, cols)
        x, y = x0 + c_ * (ic + gap), y0 + r_ * (ic + 74)
        if kind == 'now':
            src = os.path.join(ROOT, 'icon.png')
            im = Image.open(src).convert('RGBA').resize((ic, ic), Image.LANCZOS)
            label, mark = '现在线上', (255, 214, 150)
        elif kind == 'pal':
            im, _ = render(ic, shape_id, val)
            label, mark = PAL25[val]['name'], (214, 222, 238)
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
    for tag in ('A', 'D', 'G', 'H'):
        print('四案（%s）：' % PAL25[tag]['name'], sheet(tag))
    print('七配色：', pal_sheet())
    print('桌面同屏：', home_grid([1, 2, 3, 4], {1: 'A', 2: 'G', 3: 'D', 4: 'H'}))
    print('桌面同形七色（U弧）：', home_pal(1))
    print('桌面同形七色（字标声）：', home_pal(2, stem='图标v25_桌面同形七色_字标声'))
    for tag in PAL_ORDER:
        for sid in (1, 2):
            im, _ = render(512, sid, tag)
            im.save(os.path.join(REVIEW, '图标v25_%02d_%s.png' % (sid, tag)))
    print('512 单图已出')


if __name__ == '__main__':
    main()
