#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 工作系统 —— 手机桌面图标（「破石出声」· 重做版）

为什么推倒重来
==============
前几版（行书「砺」→ 破石圆盘 A/B/C → 各种几何变体 → 鹅卵石「磨面」）越做越丑，
根因只有一个：**把抽象语义画成了模糊插画，而不是做一个 logo。**

2025 年好图标就四条（查过行业趋势）：
  1 单一主导元素（细节一多，缩到 32px 就糊成一块）
  2 含义先到位（一眼知道干嘛的）—— 播音＝发声，声波 / 升浪是最直白的符号
  3 高对比 + 渐变出层次
  4 两三个颜色，最小尺寸仍立得住

而「破石出声」本来就有标准解法，也正是本项目**既有的品牌 mark**：
  金色磨石圆盘（砺＝石）＋ 三道升浪（声＝播音），最高一道**破顶**，
  石头被声音顶开一道口子 —— 这正是一个播音艺考中心最该讲的画面。
（素材：使用手册/assets/liyun_disc_gold.png）

所以本版只做一件事：**把这枚既有 mark，用现代、高级、高对比的方式重画成图标**，
而不是再发明一个别人看不懂的形。

  三根升浪 = 声（播音） / 圆盘 = 石（砺） / 金 = 蕴
  最高的那道浪突破圆盘上缘 —— 「破石出声」。

用法
----
  python3 test/make_app_mark.py                # 出候选对比图（不动正式图标）
  python3 test/make_app_mark.py --pick=B       # 用 B 出正式图标
  换图标后 ⚠️ 必须把 sw.js 的 VERSION 提一档（在预缓存清单里，否则不换）。
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')          # 选色用的对比图，已在 .gitignore 里

SS = 4                      # 超采样倍数（画完再缩，边缘才干净）
SAFE = 0.400                # maskable 安全圆半径（相对边长）—— 硬顶，别越
ZH_FONT = '/System/Library/Fonts/StHeiti Medium.ttc'

# ───────────────────────── 配色 ─────────────────────────
# 每套自成一体：tile 底 / glow 底上的暖晕 / disc 石盘 / bar 升浪 / shadow 落影。
# treat：'notch' 负空间刻痕（＝品牌既有画法，盘被浪刻开，最像标志）
#        'filled' 升浪填充压在盘上（浪色可自选，更醒目）
PALETTES = {
    'A': dict(
        treat='filled', name='墨金 · 浅',
        desc='米白底 · 墨石盘 · 金浪（同「极简·暖」）',
        tile=((250, 248, 244), (232, 226, 215)), glow=(255, 246, 226),
        disc=((62, 57, 49), (26, 24, 20)), bar=((233, 201, 146), (196, 163, 112)),
        shadow=(46, 38, 28)),
    'B': dict(
        treat='filled', name='金石 · 深',
        desc='深咖底 · 金盘 · 米白浪（最贵气）',
        tile=((52, 40, 29), (20, 15, 11)), glow=(126, 90, 46),
        disc=((216, 180, 118), (158, 120, 70)), bar=((253, 245, 230), (236, 218, 184)),
        shadow=(0, 0, 0)),
    'C': dict(
        treat='notch', name='刻痕 · 深',
        desc='品牌既有画法 · 金盘被浪刻开',
        tile=((50, 37, 27), (18, 13, 10)), glow=(120, 86, 44),
        disc=((234, 201, 142), (176, 136, 82)), bar=None, shadow=(0, 0, 0)),
    'D': dict(
        treat='filled', name='青金 · 深',
        desc='靛青底 · 深蓝盘 · 金浪（可选的「其他颜色」）',
        tile=((44, 60, 90), (14, 22, 38)), glow=(74, 106, 148),
        disc=((58, 84, 124), (26, 40, 62)), bar=((240, 218, 174), (214, 180, 120)),
        shadow=(0, 0, 0)),
}
TAGS = list(PALETTES)


# ───────────────────────── 基础绘制 ─────────────────────────
def circle_mask(W, cx, cy, r):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return m


def rrect_mask(W, cx, cy, w, h, rad):
    """圆角矩形（可做胶囊：rad=w/2）。三倍超采样再缩，圆角才干净。"""
    S = W * 3
    C = S / 2.0
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    X, Y = C + (cx - 0.5) * W, C + (cy - 0.5) * W
    Ww, Hh, R = w * W, h * W, rad * W
    d.rectangle([X - Ww / 2 + R, Y - Hh / 2, X + Ww / 2 - R, Y + Hh / 2], fill=255)
    d.rectangle([X - Ww / 2, Y - Hh / 2 + R, X + Ww / 2, Y + Hh / 2 - R], fill=255)
    for sx in (-1, 1):
        for sy in (-1, 1):
            ex, ey = X + sx * (Ww / 2 - R), Y + sy * (Hh / 2 - R)
            d.ellipse([ex - R, ey - R, ex + R, ey + R], fill=255)
    return m.crop((int(C - W / 2), int(C - W / 2), int(C + W / 2), int(C + W / 2)))


def _b(a):
    return np.asarray(a, dtype=np.int16)


def union(*masks):
    out = _b(masks[0])
    for m in masks[1:]:
        out = np.maximum(out, _b(m))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'L')


def punched(shape, cut):
    """shape 减去 cut（挖负空间）——「刻痕」画法就靠它把升浪从金盘里挖出来。"""
    return Image.fromarray(np.clip(_b(shape) - _b(cut), 0, 255).astype(np.uint8), 'L')


def far_radius(W, mask):
    """图形层里离画布中心最远的像素 / 边长 —— maskable 安全自检。

    ⚠️ 必须用**图形层自己的 alpha**算，不能拿合成图：底色不透明，
    合成图会把整张画布都当墨迹，得出 0.707 的假警报。
    """
    ys, xs = np.nonzero(np.array(mask) > 40)
    if len(xs) == 0:
        return 0.0
    c = W / 2.0
    return float(np.max(np.hypot(xs - c, ys - c))) / W


# ───────────────────────── 材质 ─────────────────────────
def tile(W, pal):
    """底：竖向渐变 + 盘后一团暖晕（造出「光从石头后面透出来」的错觉）。"""
    t = np.linspace(0, 1, W)[:, None]
    hi, lo = np.array(pal['tile'][0], float), np.array(pal['tile'][1], float)
    g = hi[None, None, :] * (1 - t[..., None]) + lo[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    yy, xx = np.mgrid[0:W, 0:W]
    d = np.hypot(xx - W / 2, yy - W * 0.46) / (W * 0.62)
    glow = np.clip(1 - d, 0, 1) ** 2 * 0.18
    g = g * (1 - glow[..., None]) + np.array(pal['glow'], float)[None, None, :] * glow[..., None]
    return Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def disc_color(W, pal):
    """石盘材质：离轴径向渐变（光自左上）。一块平色圆盘正是「旧」的来源。"""
    yy, xx = np.mgrid[0:W, 0:W].astype(float)
    d = np.hypot((xx - W * 0.40) / (W * 0.95), (yy - W * 0.38) / (W * 0.95))
    t = np.clip(d, 0, 1) ** 1.25
    hi, lo = np.array(pal['disc'][0], float), np.array(pal['disc'][1], float)
    g = hi[None, None, :] * (1 - t[..., None]) + lo[None, None, :] * t[..., None]
    return Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def bar_color(W, pal):
    """升浪材质：竖向渐变，顶亮底沉，浪头才立得起来。"""
    t = np.linspace(0, 1, W)[:, None]
    hi, lo = np.array(pal['bar'][0], float), np.array(pal['bar'][1], float)
    g = hi[None, None, :] * (1 - t[..., None]) + lo[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    return Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')


# ───────────────────── 主角：磨石圆盘 + 三道升浪 ─────────────────────
def geom():
    """归一化几何（全部 0~1，**不预乘 W**）。

    ⚠️ `rrect_mask` 内部会再乘一次 W（它要的是归一化小数），传绝对像素
    会把尺寸变成天文数字、画到画布外 → mask 全空、升浪一根都看不见。

    三根升浪左短、中高、右最高，最高的那道**突破圆盘上缘** ——
    这就是「破石出声」：最高的浪从石头里顶出来。
    """
    bw, gap = 0.082, 0.052
    total = 3 * bw + 2 * gap
    x0 = 0.5 - total / 2 + bw / 2
    return dict(cx=0.500, cy=0.520, dr=0.285, bw=bw, base=0.700,
                hs=[0.140, 0.260, 0.520],              # 左 → 右，越来越高
                xs=[x0 + i * (bw + gap) for i in range(3)])


def emblem_masks(W):
    g = geom()
    disc = circle_mask(W, g['cx'] * W, g['cy'] * W, g['dr'] * W)
    bars = [rrect_mask(W, x, g['base'] - h / 2, g['bw'], h, g['bw'] / 2)
            for x, h in zip(g['xs'], g['hs'])]
    return disc, bars


def compose(size, tag, rounded=False):
    """把某套配色渲染成图标。返回 (图, 最远半径)。"""
    W = size * SS
    pal = PALETTES[tag]
    treat = pal['treat']
    cv = tile(W, pal)

    disc_a, bar_masks = emblem_masks(W)
    cut = union(*bar_masks)

    if treat == 'notch':
        # 刻痕：升浪从**金盘里挖掉**，露出底色 —— 盘的上缘因此被最高一道浪刻开。
        fill_a = punched(disc_a, cut)
        allm = disc_a                      # 轮廓就是那个被刻开的盘
    else:
        fill_a = disc_a
        allm = union(disc_a, cut)

    # 极轻的落影：让整枚 mark 在底上「浮起来」一丁点 ——
    # 一片纯平的大色块正是「旧」的主要来源之一。
    sh = allm.filter(ImageFilter.GaussianBlur(W * 0.022))
    sh = sh.point(lambda v: int(v * 0.30))
    sc = Image.new('RGBA', (W, W), pal['shadow'] + (255,))
    sc.putalpha(sh)
    plate = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    plate.paste(sc, (0, int(W * 0.016)))
    cv.alpha_composite(plate)

    dc = disc_color(W, pal); dc.putalpha(fill_a)
    cv.alpha_composite(dc)

    if treat == 'filled':
        bc = bar_color(W, pal)
        for bm in bar_masks:               # 升浪压在石盘之上（最高的那道破顶而出）
            lay = bc.copy(); lay.putalpha(bm)
            cv.alpha_composite(lay)

    r = far_radius(W, allm)
    if rounded:                            # 套 iOS 那种圆角方：半径 ≈ 22.4%
        m = Image.new('L', (W, W), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(m)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ───────────────────────── 出图 ─────────────────────────
def contact_sheet(stem, title, sub):
    cols = len(TAGS)
    cw, ch = 366, 540
    W = 40 * 2 + cols * cw
    y0 = 150 + ch
    strip = 44 + sum(px + 16 for px in (120, 76, 60, 44, 32))
    H = y0 + strip + 34
    cv = Image.new('RGB', (W, H), (224, 220, 213))
    d = ImageDraw.Draw(cv)
    f = ImageFont.truetype(ZH_FONT, 31)
    ft = ImageFont.truetype(ZH_FONT, 25)
    fs = ImageFont.truetype(ZH_FONT, 17)

    d.text((40, 26), title, font=f, fill=(36, 33, 28))
    d.text((40, 74), sub, font=fs, fill=(112, 105, 96))

    y = 150
    for i, tag in enumerate(TAGS):
        x = 40 + i * cw
        big, r = compose(280, tag)
        cv.paste(big, (x + 43, y))
        xx = x
        for px in (120, 76, 60, 44):                 # 套圆角方，按真机图标大小看
            im, _ = compose(px, tag, rounded=True)
            cv.paste(im, (xx, y + 308 + (120 - px) // 2), im)
            xx += px + 12
        pal = PALETTES[tag]
        d.text((x, y + 452), f"{tag} · {pal['name']}", font=ft, fill=(36, 33, 28))
        d.text((x, y + 484), pal['desc'], font=fs, fill=(96, 90, 82))
        d.text((x, y + 512), f"最远半径 {r:.3f} / 上限 {SAFE:.3f} " +
               ('OK' if r <= SAFE else '超标'), font=fs,
               fill=(70, 100, 70) if r <= SAFE else (170, 60, 60))

    d.text((40, y0 - 4), '桌面真实大小（手机上就这么大 —— 唯一算数的检验标准）',
           font=ft, fill=(36, 33, 28))
    for row, px in enumerate((120, 76, 60, 44, 32)):
        yy = y0 + 40 + row * (px + 16)
        d.text((38, yy + px // 2 - 9), f'{px}px', font=fs, fill=(120, 114, 106))
        for i, tag in enumerate(TAGS):
            im, _ = compose(px, tag)
            cv.paste(im, (116 + i * (max(px, 44) + 36), yy))

    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'{stem}.png')
    cv.save(p)
    return p


def home_mock(tag, stem):
    """把图标**真放进手机桌面**里看 —— 「放桌面上好不好看」只能这样检验。"""
    W, H = 900, 960
    t = np.linspace(0, 1, H)[:, None]
    top, bot = np.array((48, 60, 90), float), np.array((17, 23, 38), float)
    g = top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.hypot(xx - W * 0.22, yy - H * 0.12) / (W * 0.75)
    gl = np.clip(1 - d, 0, 1) ** 2 * 0.32
    g = g * (1 - gl[..., None]) + np.array((96, 120, 165), float)[None, None, :] * gl[..., None]
    cv = Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    dr = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 96); f2 = ImageFont.truetype(ZH_FONT, 27); f3 = ImageFont.truetype(ZH_FONT, 21)
    dr.text((56, 34), '9:41', font=f3, fill=(255, 255, 255))
    dr.text((W - 56, 34), '5G  100%', font=f3, fill=(255, 255, 255), anchor='ra')
    dr.text((W / 2, 140), '9:41', font=f1, fill=(255, 255, 255), anchor='mm')
    dr.text((W / 2, 212), '9月20日 星期日', font=f2, fill=(214, 220, 234), anchor='mm')

    ic, gap = 132, 42
    cols, rows = 4, 2
    gw = cols * ic + (cols - 1) * gap
    x0 = (W - gw) // 2
    y0 = 300
    ours = {0, 5}
    ph = [(152, 160, 176), (182, 152, 138), (140, 168, 158), (162, 152, 184),
          (184, 172, 142), (142, 160, 188), (170, 142, 152), (148, 172, 152)]
    glyphs = ['circle', 'square', 'ring', 'tri', 'dot', 'bars', 'ring', 'dot']
    idx = 0
    for r in range(rows):
        for c in range(cols):
            x, y = x0 + c * (ic + gap), y0 + r * (ic + 62)
            if idx in ours:
                im, _ = compose(ic, tag, rounded=True)
                cv.paste(im, (x, y), im)
            else:
                tile_im = Image.new('RGBA', (ic, ic), (0, 0, 0, 0))
                m = Image.new('L', (ic, ic), 0)
                ImageDraw.Draw(m).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
                col = Image.new('RGBA', (ic, ic), ph[idx % len(ph)] + (255,))
                tile_im = Image.composite(col, tile_im, m)
                dd = ImageDraw.Draw(tile_im); m2 = ic / 2; cc = (255, 255, 255, 238)
                gg = glyphs[idx % len(glyphs)]
                if gg == 'circle':
                    dd.ellipse([m2 - ic * .15, m2 - ic * .15, m2 + ic * .15, m2 + ic * .15], fill=cc)
                elif gg == 'ring':
                    dd.ellipse([m2 - ic * .18, m2 - ic * .18, m2 + ic * .18, m2 + ic * .18],
                               outline=cc, width=int(ic * .075))
                elif gg == 'square':
                    dd.rounded_rectangle([m2 - ic * .15, m2 - ic * .15, m2 + ic * .15, m2 + ic * .15],
                                         radius=ic * .05, fill=cc)
                elif gg == 'tri':
                    dd.polygon([(m2, m2 - ic * .17), (m2 + ic * .17, m2 + ic * .13),
                                (m2 - ic * .17, m2 + ic * .13)], fill=cc)
                elif gg == 'dot':
                    for k in range(3):
                        dd.ellipse([m2 - ic * .20 + k * ic * .14, m2 - ic * .045,
                                    m2 - ic * .20 + k * ic * .14 + ic * .075, m2 + ic * .045], fill=cc)
                elif gg == 'bars':
                    for k, hh in enumerate((0.09, 0.19, 0.29)):
                        dd.rounded_rectangle([m2 - ic * .17 + k * ic * .125, m2 + ic * .15 - hh * ic,
                                              m2 - ic * .17 + k * ic * .125 + ic * .065, m2 + ic * .15],
                                             radius=ic * .03, fill=cc)
                cv.paste(tile_im, (x, y), tile_im)
            idx += 1

    # 底部 Dock：本图标排第一
    dw, dh = W - 140, ic + 34
    dy = y0 + rows * (ic + 62) + 34
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
            im, _ = compose(ic, tag, rounded=True)
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


def main():
    pick, sheet = None, True
    for a in sys.argv[1:]:
        if a.startswith('--pick='):
            pick = a.split('=', 1)[1]
        elif a == '--no-sheet':
            sheet = False

    print('maskable 安全自检（图形层 alpha 的最远半径，上限 %.3f）：' % SAFE)
    bad = []
    for t in TAGS:
        _, r = compose(512, t)
        ok = r <= SAFE
        if not ok:
            bad.append(t)
        print(f'  {t} {PALETTES[t]["name"]:<8} {r:.3f}  ' + ('OK' if ok else '❌ 超出安全圆'))

    if sheet:
        print('出图：', contact_sheet(
            '图标_破石出声_候选',
            '砺蕴 · 桌面图标 · 破石出声（重做 · 四套配色）',
            '三根升浪＝声（播音）／圆盘＝石（砺）／金＝蕴。最高的那道浪突破圆盘上缘 —— 破石出声。'))
        for t in ('B', 'C'):
            print('桌面实景：', home_mock(t, f'图标_桌面实景_{t}'))

    if pick:
        if pick not in PALETTES:
            print('未知配色', pick); sys.exit(2)
        _, r = compose(512, pick)
        if r > SAFE:
            print('❌ 超出 maskable 安全圆，安卓会切 —— 请调整几何'); sys.exit(1)
        made = []
        for px, name in [(512, 'icon.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
            im, _ = compose(px, pick)
            im.convert('RGB').save(os.path.join(ROOT, name))
            made.append(name)
        print(f'\n正式图标 = {pick} · {PALETTES[pick]["name"]}')
        print('写出：', '、'.join(made))

    if bad:
        print('\n⚠️ 超出安全圆：', '、'.join(bad))


if __name__ == '__main__':
    main()
