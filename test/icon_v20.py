#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v20 —— 满铺 · 声山

v19 得出的两条硬结论（都在真机桌面上验过）
==========================================
1. **做法比形更决定成败。** v19 九个方案并排放进手机桌面，
   只有「满铺」那两个（整块金 + 深色符号）一眼跳出来；
   其余"深咖底 + 金色符号"的，远看全都糊成一块深色方块。
   —— 这就是微信绿 / 小红书红 / 芒果橙的做法，也是用户列的参照 App 的共同点。

2. **石换成山。** v19 里"石"这条线全部失败：石头像花生、劈缝像绳捆、
   磬浪像虫。原因是**石头没有方向、没有情绪**；山有。
   而用户 U9 点名要过「千里江山图那种山岳感觉」——
   并且《千里江山图》用的正是**石青 · 石绿**（矿物颜料，青出于蓝，本来就是「蕴」）。

v20 就把这两条合起来：**满铺石青／暖金底 + 深色的「声之山」**。
山脊用**高斯峰叠加**画，不是 abs(sin) —— 后者会变成等距锯齿（＝皇冠、＝牙齿）。

用法
----
  python3 test/icon_v20.py                    # 出全部对照图
  python3 test/icon_v20.py --pick=2 --pal=G   # 做成正式图标（会提示提 VERSION）
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import PALETTES, tile, disc_color, far_radius
from icon_v18 import (SS, SAFE, ZH_FONT, circle_mask, rrect, poly_mask,
                      stroke, stroke_var, text_mask, union, punched)


# ═══════════════════════════ 配色：满铺做法 ═══════════════════════════
# 满铺 = 整块是主色（tile 与 disc 同色系，符号用 'ink' 深色挖出）
PAL20 = {
    'J': dict(name='暖金 · 满铺', short='金', desc='整块暖金 + 深咖的声山（桌面上最跳）',
              tile=((226, 194, 138), (190, 154, 96)), glow=(255, 244, 214),
              disc=((226, 194, 138), (190, 154, 96)), bar=None,
              ink=((44, 34, 24), (24, 18, 13)), shadow=(122, 96, 56)),
    'G': dict(name='石青 · 石绿', short='青绿', desc='《千里江山图》的矿物色（青出于蓝＝蕴）',
              tile=((44, 104, 118), (16, 52, 68)), glow=(110, 186, 168),
              disc=((44, 104, 118), (16, 52, 68)), bar=None,
              ink=((238, 246, 232), (176, 210, 190)), shadow=(0, 14, 20)),
    'R': dict(name='墨 · 赤', short='墨赤', desc='深墨红 + 暖金的声山（朱砂的正统用法）',
              tile=((104, 38, 32), (44, 16, 14)), glow=(206, 96, 66),
              disc=((104, 38, 32), (44, 16, 14)), bar=None,
              ink=((250, 226, 196), (222, 172, 118)), shadow=(20, 4, 4)),
    'K': dict(name='深咖 · 暖金', short='深咖', desc='沿用现在这套 —— 沉稳、金贵，但桌面最暗',
              tile=((52, 40, 29), (20, 15, 11)), glow=(126, 90, 46),
              disc=((228, 192, 128), (168, 128, 76)), bar=None,
              ink=((26, 20, 15), (12, 9, 7)), shadow=(0, 0, 0)),
}
PAL_ORDER = ['J', 'G', 'R', 'K']


# ═══════════════════════════ 「声之山」六个变体 ═══════════════════════════
def _h(t, peaks, ripple=0.0, rfreq=3.4, rphase=0.0):
    """山脊高度：高斯峰叠加（平滑、自然、有主次）+ 一点点细碎起伏。

    ⚠️ 不用 abs(sin)：那会得出等距尖齿 —— 一眼就是皇冠／牙齿。
    用高斯：主峰高、侧峰低、峰间自然下凹，才像山。
    """
    v = 0.0
    for (c, w, a) in peaks:
        v += a * math.exp(-((t - c) / w) ** 2)
    if ripple:
        v += ripple * math.sin(2 * math.pi * rfreq * t + rphase)
    return v


def mk_ridge(peaks, x0=0.205, x1=0.795, base=0.716, root=0.058, bottom=0.786,
             ripple=0.019, rphase=0.0):
    """一组峰参数 → 一个「声之山」。

    山根（root）向内收、底边压到 bottom —— 这样是一座**立着的山**，
    而不是"一条展台 + 山上摆着个形"（那会读成风景插画，不像图标）。
    """
    def f(W):
        n = 380
        pts = []
        for i in range(n + 1):
            t = i / n
            pts.append((x0 + (x1 - x0) * t, base - _h(t, peaks, ripple, rphase=rphase)))
        pts += [(x1 - root, bottom), (x0 + root, bottom)]
        return poly_mask(W, pts, soft=0.009)
    return f


def sh_mtn_wave(W):
    """09 山中有声 —— 一座立着的山，山体里一道声波（负形挖出、露出主色）。

    这是「砺蕴」三个字合在一处：山＝砺（磨）与蕴（积累），
    山体里那道波＝声。不是山上画条线，是**把波从山里挖出来**。
    """
    mtn = mk_ridge([(0.340, 0.200, 0.360), (0.730, 0.150, 0.215)], ripple=0.016)(W)
    n = 120
    pts, ws = [], []
    for i in range(n + 1):
        t = i / n
        pts.append((0.232 + 0.536 * t, 0.628 - 0.082 * math.sin(t * math.pi * 2.5)))
        ws.append(0.016 + 0.046 * math.sin(math.pi * t) ** 0.5)
    return punched(mtn, stroke_var(W, pts, ws))


def sh_wave(W):
    """08 声浪 —— 满铺主色上的一道粗声浪：中段最厚、两端收到尖。

    这是把「声音」说得最直白的一版：不是三条柱（＝柱状图），
    是一条**有粗细变化的波**——像绸缎，也像一句拖长的音。
    """
    n = 150
    pts, ws = [], []
    for i in range(n + 1):
        t = i / n
        pts.append((0.172 + 0.656 * t, 0.500 - 0.128 * math.sin((t - 0.5) * math.pi * 2 * 1.35)))
        ws.append(0.028 + 0.120 * math.sin(math.pi * t) ** 0.42)
    return stroke_var(W, pts, ws)


def sh_waveform(W):
    """10 声纹 —— 一列高低起伏的粗短柱：音频波形的标准画法。

    ⚠️ 和「柱状图」的区别，就在这三条上：
      柱状图是 3~5 根、**等距等差、站在一条基线上**；
      这里是 9 根、**紧密排布、中线对齐、高度按包络起伏** —— 一眼是"声音"。
    播客／语音消息／音乐 App 用的都是这个形，大众认知成本最低。
    """
    env = [0.30, 0.62, 0.44, 0.88, 0.58, 1.00, 0.50, 0.72, 0.34]
    n = len(env); bw, gap = 0.044, 0.022
    total = n * bw + (n - 1) * gap
    cx0 = 0.5 - total / 2 + bw / 2
    parts = []
    for i, e in enumerate(env):
        parts.append(rrect(W, cx0 + i * (bw + gap), 0.5, bw, max(e * 0.540, 0.070), bw * 0.49))
    return union(*parts)


# ═══════════════════════════ 形状清单 ═══════════════════════════
SHAPES = [
    (1, '主峰', mk_ridge([(0.340, 0.200, 0.375), (0.735, 0.150, 0.215)]),
     '一主一侧：主峰偏左、侧峰矮一头 —— 最像真的山'),
    (2, '双峰', mk_ridge([(0.305, 0.160, 0.355), (0.665, 0.160, 0.330)]),
     '两峰相当，中间一道鞍 —— 声浪的一个完整周期'),
    (3, '叠峰', mk_ridge([(0.215, 0.140, 0.250), (0.465, 0.130, 0.320), (0.725, 0.150, 0.375)]),
     '三峰层叠、一峰比一峰高 —— 练萃积蕴，层层成山'),
    (4, '缓山', mk_ridge([(0.360, 0.265, 0.290), (0.705, 0.205, 0.235)], ripple=0.013),
     '低缓绵延，起伏很轻 —— 最安静的一版'),
    (5, '独峰', mk_ridge([(0.500, 0.215, 0.425)], ripple=0.016),
     '只有一座主峰，两侧展开 —— 最简、最稳'),
    (6, '远山', mk_ridge([(0.235, 0.155, 0.270), (0.510, 0.150, 0.290), (0.780, 0.155, 0.270)], ripple=0.021),
     '三峰等距但高低微差 —— 远山连绵'),
    (7, '声之峰', mk_ridge([(0.300, 0.180, 0.360), (0.520, 0.120, 0.230), (0.740, 0.145, 0.280)]),
     '主峰 + 两个副峰，起伏最密 —— 最像声浪的一版'),
    (8, '声浪', sh_wave,
     '一道粗声浪：中段最厚、两端收尖 —— 绸缎般的粗细变化，最直白的「声音」'),
    (9, '山中有声', sh_mtn_wave,
     '一座立着的山，山里挖出一道声波 —— 砺（山）· 蕴（积）· 声，三意在同一个形上'),
    (10, '声纹', sh_waveform,
     '一列起伏的粗短柱（音频波形）—— 中线对齐、紧密排布，不是柱状图'),
]


BY_ID = {s[0]: s for s in SHAPES}


# ═══════════════════════════ 渲染 ═══════════════════════════
def ink_layer(W, pal):
    """符号（山）的颜色层：竖向渐变，顶亮底沉 —— 平色块会显得"旧"。"""
    hi, lo = np.array(pal['ink'][0], float), np.array(pal['ink'][1], float)
    t = np.linspace(0, 1, W)[:, None]
    g = hi[None, None, :] * (1 - t[..., None]) + lo[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    return Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def render(size, shape_id, pal_tag='J', mode='field', rounded=True):
    """mode='field' 满铺（主色底 + 深色符号）；'solid' 深底 + 亮符号。"""
    fn = BY_ID[shape_id][2]
    pal = PAL20[pal_tag]
    W = size * SS
    cv = tile(W, pal)
    mask = fn(W)

    if mode == 'field':
        # 满铺：**底就是主色**（tile 本身铺满整块画布），山用深色挖出来
        fill_m = mask
        layer = ink_layer(W, pal)
    else:
        # 对照：深底 + 亮符号（沿用现有那套）
        fill_m = mask
        layer = disc_color(W, pal)

    sh = fill_m.filter(ImageFilter.GaussianBlur(W * 0.020)).point(lambda v: int(v * 0.30))
    sc = Image.new('RGBA', (W, W), pal['shadow'] + (255,))
    sc.putalpha(sh)
    plate = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    plate.paste(sc, (0, int(W * 0.016)))
    cv.alpha_composite(plate)

    layer.putalpha(fill_m)
    cv.alpha_composite(layer)

    r = far_radius(W, mask)
    if rounded:
        mm = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mm).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(mm)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ═══════════════════════════ 出图 ═══════════════════════════
def compare(pal_tag='J', mode='field'):
    """七个山形并排 + 五个真机尺寸。"""
    cols, cw, ch = 4, 356, 448
    rows = math.ceil(len(SHAPES) / cols)
    W = 60 * 2 + cols * cw
    H = 226 + rows * ch + 30
    cv = Image.new('RGB', (W, H), (243, 241, 236))
    d = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 34); f2 = ImageFont.truetype(ZH_FONT, 23)
    f4 = ImageFont.truetype(ZH_FONT, 15)
    INK = (32, 30, 27)
    p = PAL20[pal_tag]
    d.text((60, 30), '砺蕴 · 桌面图标 v20 · 声之山（满铺做法）', font=f1, fill=INK)
    d.text((60, 80), '山脊＝声浪的包络：山有方向、有情绪，石头没有。整块 %s，山是挖出来的深色。' % p['short'],
           font=f2, fill=(108, 102, 94))
    d.text((60, 116), '配色：%s —— %s' % (p['name'], p['desc']), font=f4, fill=(140, 132, 122))

    for k, (i, name, fn, note) in enumerate(SHAPES):
        r_, c_ = divmod(k, cols)
        x, y = 60 + c_ * cw, 226 + r_ * ch
        big, rr = render(250, i, pal_tag, mode)
        cv.paste(big, (x + 26, y), big)
        yy = y + 250 + 22
        xx = x + 8
        for px in (120, 76, 60, 44, 32):
            im, _ = render(px, i, pal_tag, mode)
            cv.paste(im, (xx, yy + (120 - px) // 2), im)
            xx += px + 12
        d.text((x + 8, yy + 132), f'{i:02d} {name}', font=f2, fill=INK)
        d.text((x + 8, yy + 166), note[:27], font=f4, fill=(112, 106, 98))
        if len(note) > 27:
            d.text((x + 8, yy + 186), note[27:54], font=f4, fill=(112, 106, 98))
        d.text((x + 8, yy + 210), f'安全半径 {rr:.3f} / 上限 {SAFE:.3f} ' +
               ('OK' if rr <= SAFE else '超标'), font=f4,
               fill=(70, 100, 70) if rr <= SAFE else (170, 60, 60))
    os.makedirs(REVIEW, exist_ok=True)
    pth = os.path.join(REVIEW, f'图标v20_七山_{pal_tag}_{mode}.png')
    cv.save(pth)
    return pth


def pal_sheet(shape_ids=(1, 5, 3)):
    """三个山形 × 四套满铺配色。"""
    names = {s[0]: s[1] for s in SHAPES}
    cols, cw, ch = len(PAL_ORDER), 304, 350
    W = 110 + cols * cw
    H = 300 + len(shape_ids) * ch + 30
    cv = Image.new('RGB', (W, H), (243, 241, 236))
    d = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 34); f2 = ImageFont.truetype(ZH_FONT, 21)
    f3 = ImageFont.truetype(ZH_FONT, 17); f4 = ImageFont.truetype(ZH_FONT, 14)
    INK = (32, 30, 27)
    d.text((110, 30), '砺蕴 · 桌面图标 v20 · 四套满铺配色', font=f1, fill=INK)
    d.text((110, 80), '形定了之后颜色单独调。前两套是参照 App 那种「亮」；深咖是现在这套，最暗最闷。', font=f2, fill=(108, 102, 94))
    for c, tag in enumerate(PAL_ORDER):
        p = PAL20[tag]
        d.text((110 + c * cw + 14, 224), p['name'], font=f3, fill=(64, 60, 54))
        d.text((110 + c * cw + 14, 250), p['desc'][:16], font=f4, fill=(146, 140, 132))
    for r_, sid in enumerate(shape_ids):
        y = 300 + r_ * ch
        d.text((18, y + 120), f'{sid:02d}', font=f3, fill=(150, 144, 136))
        d.text((14, y + 146), names[sid], font=f3, fill=(110, 104, 96))
        for c, tag in enumerate(PAL_ORDER):
            im, _ = render(256, sid, tag, 'field')
            cv.paste(im, (110 + c * cw + 14, y), im)
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '图标v20_四配色.png')
    cv.save(p)
    return p


def home_grid(shape_ids, pal_map=None, stem='图标v20_桌面同屏'):
    pal_map = pal_map or {i: 'J' for i in shape_ids}
    W, H = 960, 1060
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

    ic, gap, cols = 136, 40, 4
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
            im = (Image.open(src).convert('RGBA').resize((ic, ic), Image.LANCZOS)
                  if os.path.exists(src) else render(ic, 1, 'K', 'solid')[0])
            cv.paste(im, (x, y), im)
            mark = (255, 226, 160)
        else:
            im, _ = render(ic, idx, pal_map.get(idx, 'J'), 'field')
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
            im, _ = render(ic, shape_ids[0], pal_map.get(shape_ids[0], 'J'), 'field')
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
    pick, pal, mode = None, 'J', 'field'
    for a in sys.argv[1:]:
        if a.startswith('--pick='):
            pick = int(a.split('=', 1)[1])
        if a.startswith('--pal='):
            pal = a.split('=', 1)[1]
        if a.startswith('--mode='):
            mode = a.split('=', 1)[1]

    print('maskable 安全自检（符号层最远半径，上限 %.3f）：' % SAFE)
    bad = []
    for i, name, fn, _ in SHAPES:
        r = far_radius(512, fn(512))
        if r > SAFE:
            bad.append(name)
        print(f'  {i:02d} {name:<5} {r:.3f}  ' + ('OK' if r <= SAFE else '❌ 超'))

    print('十山（暖金满铺）：', compare('J', 'field'))
    print('十山（深咖填充，对照）：', compare('K', 'solid'))
    print('四配色：', pal_sheet((1, 10, 9)))
    print('桌面同屏 · 暖金满铺：', home_grid([1, 10, 3, 9, 5, 2], {i: 'J' for i in range(1, 11)}))
    print('桌面同屏 · 青绿/墨赤：', home_grid([1, 10, 9, 3], {1: 'G', 10: 'G', 9: 'R', 3: 'J'},
                                        '图标v20_桌面同屏_青绿'))

    for sid, tag in ((1, 'J'), (1, 'G'), (10, 'G'), (10, 'J'), (9, 'G'), (5, 'R'), (1, 'K')):
        im, _ = render(512, sid, tag, 'field')
        im.save(os.path.join(REVIEW, f'图标v20_{sid:02d}_{tag}.png'))
    print('单图已出：01主峰×金/青绿/深咖、10声纹×金/青绿、09山中有声×青绿、05独峰×墨赤')

    if pick is not None:
        made = []
        for px, name in [(512, 'icon.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
            im, r = render(px, pick, pal, mode)
            if r > SAFE:
                print('❌ 超出 maskable 安全圆'); sys.exit(1)
            im.convert('RGB').save(os.path.join(ROOT, name))
            made.append(name)
        print(f'正式图标 = {pick:02d} · {PAL20[pal]["name"]}，写出：' + '、'.join(made))
        print('⚠️ 记得把 sw.js 的 VERSION 提一档再推。')


if __name__ == '__main__':
    main()
