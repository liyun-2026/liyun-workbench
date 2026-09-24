#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v19 —— 破模板

为什么又推倒（v18 的问题，我自己看出来的）
==========================================
把 v18 的成品并排放到手机桌面上，问题就藏不住了：从线上那枚到 v18 全部候选，
**骨架是同一个模板** ——「深咖方块 + 居中一个金色剪影」，换的只是剪影。
所以再怎么换形，用户看到的第一眼都是"跟以前没区别"。这不是形的问题，**是构图的问题**。

另外两处错位：
  1. 配色 —— 深咖+暖金是「藏」的气质（复古/文具/咖啡馆），
     而用户列的参照（小红书·抖音·微信·芒果·腾讯视频）全是**明亮高饱和单色**。
     播音是「出」，深咖是「藏」。
  2. 「声音」的载体不对 —— 声波画出来必像蛇，话筒画出来像插画。
     真正能立住的是**实体块**（石/器），而不是线条符号。

v19 三条改动
------------
  A. 破构图：新增「满铺」模式（整个图标是一块色，符号用深色挖出），
     不再有"底"与"符号"的二分 —— 这是微信绿/小红书红/芒果橙的做法。
  B. 换色彩：除了原有的深咖金，新增 青玉 / 墨赤 / 满金 三套。
  C. 换载体：从「石」出发找"声音" ——
     破石（声浪把石劈开）、石之唇（石上一道振动缝）、磬浪（击石而鸣）、
     磨石（磨砺留痕）。石 = 砺，声 = 从石里出来的东西。

用法
----
  python3 test/icon_v19.py              # 出全部对照图
  python3 test/icon_v19.py --pick=2 --pal=K    # 做成正式图标（会提示提 VERSION）

⚠️ 换图标后必须把 sw.js 的 VERSION 提一档，否则手机上不换。
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import PALETTES, tile, disc_color, far_radius          # 材质引擎，一个像素不改
from icon_v18 import (SS, SAFE, ZH_FONT, circle_mask, ellipse_mask, rrect, poly_mask,
                      stroke, stroke_var, arc_band, wedge, text_mask, union, punched, _blob)


# ═══════════════════════════ 四套配色体系 ═══════════════════════════
PAL19 = {
    'K': dict(PALETTES['C'], id='K'),          # 深咖 · 暖金（现在这套，仍然保留）
    'Q': dict(id='Q', name='青玉 · 深', desc='深青底 · 玉色符号 —— 清音玉振',
              tile=((32, 58, 64), (10, 24, 29)), glow=(84, 166, 158),
              disc=((228, 247, 241), (124, 196, 182)), bar=None, shadow=(0, 0, 0)),
    'R': dict(id='R', name='墨 · 赤', desc='深墨红底 · 暖金符号 —— 朱砂的正统用法',
              tile=((60, 26, 24), (20, 9, 9)), glow=(178, 74, 54),
              disc=((247, 224, 192), (208, 150, 96)), bar=None, shadow=(0, 0, 0)),
    'J': dict(id='J', name='满金 · 亮', desc='满金底 · 深咖符号 —— 反转，桌面上最跳',
              tile=((238, 208, 150), (198, 160, 98)), glow=(255, 246, 218),
              disc=((46, 35, 25), (22, 16, 11)), bar=None, shadow=(120, 96, 58)),
    'N': dict(id='N', name='博艺蓝', desc='跟机构徽章同色系 —— 机构一套视觉',
              tile=((62, 78, 112), (20, 29, 49)), glow=(104, 132, 176),
              disc=((238, 243, 251), (152, 174, 206)), bar=None, shadow=(0, 0, 0)),
}
PAL_ORDER = ['K', 'Q', 'R', 'J', 'N']


# ═══════════════════════════ 八个方案 ═══════════════════════════
def sh_lip(W):
    """01 石之唇 —— 一整块厚石，正中一道「振动缝」（负形）。

    缝的两端收尖、中段最宽，是真正弦 —— 不是随手画的折线。
    整块看是磨石（砺），那道缝看是声带／闭合的唇（声）。形与意长在同一个形状上。
    """
    block = rrect(W, 0.500, 0.500, 0.660, 0.580, 0.150)
    n = 110
    pts, ws = [], []
    for i in range(n + 1):
        t = i / n
        pts.append((0.215 + 0.570 * t, 0.500 + 0.070 * math.sin(t * math.pi * 2.15)))
        ws.append(0.012 + 0.058 * math.sin(math.pi * t) ** 0.55)
    return punched(block, stroke_var(W, pts, ws))


def sh_split(W):
    """02 破石 —— 一道粗声浪自左贯右，把磐石劈开。

    浪在石内是**缝**（负形，露出底色），出了石就是**浪**（金）。
    两块金色不相连 —— 一眼读得出"声从石里穿出来"，而不是"石上画了条线"。
    """
    stone = _blob(W, 0.500, 0.500, 0.326, phase=0.35)
    n = 120
    pts, ws = [], []
    for i in range(n + 1):
        t = i / n
        pts.append((0.170 + 0.660 * t, 0.500 - 0.092 * math.sin(t * math.pi * 1.55)))
        ws.append(0.084)
    wave = stroke_var(W, pts, ws)
    return union(punched(stone, wave), punched(wave, stone))


def sh_grind(W):
    """03 磨石 —— 磐石上留下两道磨痕，一长一短、都不到底。

    两条平行、不等长、不去穿中心 —— 所以不会读成「禁止」符。
    """
    stone = _blob(W, 0.500, 0.500, 0.338, phase=2.1)
    m1 = stroke(W, [(0.205, 0.672), (0.735, 0.318)], 0.058)
    m2 = stroke(W, [(0.262, 0.818), (0.566, 0.645)], 0.052)
    return punched(stone, union(m1, m2))


def sh_qing(W):
    """04 磬浪 —— 一道厚实的曲尺形石带：磬（击石而鸣）本身就是一记声浪。

    左端收细、中段最厚、右端收到尖 —— 绸缎般的粗细变化，但整体是**实体块**，
    不是细线，所以 32px 下不会断，也不会读成蛇。
    """
    n = 130
    pts, ws = [], []
    for i in range(n + 1):
        t = i / n
        x = 0.225 + 0.550 * t
        y = 0.690 - 0.360 * t + 0.060 * math.sin(t * math.pi * 2)
        pts.append((x, y))
        ws.append(0.082 + 0.074 * math.sin(math.pi * t) ** 0.72)
    return stroke_var(W, pts, ws)


def sh_peaks(W):
    """05 声之峰 —— 底是石、顶是声浪的峰。山与声长在同一个形上，不是并排摆。

    （v18 最受认可的那个，这轮把底座加厚、峰顶收圆，更像石头不像皇冠。）
    """
    n = 300
    x0, x1, base = 0.216, 0.784, 0.600
    pts = []
    for i in range(n + 1):
        t = i / n
        env = 0.68 + 0.32 * math.sin(math.pi * t)
        h = 0.238 * env * abs(math.sin(3 * math.pi * t)) ** 1.30
        pts.append((x0 + (x1 - x0) * t, base - h))
    pts += [(x1, base + 0.146), (x0, base + 0.146)]
    return poly_mask(W, pts, soft=0.010)


def sh_ring(W):
    """06 声之门 —— 一道厚圆环，环上开一个口，声正从口里出来。

    环 = 石（砺）／口；开口处的短波 = 声。整体是**负形的口**，不是"框里画一横"。
    """
    outer = circle_mask(W, 0.500, 0.500, 0.352)
    inner = circle_mask(W, 0.500, 0.500, 0.222)
    ring = punched(outer, inner)
    gap = wedge(W, 0.500, 0.500, 0.60, -46, 46)          # 右侧开口
    ring = punched(ring, gap)
    n = 40
    pts, ws = [], []
    for i in range(n + 1):
        t = i / n
        pts.append((0.300 + 0.180 * t, 0.500 + 0.088 * math.sin(t * math.pi * 1.2)))
        ws.append(0.014 + 0.056 * math.sin(math.pi * t) ** 0.6)
    return union(ring, stroke_var(W, pts, ws))


def sh_sheng(W):
    """07 「声」满铺 —— 整块金，中间一个深色的「声」。

    满铺是微信绿／小红书红的做法：图标本身就是一块色，不再是"底 + 小符号"。
    """
    return text_mask(W, '声', 0.668)


def sh_li(W):
    """08 「砺」满铺 —— 同上，换成「砺」：从石，磨也。"""
    return text_mask(W, '砺', 0.650)


SHAPES = [
    (1, '石之唇', sh_lip, 'solid', '石上一道振动的缝 —— 磨石（砺）与声带／唇（声）是同一个形'),
    (2, '破石', sh_split, 'solid', '声浪把磐石劈开：石内是缝、石外是浪，两段金色不相连'),
    (3, '磨石', sh_grind, 'solid', '两道磨痕，一长一短、都不到底 —— 磨砺的痕迹'),
    (4, '磬浪', sh_qing, 'solid', '磬（击石而鸣）＝ 一记声浪：中段最厚、两端收细的实体石带'),
    (5, '声之峰', sh_peaks, 'solid', '底是石、顶是声 —— 山与声长在同一个形上（v18 那个的加强版）'),
    (6, '声之门', sh_ring, 'solid', '厚环开口，声正从口里出来 —— 环是石／口，开口处是声'),
    (7, '声·满铺', sh_sheng, 'field', '整块金 + 深色的「声」：满铺做法，不再是"底+小符号"'),
    (8, '砺·满铺', sh_li, 'field', '同上，「砺」：从石，磨也'),
    (9, '破石·满铺', sh_split, 'field', '破石改用满铺：整块金，石与声浪是挖出来的深色 —— 对比最强'),
]

SANDBOX = {1, 2, 3, 4, 5, 6, 7, 8}


# ═══════════════════════════ 渲染 ═══════════════════════════
def render(size, shape_id, pal_tag='K', rounded=True):
    """mode='field' = 满铺（金底 + 深色负形符号）；否则符号压在底上。"""
    entry = next(s for s in SHAPES if s[0] == shape_id)
    _, _, fn, mode, _ = entry
    pal = PAL19[pal_tag]
    W = size * SS
    cv = tile(W, pal)
    mask = fn(W)

    if mode == 'field':
        plate_m = rrect(W, 0.5, 0.5, 1.40, 1.40, 0.32)      # 满铺，四角溢出画布
        fill_m = punched(plate_m, mask)                       # 符号被挖成深色
    else:
        fill_m = mask

    # 极轻落影（纯平色块正是"旧"的来源之一）
    sh = fill_m.filter(ImageFilter.GaussianBlur(W * 0.020)).point(lambda v: int(v * 0.30))
    sc = Image.new('RGBA', (W, W), pal['shadow'] + (255,))
    sc.putalpha(sh)
    plate = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    plate.paste(sc, (0, int(W * 0.016)))
    cv.alpha_composite(plate)

    gold = disc_color(W, pal)
    gold.putalpha(fill_m)
    cv.alpha_composite(gold)

    r = far_radius(W, mask)      # 检查「符号」而不是整块金 —— 满铺时被裁掉的只是金色的角
    if rounded:
        mm = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mm).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(mm)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ═══════════════════════════ 出图 ═══════════════════════════
def compare(pal_tag='K'):
    """八个方案并排，每个挂五个真机尺寸。"""
    cols, cw, ch = 4, 356, 452
    rows = math.ceil(len(SHAPES) / cols)
    W = 60 * 2 + cols * cw
    H = 214 + rows * ch + 30
    cv = Image.new('RGB', (W, H), (243, 241, 236))
    d = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 34); f2 = ImageFont.truetype(ZH_FONT, 23)
    f3 = ImageFont.truetype(ZH_FONT, 17); f4 = ImageFont.truetype(ZH_FONT, 15)
    INK = (32, 30, 27)
    d.text((60, 30), '砺蕴 · 桌面图标 v19 · 破模板（八个方案）', font=f1, fill=INK)
    d.text((60, 80), '换的不是剪影，是骨架：石做底、声从石里出来；其中 07/08 是「满铺」做法。', font=f2, fill=(108, 102, 94))
    d.text((60, 116), '配色：深咖 · 暖金（沿用现在这套）', font=f3, fill=(140, 132, 122))

    for k, (i, name, fn, mode, note) in enumerate(SHAPES):
        r_, c_ = divmod(k, cols)
        x, y = 60 + c_ * cw, 214 + r_ * ch
        big, rr = render(252, i, pal_tag)
        cv.paste(big, (x + 26, y), big)
        yy = y + 252 + 22
        xx = x + 8
        for px in (120, 76, 60, 44, 32):
            im, _ = render(px, i, pal_tag)
            cv.paste(im, (xx, yy + (120 - px) // 2), im)
            xx += px + 12
        d.text((x + 8, yy + 132), f'{i:02d} {name}', font=f2, fill=INK)
        d.text((x + 8, yy + 164), note[:26], font=f4, fill=(112, 106, 98))
        if len(note) > 26:
            d.text((x + 8, yy + 184), note[26:52], font=f4, fill=(112, 106, 98))
        d.text((x + 8, yy + 208), f'安全半径 {rr:.3f} / 上限 {SAFE:.3f} ' +
               ('OK' if rr <= SAFE else '超标'), font=f4,
               fill=(70, 100, 70) if rr <= SAFE else (170, 60, 60))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'图标v19_八案_{pal_tag}.png')
    cv.save(p)
    return p


def pal_sheet(shape_ids=(2, 4, 7)):
    """同一批方案 × 五套配色 —— 形与色分开判断。"""
    names = {s[0]: s[1] for s in SHAPES}
    cols, cw, ch = len(PAL_ORDER), 300, 344
    W = 100 + cols * cw
    H = 288 + len(shape_ids) * ch + 30
    cv = Image.new('RGB', (W, H), (243, 241, 236))
    d = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 34); f2 = ImageFont.truetype(ZH_FONT, 21)
    f3 = ImageFont.truetype(ZH_FONT, 17)
    INK = (32, 30, 27)
    d.text((100, 30), '砺蕴 · 桌面图标 v19 · 五套配色对照', font=f1, fill=INK)
    d.text((100, 80), '形定了之后颜色还能单独调。深咖金是「藏」的气质，其余三套才是参照 App 那种「出」。', font=f2, fill=(108, 102, 94))
    for c, tag in enumerate(PAL_ORDER):
        p = PAL19[tag]
        d.text((100 + c * cw + 12, 216), p['name'], font=f3, fill=(64, 60, 54))
        d.text((100 + c * cw + 12, 240), p['desc'][:15], font=ImageFont.truetype(ZH_FONT, 14), fill=(146, 140, 132))
    for r_, sid in enumerate(shape_ids):
        y = 288 + r_ * ch
        d.text((16, y + 118), f'{sid:02d}', font=f3, fill=(150, 144, 136))
        d.text((12, y + 142), names[sid], font=f3, fill=(110, 104, 96))
        for c, tag in enumerate(PAL_ORDER):
            im, _ = render(252, sid, tag)
            cv.paste(im, (100 + c * cw + 12, y), im)
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '图标v19_五配色.png')
    cv.save(p)
    return p


def home_grid(shape_ids, pal_map=None, stem='图标v19_桌面同屏'):
    """把「现在线上的」和候选**并排放进同一张手机桌面** ——
    单独看每张都会觉得还行，只有并排才看得出谁在桌面上最跳、谁最糊。"""
    pal_map = pal_map or {i: 'K' for i in shape_ids}
    W, H = 960, 1040
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
    dr.text((W / 2, 202), '9月23日 星期三', font=f2, fill=(212, 218, 232), anchor='mm')

    ic, gap = 136, 40
    cols = 4
    gw = cols * ic + (cols - 1) * gap
    x0 = (W - gw) // 2
    y0 = 268

    names = {s[0]: s[1] for s in SHAPES}
    cells = [('now', '现在线上')] + [(i, f'{i:02d} {names[i]}') for i in shape_ids]
    ph = [(152, 160, 176), (182, 152, 138), (140, 168, 158), (162, 152, 184),
          (184, 172, 142), (142, 160, 188), (170, 142, 152), (148, 172, 152)]
    rows = math.ceil((len(cells) + 1) / cols)
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
            if os.path.exists(src):
                im = Image.open(src).convert('RGBA').resize((ic, ic), Image.LANCZOS)
            else:
                im, _ = render(ic, 5, 'K')
            cv.paste(im, (x, y), im)
            mark = (255, 226, 160)
        else:
            im, _ = render(ic, idx, pal_map.get(idx, 'K'))
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
            im, _ = render(ic, shape_ids[0], pal_map.get(shape_ids[0], 'K'))
            cv.paste(im, (x, dy + 17), im)
        else:
            b = Image.new('RGBA', (ic, ic), ph[(c_ + 3) % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, dy + 17), b)
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'{stem}.png')
    cv.convert('RGB').save(p)
    return p


def main():
    pick, pal = None, 'K'
    for a in sys.argv[1:]:
        if a.startswith('--pick='):
            pick = int(a.split('=', 1)[1])
        if a.startswith('--pal='):
            pal = a.split('=', 1)[1]

    print('maskable 安全自检（符号层最远半径，上限 %.3f）：' % SAFE)
    bad = []
    for i, name, fn, mode, _ in SHAPES:
        m = fn(512)
        r = far_radius(512, m)
        if r > SAFE:
            bad.append((i, name, r))
        print(f'  {i:02d} {name:<7} {r:.3f}  ' + ('OK' if r <= SAFE else '❌ 超'))

    print('八案（深咖金）：', compare('K'))
    print('五配色对照：', pal_sheet((2, 4, 9)))
    print('桌面同屏：', home_grid([1, 2, 4, 5, 6, 7, 9], {i: 'K' for i in range(1, 10)}))
    print('桌面同屏（新配色）：', home_grid([7, 9, 2, 4], {7: 'J', 9: 'J', 2: 'R', 4: 'Q'},
                                        '图标v19_桌面同屏_新色'))

    # 我的首推：单独出大图
    for sid, tag in ((2, 'K'), (2, 'R'), (4, 'Q'), (9, 'J'), (1, 'Q'), (9, 'K')):
        im, _ = render(512, sid, tag)
        im.save(os.path.join(REVIEW, f'图标v19_{sid:02d}_{tag}.png'))
    print('首推单图已出：02破石 / 04磬浪 / 09破石满铺 / 01石之唇 × 各配色')

    if pick is not None:
        made = []
        for px, name in [(512, 'icon.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
            im, r = render(px, pick, pal)
            if r > SAFE:
                print('❌ 超出 maskable 安全圆，先改几何'); sys.exit(1)
            im.convert('RGB').save(os.path.join(ROOT, name))
            made.append(name)
        print(f'正式图标 = {pick:02d} · {PAL19[pal]["name"]}，写出：' + '、'.join(made))
        print('⚠️ 记得把 sw.js 的 VERSION 提一档再推。')


if __name__ == '__main__':
    main()
