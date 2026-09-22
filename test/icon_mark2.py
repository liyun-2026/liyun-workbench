#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 工作系统 —— 手机桌面图标（沿用线上那枚的设计语言，只换符号）

线上现用（test/make_app_mark.py --pick=B）的设计语言，就三样东西：
  1 深咖底     —— 竖向渐变（52,40,29）→（20,15,11）＋ 中心一团暖晕
  2 金色圆盘   —— 离轴径向渐变（光自左上）＋ 极轻落影，让 mark 在底上浮起来
  3 米白符号   —— 竖向渐变（顶亮底沉）＋ 圆头胶囊

本脚本**一个像素都不改这套材质与配色**，只把符号（原来是三根升浪柱）
换成十二个更「声音」的形 —— 整组和线上同族，一望而知是一家。

用法
----
  python3 test/icon_mark2.py          # 出总览 + 手机桌面实景（不动正式图标）
  换图标后 ⚠️ 必须把 sw.js 的 VERSION 提一档。
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_app_mark as M            # 复用它的材质层（tile / disc_color / bar_color …）

SS, SAFE = M.SS, M.SAFE
REVIEW, ROOT, ZH = M.REVIEW, M.ROOT, M.ZH_FONT

TONE = 'B'                           # 沿用线上那套：深咖底 · 金盘 · 米白符号
PAL = M.PALETTES[TONE]

DR, DCY = 0.300, 0.520               # 盘半径 / 盘心（比线上略大一点，更撑得开）


# ───────────────────────── 基础绘制（全部归一化坐标） ─────────────────────────
def _disc(W):
    return M.circle_mask(W, 0.5 * W, DCY * W, DR * W)


def _pill(W, cx, cy, w, h):
    """圆头胶囊 —— 一律圆头，尖角是「廉」的主要来源。

    ⚠️ 圆角半径必须**略小于**高的一半，否则 PIL 会报 y1 < y0（浮点边界）。
    """
    return M.rrect_mask(W, cx, cy, w, h, min(w, h) / 2.0 * 0.998)


def _stroke(W, pts, w):
    """带圆头的粗折线。⚠️ 不能用 ImageDraw.line(width=)：曲线会逐段留缺口 → 一圈毛刺。"""
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    P = [(x * W, y * W) for x, y in pts]
    r = w * W / 2.0
    for i in range(len(P) - 1):
        (x0, y0), (x1, y1) = P[i], P[i + 1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-9:
            continue
        nx, ny = -dy / L * r, dx / L * r
        d.polygon([(x0 - nx, y0 - ny), (x1 - nx, y1 - ny),
                   (x1 + nx, y1 + ny), (x0 + nx, y0 + ny)], fill=255)
    for (x, y) in P:
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return m


def _arc(W, cx, cy, r, a0, a1, w, steps=150):
    """圆弧。角度制，0° 指向右，顺时针为正（屏幕坐标 y 向下）。"""
    pts = [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / steps)),
            cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / steps)))
           for i in range(steps + 1)]
    return _stroke(W, pts, w)


def _wave(W, x0, x1, ya, yb, amp, cycles, w, phase=0.0, steps=260):
    """声波：沿一条（可倾斜的）中线做正弦起伏，粗圆头。"""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        pts.append((x0 + (x1 - x0) * t,
                    ya + (yb - ya) * t - amp * math.sin(2 * math.pi * cycles * t + phase)))
    return _stroke(W, pts, w)


def _glyph(W, ch, cx, cy, tw):
    """中文字：先大尺寸渲染量 bbox，再等比缩到目标宽度 tw（相对边长）后居中。"""
    S = 800
    f = ImageFont.truetype(ZH, S)
    im = Image.new('L', (S * 2, S * 2), 0)
    ImageDraw.Draw(im).text((S // 2, S // 2), ch, font=f, fill=255)
    bb = im.getbbox()
    if not bb:
        return Image.new('L', (W, W), 0)
    im = im.crop(bb)
    k = (tw * W) / im.width
    nw, nh = max(1, int(round(im.width * k))), max(1, int(round(im.height * k)))
    im = im.resize((nw, nh), Image.LANCZOS)
    out = Image.new('L', (W, W), 0)
    out.paste(im, (int(cx * W - nw / 2), int(cy * W - nh / 2)), im)
    return out


# ───────────────────────── 十二个符号 ─────────────────────────
def v01(W):
    """升浪三柱 —— 线上现款，作基准对照。"""
    xs, hs = [0.366, 0.500, 0.634], [0.145, 0.270, 0.530]
    return M.union(*[_pill(W, x, 0.700 - h / 2, 0.094, h) for x, h in zip(xs, hs)])


def v02(W):
    """五柱声波：柱高按声波包络起伏（矮·高·最高·高·矮）。"""
    hs = [0.135, 0.280, 0.455, 0.300, 0.165]
    bw, gap = 0.066, 0.032
    total = 5 * bw + 4 * gap
    x0 = 0.5 - total / 2 + bw / 2
    return M.union(*[_pill(W, x0 + i * (bw + gap), 0.700 - h / 2, bw, h)
                     for i, h in enumerate(hs)])


def v03(W):
    """声波穿盘：一道粗声波横穿金盘，两端破出盘缘。"""
    return _wave(W, 0.170, 0.830, 0.520, 0.520, 0.118, 1.5, 0.092)


def v04(W):
    """话筒 —— 播音最直白的符号。"""
    return M.union(
        _pill(W, 0.500, 0.368, 0.152, 0.302),                 # 头
        _arc(W, 0.500, 0.518, 0.130, 18, 162, 0.052),         # U 形托
        _pill(W, 0.500, 0.700, 0.052, 0.150),                 # 柱
        _pill(W, 0.500, 0.792, 0.192, 0.040),                 # 座
    )


def v05(W):
    """话筒＋声弧：话筒在左，声朝右散出去。"""
    return M.union(
        _pill(W, 0.436, 0.398, 0.138, 0.272),
        _arc(W, 0.436, 0.530, 0.114, 18, 162, 0.048),
        _pill(W, 0.436, 0.690, 0.048, 0.136),
        _pill(W, 0.436, 0.778, 0.170, 0.036),
        _arc(W, 0.436, 0.418, 0.160, -54, 8, 0.042),
        _arc(W, 0.436, 0.418, 0.220, -54, 8, 0.042),
    )


def v06(W):
    """单字「砺」·填充：米白砺压在金盘上 —— 与刻痕版（11）做直接对照。"""
    return _glyph(W, '砺', 0.500, DCY, 0.400)


def v09(W):
    """单字「声」·刻痕：播音的本命字，笔画比「砺」少，小尺寸更清楚。"""
    return _glyph(W, '声', 0.500, DCY, 0.400)


def v11(W):
    """单字「砺」—— 中文最强的识别资产。"""
    return _glyph(W, '砺', 0.500, DCY, 0.400)


def v12(W):
    """双字「砺蕴」—— 完整品牌名（笔画多，小尺寸会糊）。"""
    return _glyph(W, '砺蕴', 0.500, DCY, 0.448)


VARIANTS = [
    # ── 填充：米白符号压在金盘上（线上现用的画法）──
    ('01 三柱·填充',    '线上现款，作基准对照',      v01, False),
    ('02 五柱·填充',    '柱高按声波包络起伏',        v02, False),
    ('03 声波·填充',    '一道粗波横穿金盘',          v03, False),
    ('04 话筒·填充',    '播音最直白的符号',          v04, False),
    ('05 话筒＋弧',     '话筒在左，声朝右散出',      v05, False),
    ('06 单字砺·填充',  '与 11 的刻痕版做对照',      v06, False),
    # ── 刻痕：符号从金盘里挖出、露出深咖底（对比更强）──
    ('07 三柱·刻痕',    '柱从金盘中挖出',            v01, True),
    ('08 五柱·刻痕',    '五柱挖出，像声波频谱',      v02, True),
    ('09 单字声·刻痕',  '播音的本命字，笔画少更清楚', v09, True),
    ('10 话筒·刻痕',    '话筒从金盘中挖出',          v04, True),
    ('11 单字砺·刻痕',  '中文最强的识别资产',        v11, True),
    ('12 双字砺蕴·刻痕', '完整品牌名（小尺寸会糊）',  v12, True),
]


# ───────────────────────── 合成 ─────────────────────────
def compose(size, fn, cut=False, rounded=False):
    """沿用线上的合成顺序：底 → 落影 → 盘 → 符号。返回 (图, 最远半径)。"""
    W = size * SS
    pal = PAL
    cv = M.tile(W, pal)

    disc = _disc(W)
    sym = fn(W)

    if cut:
        fill_a = M.punched(disc, sym)      # 刻痕：符号从盘里挖掉，露出底色
        allm = disc                        # 轮廓就是那个被刻开的盘
    else:
        fill_a = disc
        allm = M.union(disc, sym)

    sh = allm.filter(ImageFilter.GaussianBlur(W * 0.022))
    sh = sh.point(lambda v: int(v * 0.30))
    sc = Image.new('RGBA', (W, W), pal['shadow'] + (255,))
    sc.putalpha(sh)
    plate = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    plate.paste(sc, (0, int(W * 0.016)))
    cv.alpha_composite(plate)

    dc = M.disc_color(W, pal); dc.putalpha(fill_a)
    cv.alpha_composite(dc)

    if not cut:
        bc = M.bar_color(W, pal)
        lay = bc.copy(); lay.putalpha(sym)
        cv.alpha_composite(lay)

    r = M.far_radius(W, allm)
    if rounded:
        m = Image.new('L', (W, W), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(m)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ───────────────────────── 出图 ─────────────────────────
def sheet(stem, title, sub):
    cols = 4
    rows = int(math.ceil(len(VARIANTS) / cols))
    cw, ch = 420, 512
    pad = 44
    W = pad * 2 + cols * cw
    H = 182 + rows * ch + 34
    cv = Image.new('RGB', (W, H), (231, 227, 220))
    d = ImageDraw.Draw(cv)
    f = ImageFont.truetype(ZH, 34)
    ft = ImageFont.truetype(ZH, 24)
    fs = ImageFont.truetype(ZH, 17)

    d.text((pad, 32), title, font=f, fill=(34, 31, 27))
    d.text((pad, 88), sub, font=fs, fill=(114, 107, 98))

    small = (104, 68, 46)
    tw = sum(small) + 12 * (len(small) - 1)
    for i, (name, note, fn, cut) in enumerate(VARIANTS):
        row, col = divmod(i, cols)
        x, y = pad + col * cw, 182 + row * ch
        big, rad = compose(220, fn, cut, rounded=True)
        cv.paste(big, (x + (cw - 220) // 2, y), big)
        xs = x + (cw - tw) // 2
        for px in small:                       # 真机尺寸，摆在大图**下方**，别压上去
            im, _ = compose(px, fn, cut, rounded=True)
            cv.paste(im, (xs, y + 234 + (small[0] - px) // 2), im)
            xs += px + 12
        d.text((x + 8, y + 356), name, font=ft, fill=(34, 31, 27))
        d.text((x + 8, y + 392), note, font=fs, fill=(104, 98, 90))
        ok = rad <= SAFE
        d.text((x + 8, y + 420), f'最远半径 {rad:.3f} / 上限 {SAFE:.3f} ' + ('OK' if ok else '超标'),
               font=fs, fill=(70, 100, 70) if ok else (168, 58, 58))
        d.text((x + 8, y + 448), '刻痕：符号从金盘中挖出' if cut else '填充：米白符号压在金盘上',
               font=fs, fill=(142, 135, 126))

    d.text((pad, H - 28), '大图为圆角方（App 里的真实形状）；下方三个小图是真机尺寸 104 / 68 / 46px。',
           font=fs, fill=(128, 121, 112))

    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'{stem}.png')
    cv.save(p)
    return p


def home_mock(picks, stem):
    """把选中的几版真放进手机桌面 —— 「放桌面上好不好看」只能这样检验。"""
    Wd, H = 900, 980
    t = np.linspace(0, 1, H)[:, None]
    top, bot = np.array((48, 60, 90), float), np.array((17, 23, 38), float)
    g = top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None]
    g = np.repeat(g, Wd, axis=1)
    yy, xx = np.mgrid[0:H, 0:Wd]
    dd = np.hypot(xx - Wd * 0.22, yy - H * 0.12) / (Wd * 0.75)
    gl = np.clip(1 - dd, 0, 1) ** 2 * 0.32
    g = g * (1 - gl[..., None]) + np.array((96, 120, 165), float)[None, None, :] * gl[..., None]
    cv = Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    dr = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH, 96); f2 = ImageFont.truetype(ZH, 27); f3 = ImageFont.truetype(ZH, 21)
    dr.text((56, 34), '9:41', font=f3, fill=(255, 255, 255))
    dr.text((Wd - 56, 34), '5G  100%', font=f3, fill=(255, 255, 255), anchor='ra')
    dr.text((Wd / 2, 140), '9:41', font=f1, fill=(255, 255, 255), anchor='mm')
    dr.text((Wd / 2, 212), '9月22日 星期二', font=f2, fill=(214, 220, 234), anchor='mm')

    ic, gap = 132, 42
    cols, rows = 4, 2
    gw = cols * ic + (cols - 1) * gap
    x0, y0 = (Wd - gw) // 2, 300
    ours = {idx: (fn, cut) for idx, fn, cut in picks}
    ph = [(152, 160, 176), (182, 152, 138), (140, 168, 158), (162, 152, 184),
          (184, 172, 142), (142, 160, 188), (170, 142, 152), (148, 172, 152)]
    glyphs = ['circle', 'square', 'ring', 'tri', 'dot', 'bars', 'ring', 'dot']
    idx = 0
    for r in range(rows):
        for c in range(cols):
            x, y = x0 + c * (ic + gap), y0 + r * (ic + 62)
            if idx in ours:
                fn, cut = ours[idx]
                im, _ = compose(ic, fn, cut, rounded=True)
                cv.paste(im, (x, y), im)
            else:
                tile_im = Image.new('RGBA', (ic, ic), (0, 0, 0, 0))
                m = Image.new('L', (ic, ic), 0)
                ImageDraw.Draw(m).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
                tile_im = Image.composite(Image.new('RGBA', (ic, ic), ph[idx % len(ph)] + (255,)), tile_im, m)
                dd2 = ImageDraw.Draw(tile_im); m2 = ic / 2; cc = (255, 255, 255, 238)
                gg = glyphs[idx % len(glyphs)]
                if gg == 'circle':
                    dd2.ellipse([m2 - ic * .15, m2 - ic * .15, m2 + ic * .15, m2 + ic * .15], fill=cc)
                elif gg == 'ring':
                    dd2.ellipse([m2 - ic * .18, m2 - ic * .18, m2 + ic * .18, m2 + ic * .18],
                                outline=cc, width=int(ic * .075))
                elif gg == 'square':
                    dd2.rounded_rectangle([m2 - ic * .15, m2 - ic * .15, m2 + ic * .15, m2 + ic * .15],
                                          radius=ic * .05, fill=cc)
                elif gg == 'tri':
                    dd2.polygon([(m2, m2 - ic * .17), (m2 + ic * .17, m2 + ic * .13),
                                 (m2 - ic * .17, m2 + ic * .13)], fill=cc)
                elif gg == 'dot':
                    for k in range(3):
                        dd2.ellipse([m2 - ic * .20 + k * ic * .14, m2 - ic * .045,
                                     m2 - ic * .20 + k * ic * .14 + ic * .075, m2 + ic * .045], fill=cc)
                elif gg == 'bars':
                    for k, hh in enumerate((0.09, 0.19, 0.29)):
                        dd2.rounded_rectangle([m2 - ic * .17 + k * ic * .125, m2 + ic * .15 - hh * ic,
                                               m2 - ic * .17 + k * ic * .125 + ic * .065, m2 + ic * .15],
                                              radius=ic * .03, fill=cc)
                cv.paste(tile_im, (x, y), tile_im)
            idx += 1

    dw, dh = Wd - 140, ic + 34
    dy = y0 + rows * (ic + 62) + 34
    dock = Image.new('RGBA', (dw, dh), (255, 255, 255, 255))
    dm = Image.new('L', (dw, dh), 0)
    ImageDraw.Draw(dm).rounded_rectangle([0, 0, dw - 1, dh - 1], radius=dh * 0.30, fill=255)
    dock.putalpha(Image.composite(Image.new('L', (dw, dh), 30), Image.new('L', (dw, dh), 0), dm))
    cv.alpha_composite(dock, (70, dy))
    dx0 = 70 + (dw - (4 * ic + 3 * gap)) // 2
    dock_m = (0, v09, True)                    # Dock 里放最推荐的那版
    for c in range(4):
        x = dx0 + c * (ic + gap)
        if c == 0:
            im, _ = compose(ic, dock_m[1], dock_m[2], rounded=True)
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
    print('maskable 安全自检（图形层 alpha 最远半径，上限 %.3f）：' % SAFE)
    bad = []
    for name, note, fn, cut in VARIANTS:
        _, r = compose(512, fn, cut)
        ok = r <= SAFE
        if not ok:
            bad.append(name)
        print('  %s %-14s %.3f' % ('OK ' if ok else '❌ ', name, r))

    print('出图：', sheet(
        '砺蕴图标_v17_总览',
        '砺蕴 · 桌面图标 · 沿用线上那枚的设计语言',
        '底、盘、符号材质与配色全不动（深咖底 · 金盘 · 米白符号），只换符号形态；含填充与刻痕两种画法。'))
    print('实景：', home_mock([
        (0, v01, False),      # 线上现款：三柱 · 填充
        (2, v01, True),       # 刻痕三柱
        (4, v09, True),       # 刻痕「声」字
        (6, v11, True),       # 刻痕「砺」字
    ], '砺蕴图标_v17_实景'))

    if bad:
        print('\n⚠️ 超出安全圆：', '、'.join(bad))


if __name__ == '__main__':
    main()
