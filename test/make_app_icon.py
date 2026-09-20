#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
砺蕴工作系统 —— 手机桌面图标生成器

把「砺」的行书字标（assets/li.png，黑字透明底）取 alpha 当墨迹，
染成古铜金，压在暖墨底上，输出一套桌面图标。

为什么要重做：旧图标是「金色圆盘 + 三根黑柱子」，缩到桌面大小读起来
像一张柱状图/信号格，跟播音艺考没有关系。

尺寸规矩（很重要，别乱改）：
  · 字形高度取画布 47% —— 这是 maskable 安全区倒推出来的上限。
    Android 会按圆形裁切，安全圆直径是 80%；「砺」的包围盒宽高比 1.35，
    高 47% 时四角到圆心正好 ≈ 0.394S ≤ 0.40S，刚好落进安全圆。
    再放大就会在 Android 上被切掉笔画。
  · iOS 用圆角方形裁切，同样吃这个余量。

用法：
  python3 test/make_app_icon.py            # 出正式图标（写进工程目录）
  python3 test/make_app_icon.py --review   # 额外出三版对比图供挑选
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, 'assets')
REVIEW = os.path.join(ROOT, '预览')      # 挑选用的对比图放这儿，已在 .gitignore 里

GOLD = (201, 171, 124)          # --gold #c9ab7c
GOLD_HI = (226, 202, 159)       # 高光
INK_TOP = (38, 35, 32)          # 暖墨底（上）
INK_BOT = (22, 20, 15)          # 暖墨底（下）
CREAM = (246, 245, 242)         # --bg 暖米白
CREAM_2 = (238, 235, 228)
DARKTEXT = (38, 36, 31)         # --text

ZH_FONT = '/System/Library/Fonts/STHeiti Medium.ttc'


# ───────────────────────── 字形 ─────────────────────────
def load_glyph():
    """读 assets/li.png，返回 alpha（墨迹）裁紧后的 L 图，作为遮罩使用。"""
    src = Image.open(os.path.join(ASSETS, 'li.png')).convert('RGBA')
    a = np.array(src)[..., 3]
    ys, xs = np.nonzero(a > 128)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    m = src.crop(box).split()[3]
    return m


def tint(mask, size, color, color_hi=None):
    """把墨迹遮罩缩放到 size（取高），染成 color；带一点上浅下深，免得死板。"""
    w, h = mask.size
    tw = max(1, round(size * w / h))
    m = mask.resize((tw, size), Image.LANCZOS)
    # 竖向渐变：顶部亮 12%，底部回到本色
    grad = np.linspace(0, 1, size)[:, None]
    c0 = np.array(color_hi or color, dtype=float)
    c1 = np.array(color, dtype=float)
    band = (c0[None, None, :] * (1 - grad[..., None]) + c1[None, None, :] * grad[..., None])
    rgb = np.repeat(band, tw, axis=1).astype(np.uint8)
    out = np.dstack([rgb, np.array(m)])
    return Image.fromarray(out, 'RGBA')


# ───────────────────────── 底 ─────────────────────────
def ground(size, dark=True):
    """暖底：竖向渐变 + 中心一团极淡的暖金晕（和登录页的「暖金晕」一个意思）。"""
    g = np.zeros((size, size, 3), dtype=float)
    top, bot = (np.array(INK_TOP, float), np.array(INK_BOT, float)) if dark \
        else (np.array(CREAM, float), np.array(CREAM_2, float))
    t = np.linspace(0, 1, size)[:, None]
    g[:] = (top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None])
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.hypot(xx - size / 2, yy - size * 0.48) / (size * 0.62)
    glow = np.clip(1 - d, 0, 1) ** 2 * (0.16 if dark else 0.10)
    g = g * (1 - glow[..., None]) + np.array(GOLD, float)[None, None, :] * glow[..., None]
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def glyph_box(size, glyph, inset=0.455):
    """字形在画布里的外接框（位置算法必须和 compose 完全一致）。"""
    gh = round(size * inset)
    gw = round(gh * glyph.width / glyph.height)
    x = (size - gw) // 2
    y = round(size * 0.5 - gh * 0.5 - size * 0.010)
    return x, y, gw, gh


def safe_radius(size, box):
    """外接框四角离画布中心最远的距离 ÷ 边长。maskable 要求 ≤ 0.40。

    ⚠️ 不能用「合成图的 alpha」来算 —— 底色是不透明的，
       整张画布都会被当成墨迹，算出 0.707 的假警报。
    """
    x, y, w, h = box
    c = size / 2
    return max(np.hypot(px - c, py - c) for px in (x, x + w) for py in (y, y + h)) / size


def compose(size, glyph, dark=True, rule=False, inset=0.455):
    """inset = 字形高度占画布比例（0.455 是 maskable 安全上限，别再放大）。

    居中按「墨迹外接框」算，再整体上抬 1%：
    行书「砺」的撇很长，外接框落在下方，不抬一点视觉上会偏沉。
    """
    cv = ground(size, dark)
    gl = tint(glyph, round(size * inset), GOLD if dark else DARKTEXT,
              GOLD_HI if dark else (70, 66, 58))
    x, y, _, _ = glyph_box(size, glyph, inset)
    cv.alpha_composite(gl, (x, y))
    if rule:
        # 门头同款的「金线正中嵌金菱」
        d = ImageDraw.Draw(cv)
        lw = max(2, round(size * 0.011))
        cy = y + gl.height + round(size * 0.078)
        half = round(size * 0.165)
        cxm = size // 2
        col = GOLD if dark else DARKTEXT
        d.line([(cxm - half, cy), (cxm - round(size * 0.030), cy)], fill=col, width=lw)
        d.line([(cxm + round(size * 0.030), cy), (cxm + half, cy)], fill=col, width=lw)
        r = round(size * 0.025)
        d.polygon([(cxm, cy - r), (cxm + r, cy), (cxm, cy + r), (cxm - r, cy)], fill=col)
    return cv


# ───────────────────────── 输出 ─────────────────────────
def main():
    review = '--review' in sys.argv
    glyph = load_glyph()

    variants = [('A', dict(dark=True, rule=False)),      # 主版：暖墨底 + 金色「砺」
                ('B', dict(dark=True, rule=True)),       # 加门头同款金线金菱
                ('C', dict(dark=False, rule=False))]     # 暖米白底 + 墨色「砺」

    made = []
    for tag, kw in variants:
        big = compose(512, glyph, **kw)
        if tag == 'A':
            # 正式图标只用 A
            for px, name in [(512, 'icon.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
                (big if px == 512 else compose(px, glyph, **kw)).save(os.path.join(ROOT, name))
                made.append(name)
        if review:
            made.append(render_review(tag, glyph, kw))

    r = safe_radius(512, glyph_box(512, glyph))
    print('字形包围盒比例：', round(glyph.width / glyph.height, 3))
    print(f'maskable 安全自检：字形外接框最远角 {r:.3f}（安全圆半径 0.400）→ '
          + ('✅ 落在安全圆内，安卓圆形裁切不会切到笔画' if r <= 0.40
             else '❌ 超出安全圆，必须减小 inset'))
    print('写出：', '、'.join(made))
    if review:
        print('\n挑选看这三张（在 预览/ 目录）：')
        print('  预览/图标_A.png  暖墨底 + 金色「砺」      ← 已作为正式图标写进工程')
        print('  预览/图标_B.png  叠上门头同款金线嵌金菱')
        print('  预览/图标_C.png  暖米白底 + 墨色「砺」')

    if r > 0.40:
        print('\n❌ 图标超出 maskable 安全圆，安卓桌面上会被切掉笔画 —— 请减小 inset')
        sys.exit(1)


def render_review(tag, glyph, kw):
    """一版一张图：左边 512 大图 + 右边真实尺寸小图 + maskable 安全区示意。"""
    W, H = 1180, 760
    cv = Image.new('RGB', (W, H), (233, 230, 224))
    d = ImageDraw.Draw(cv)
    f = ImageFont.truetype(ZH_FONT, 22)
    fs = ImageFont.truetype(ZH_FONT, 17)

    cv.paste(compose(420, glyph, **kw), (40, 96))

    # 右上：真实尺寸，模拟桌面上并排的样子
    x = 530
    d.text((x, 44), '缩到桌面真实大小（Retina 上按 ×3 渲染）', font=f, fill=(60, 56, 50))
    for px in (180, 120, 76, 60):
        im = compose(px, glyph, **kw).convert('RGBA')
        cv.paste(im, (x, 96), im)
        d.text((x, 96 + px + 10), f'{px}px', font=fs, fill=(120, 114, 106))
        x += px + 40

    # 右下：maskable 安全圆（整颗圆都要在画布内）
    d.text((530, 400), 'maskable 安全区 · Android 会按圆形裁切', font=f, fill=(60, 56, 50))
    g = compose(300, glyph, **kw).convert('RGBA')
    cv.paste(g, (530, 448), g)
    d.ellipse([530 + 30, 448 + 30, 530 + 270, 448 + 270], outline=(200, 80, 80), width=3)
    d.text((880, 470), '红圈＝裁切后仍然可见的范围', font=fs, fill=(150, 70, 70))
    d.text((880, 500), '笔画越出红圈，安卓桌面上会被切掉', font=fs, fill=(150, 70, 70))
    d.text((880, 540), f'实测字形最远角 {safe_radius(300, glyph_box(300, glyph)):.3f}', font=fs,
           fill=(70, 100, 70))
    d.text((880, 566), '要求 ≤ 0.400（安全圆半径）', font=fs, fill=(70, 100, 70))

    d.text((40, 30), f'方案 {tag}', font=ImageFont.truetype(ZH_FONT, 30), fill=DARKTEXT)
    os.makedirs(REVIEW, exist_ok=True)
    name = os.path.join(REVIEW, f'图标_{tag}.png')
    cv.save(name)
    return os.path.join('预览', f'图标_{tag}.png')


if __name__ == '__main__':
    main()
