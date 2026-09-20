#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
砺蕴工作系统 —— 手机桌面图标生成器（纯图形版）

用户要求：桌面图标**不要文字，要图形**。所以这里一律用几何图形，
不出现任何汉字、字母、字标。

三个方向（都从项目原有的「破石出声」磨石圆盘长出来）：

  A 破石出声 · 深 —— 暖墨底 + 金盘 + 三道负空间**弧浪**，递增升高，最高一道破顶。
                    原版用的是三根**直棒**，缩到桌面读起来像柱状图/信号格；
                    改成弧线之后「升浪」的意思就立住了，柱状图的歧义也没了。
  B 石破        —— 金盘被一道折线裂纹劈成两半，两半沿裂纹法线错开。
  C 破石出声 · 浅 —— 和 A 同一套几何，换成暖米白底 + 暖墨盘 + 米白升浪。
                    不是新概念，是给一个真切的色调选择（深底稳重 / 浅底清亮）。

尺寸规矩（很重要，别乱改）：
  · maskable 安全圆半径 = 0.40 × 边长。Android 按圆形裁切，
    凡是「必须看得见」的图形都要落在这个圆里，否则会被切掉。
  · 安全自检用**图形层自己的 alpha** 算最远半径 —— 不能拿合成图算：
    底色不透明，合成图会把整张画布都当墨迹，得出 0.707 的假警报。
  · 盘上的负空间（浪/裂纹）挖到盘外会被裁掉，不计入最远半径，
    所以「破顶」只是把盘子开个口，不会撑大包围盒。
  · B 的两半错开量再大就会超：45° 那一点最吃半径（R 与偏移的斜向合成）。

用法：
  python3 test/make_app_icon.py            # 出正式图标（A 版）+ 全部对比图
  python3 test/make_app_icon.py --pick=C   # 改用 C 版做正式图标
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')          # 挑选用的对比图放这儿，已在 .gitignore 里

GOLD = (201, 171, 124)      # --gold #c9ab7c
GOLD_HI = (234, 212, 172)
GOLD_LO = (172, 140, 92)
INK_TOP = (39, 36, 33)      # 暖墨底（上）
INK_BOT = (21, 19, 15)      # 暖墨底（下）
CREAM = (246, 245, 242)
CREAM_2 = (236, 232, 224)
DARKTEXT = (38, 36, 31)

ZH_FONT = '/System/Library/Fonts/StHeiti Medium.ttc'
SS = 4                      # 超采样倍数（画完再缩，边缘才干净）

SAFE = 0.400                # maskable 安全圆半径（相对边长）


# ───────────────────────── 基础绘制 ─────────────────────────
def ground(W, light=False):
    """底：竖向渐变 + 中心一团极淡的暖金晕。dark=暖墨底，light=暖米白底。"""
    top, bot = (CREAM, CREAM_2) if light else (INK_TOP, INK_BOT)
    t = np.linspace(0, 1, W)[:, None]
    g = np.array(top, float)[None, None, :] * (1 - t[..., None]) \
        + np.array(bot, float)[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    yy, xx = np.mgrid[0:W, 0:W]
    d = np.hypot(xx - W / 2, yy - W * 0.48) / (W * 0.62)
    glow = np.clip(1 - d, 0, 1) ** 2 * (0.10 if light else 0.16)
    g = g * (1 - glow[..., None]) + np.array(GOLD, float)[None, None, :] * glow[..., None]
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def gold_grad(W, top=GOLD_HI, bot=GOLD_LO):
    """金色竖向渐变，用来填圆盘，免得死板。"""
    return v_grad(W, top, bot)


def ink_grad(W):
    """暖墨竖向渐变（浅色底版用）。"""
    return v_grad(W, INK_TOP, INK_BOT)


def v_grad(W, top, bot):
    t = np.linspace(0, 1, W)[:, None]
    g = np.array(top, float)[None, None, :] * (1 - t[..., None]) \
        + np.array(bot, float)[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def circle_mask(W, cx, cy, r):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return m


def stroke_mask(W, pts, width):
    """沿折线画**圆头粗线**（PIL 的 line 没有圆头，端点另画圆补上）。"""
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    r = width / 2.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        d.line([(x0, y0), (x1, y1)], fill=255, width=max(1, int(round(width))))
    for (x, y) in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return m


def quad(p0, p1, p2, n=80):
    """二次贝塞尔采样成折线。"""
    out = []
    for t in np.linspace(0, 1, n):
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    return out


def _bin(a):
    return np.asarray(a, dtype=np.int16)


def punched(shape, cut):
    """shape 减去 cut（挖负空间）。"""
    return Image.fromarray(np.clip(_bin(shape) - _bin(cut), 0, 255).astype(np.uint8), 'L')


def union(*masks):
    out = _bin(masks[0])
    for m in masks[1:]:
        out = np.maximum(out, _bin(m))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'L')


def intersect(a, b):
    return Image.fromarray(np.clip(np.minimum(_bin(a), _bin(b)), 0, 255).astype(np.uint8), 'L')


def shift(mask, dx, dy):
    out = Image.new('L', mask.size, 0)
    out.paste(mask, (int(round(dx)), int(round(dy))))
    return out


def far_radius(W, mask):
    """图形层里离画布中心最远的像素 ÷ 边长 —— maskable 安全自检用。"""
    ys, xs = np.nonzero(np.array(mask) > 40)
    if len(xs) == 0:
        return 0.0
    c = W / 2.0
    return float(np.max(np.hypot(xs - c, ys - c))) / W


# ───────────────────────── 三个方向 ─────────────────────────
def mark_A(W, light=False):
    """破石出声：圆盘 + 三道负空间弧浪，最高一道破顶。light=True 出浅色底版。"""
    cx = cy = W * 0.5
    R = W * 0.378
    disc = circle_mask(W, cx, cy, R)

    base = cy + R * 0.62                      # 浪的起点
    lw = R * 0.30                             # 浪的粗细
    tops = [R * 0.10, -R * 0.52, -R * 1.10]   # 三道的顶（相对圆心，负=更高）
    xs = [cx - R * 0.50, cx, cx + R * 0.50]

    cut = Image.new('L', (W, W), 0)
    for x, top in zip(xs, tops):
        y0, y1 = base, cy + top
        p0, p2 = (x, y0), (x + R * 0.26, y1)
        # 控制点向右偏 → 浪尖朝右上扬，和「升」的意思对上
        p1 = ((p0[0] + p2[0]) / 2 + R * 0.20, (y0 + y1) / 2)
        cut = union(cut, stroke_mask(W, quad(p0, p1, p2), lw))

    alpha = punched(disc, cut)
    layer = (ink_grad(W) if light else gold_grad(W))
    layer.putalpha(alpha)
    return layer, alpha


def mark_B(W, light=False):
    """石破：金色圆盘被一道折线裂纹劈开，两半明显错开。"""
    cx = cy = W * 0.5
    R = W * 0.330
    disc = circle_mask(W, cx, cy, R)

    # 折线裂纹：自盘内左下裂到盘外右上。折角要够大，
    # 否则错开后只会看到一条平滑的斜杠。
    pts = [(-0.58, 0.66), (-0.18, 0.34), (-0.40, 0.04), (0.04, -0.30), (-0.18, -0.60), (0.28, -1.02)]
    P = [(cx + a * R, cy + b * R) for a, b in pts]

    low = Image.new('L', (W, W), 0)
    ImageDraw.Draw(low).polygon(P + [(W, P[-1][1]), (W, W), (0, W), (0, P[0][1])], fill=255)

    # ⚠️ 两半必须沿**裂纹的法线**错开。裂纹走向是右上，若朝着右下错开，
    #    位移几乎与裂纹平行 → 缝宽几乎为 0，看着就是一道划痕（上一版就是这么废的）。
    half_low = shift(intersect(disc, low), W * 0.042, W * 0.022)
    half_hi = shift(punched(disc, low), -W * 0.030, -W * 0.016)
    alpha = union(half_low, half_hi)

    layer = gold_grad(W)
    layer.putalpha(alpha)
    return layer, alpha


def mark_C(W, light=False):
    """破石出声 · 浅色底：同一枚标，换成暖米白底 + 暖墨盘 + 米白升浪。

    给一个真正的色调选择 —— 深底稳重，浅底清亮，两者几何完全一致。
    """
    return mark_A(W, light=True)


MARKS = {'A': mark_A, 'B': mark_B, 'C': mark_C}
LIGHT = {'A': False, 'B': False, 'C': True}
TITLES = {
    'A': ('破石出声 · 深', '暖墨底 + 金盘 + 三道弧浪破顶'),
    'B': ('石破', '金盘被折线裂纹劈开，两半明显错开'),
    'C': ('破石出声 · 浅', '同一枚标换浅色底：米白底 + 暖墨盘 + 米白升浪'),
}


def compose(size, tag):
    W = size * SS
    layer, alpha = MARKS[tag](W)
    r = far_radius(W, alpha)
    canvas = ground(W, LIGHT[tag])
    canvas.alpha_composite(layer)
    return canvas.resize((size, size), Image.LANCZOS), r


# ───────────────────────── 出图 ─────────────────────────
def contact_sheet(tags):
    """三版并排 + 真实桌面尺寸的横条，一张图看完。"""
    W, H = 1240, 1010
    cv = Image.new('RGB', (W, H), (233, 230, 224))
    d = ImageDraw.Draw(cv)
    f = ImageFont.truetype(ZH_FONT, 26)
    fs = ImageFont.truetype(ZH_FONT, 16)
    ft = ImageFont.truetype(ZH_FONT, 21)

    d.text((40, 26), '砺蕴工作系统 · 手机桌面图标（纯图形，无文字）', font=f, fill=DARKTEXT)

    for i, tag in enumerate(tags):
        name, desc = TITLES[tag]
        x = 40 + i * 370
        big, r = compose(330, tag)
        cv.paste(big, (x, 84))
        d.text((x, 424), f'{tag} · {name}', font=ft, fill=DARKTEXT)
        d.text((x, 454), desc, font=fs, fill=(110, 104, 96))
        d.text((x, 478), f'图形最远半径 {r:.3f} / 上限 {SAFE:.3f} ' +
               ('✅' if r <= SAFE else '❌'), font=fs,
               fill=(70, 100, 70) if r <= SAFE else (170, 60, 60))

    d.text((40, 560), '缩到桌面真实大小（手机上就这么大，这是唯一的检验标准）', font=ft, fill=DARKTEXT)
    for row, px in enumerate((120, 76, 60, 44, 32)):
        y = 600 + row * (px + 18)
        d.text((38, y + px // 2 - 9), f'{px}px', font=fs, fill=(120, 114, 106))
        for i, tag in enumerate(tags):
            im, _ = compose(px, tag)
            cv.paste(im, (110 + i * 150, y), im)

    os.makedirs(REVIEW, exist_ok=True)
    cv.save(os.path.join(REVIEW, '图标_对比.png'))
    return '预览/图标_对比.png'


def render_review(tag):
    W, H = 1180, 700
    cv = Image.new('RGB', (W, H), (233, 230, 224))
    d = ImageDraw.Draw(cv)
    f = ImageFont.truetype(ZH_FONT, 24)
    fs = ImageFont.truetype(ZH_FONT, 17)

    big, r = compose(400, tag)
    cv.paste(big, (40, 96))

    x = 500
    d.text((x, 40), '桌面真实大小（Retina 上按 ×3 渲染）', font=f, fill=(60, 56, 50))
    for px in (180, 120, 76, 60):
        im, _ = compose(px, tag)
        cv.paste(im, (x, 96), im)
        d.text((x, 96 + px + 10), f'{px}px', font=fs, fill=(120, 114, 106))
        x += px + 34

    d.text((500, 330), 'maskable 安全区 · Android 会按圆形裁切', font=f, fill=(60, 56, 50))
    g, _ = compose(300, tag)
    cv.paste(g, (500, 378), g)
    d.ellipse([500 + 30, 378 + 30, 500 + 270, 378 + 270], outline=(200, 80, 80), width=3)
    d.text((840, 400), '红圈＝裁切后仍可见的范围', font=fs, fill=(150, 70, 70))
    d.text((840, 428), '图形越出红圈会被切掉', font=fs, fill=(150, 70, 70))
    d.text((840, 468), f'实测图形最远半径 {r:.3f}', font=fs, fill=(70, 100, 70))
    d.text((840, 494), f'要求 ≤ {SAFE:.3f}', font=fs, fill=(70, 100, 70))

    name, desc = TITLES[tag]
    d.text((40, 30), f'方向 {tag} · {name}', font=ImageFont.truetype(ZH_FONT, 30), fill=DARKTEXT)
    d.text((40, 60), desc, font=fs, fill=(110, 104, 96))

    os.makedirs(REVIEW, exist_ok=True)
    cv.save(os.path.join(REVIEW, f'图标_{tag}.png'))
    return f'预览/图标_{tag}.png'


def main():
    pick = 'A'
    for a in sys.argv[1:]:
        if a.startswith('--pick='):
            pick = a.split('=', 1)[1].upper()
    if pick not in MARKS:
        print('未知版本', pick)
        sys.exit(2)

    os.makedirs(REVIEW, exist_ok=True)
    tags = ['A', 'B', 'C']

    print('maskable 安全自检（图形层 alpha 的最远半径，上限 %.3f）：' % SAFE)
    radii = {}
    for t in tags:
        _, r = compose(512, t)
        radii[t] = r
        print(f'  {t} {TITLES[t][0]:<6} {r:.3f}  ' + ('✅' if r <= SAFE else '❌ 超出安全圆'))

    for t in tags:
        render_review(t)
    print('\n对比总览：', contact_sheet(tags))

    made = []
    for px, name in [(512, 'icon.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
        im, _ = compose(px, pick)
        im.convert('RGB').save(os.path.join(ROOT, name))
        made.append(name)
    print(f'\n正式图标 = {pick} · {TITLES[pick][0]}')
    print('写出：', '、'.join(made))

    if radii[pick] > SAFE:
        print('❌ 该版本超出 maskable 安全圆，安卓桌面上会被切 —— 请调整几何')
        sys.exit(1)


if __name__ == '__main__':
    main()
