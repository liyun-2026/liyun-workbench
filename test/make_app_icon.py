#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 工作系统 —— 手机桌面图标生成器（纯图形版 · 定案）

设计依据：名字本身
==================
  砺 = 磨刀石。《说文》「砺，䃺也」。一块粗粝的石头，把刀刃磨出锋芒。
  蕴 = 积聚、蕴藏。《说文》「蕴，积也」。藏在里面、慢慢积起来、不外露。
  合起来是同一件事的两面 —— **外面磨砺，里面蕴养**。

对一家播音主持艺考中心，这就是「练声练气」与「文化底蕴」的关系。
把两字同时讲透的是《礼记·学记》：**玉不琢，不成器**（琢＝砺，玉＝蕴），
而系统本来的品牌故事就写着四个字：**破石出声**。

所以图形只有一个主角：
    一块石，被磨开一面 —— **磨面就是「砺」，露出来的金就是「蕴」。**

定版 = 「磨面」
--------------
不把切面藏在石头里头（那样轮廓还是完整的圆，读出来是饼图 / 月相），
而是让石头**真的被磨掉一面**：轮廓上留一段笔直的磨面，磨面泛金。
石头被磨过，形状上是看得出来的 —— 这就是「砺」。

三条渲染经验（改之前先读）
--------------------------
  ① **环境光遮蔽（AO）不能省。** 平面的金色块靠「贴着切口压暗一点点」
     才读得出是一个**有厚度的切面**，否则只是一张色纸。
  ② **石身要用离轴径向渐变**（光自右上），不是竖向渐变。一块真正的石头
     是有体积的；死平的黑块正是「旧」的来源。
  ③ **墨不能是纯黑**，要暖褐灰（默认 hi 70,62,52 → lo 32,29,25）。
     纯黑压在米白上显旧，暖褐灰才和「极简·暖」这套调子对得上。
     ⚠️ 同时注意：macOS 上 PIL 画曲线必须**每段显式画四边形 + 节点补圆头**，
     用 ImageDraw.line(width=) 会在拐点留缺口，渲染成一圈毛刺。

尺寸规矩（很重要，别乱改）
--------------------------
  · maskable 安全圆半径 = 0.400 × 边长。Android 按圆形裁切，凡「必须看得见」
    的图形都要落在这个圆里。
  · 安全自检用**图形层自己的 alpha** 算最远半径 —— 不能拿合成图算：
    底色不透明，合成图会把整张画布都当墨迹，得出 0.707 的假警报。

用法
----
  python3 test/make_app_icon.py                  # 出对比图（不改正式图标）
  python3 test/make_app_icon.py --pick=m         # 用「磨面」出正式图标（浅底）
  python3 test/make_app_icon.py --pick=m --dark  # 深底版
  换图标后 ⚠️ 必须把 sw.js 的 VERSION 提一档，否则预缓存里还是旧图。
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')          # 挑选用的对比图放这儿，已在 .gitignore 里

GOLD = (201, 171, 124)      # --gold #c9ab7c
GOLD_HI = (236, 214, 174)
GOLD_LO = (170, 137, 89)
DEEP_HI = (250, 232, 196)   # 磨面（浅底）：靠切口那一侧
DEEP_LO = (166, 130, 80)
INK_TOP = (40, 37, 33)
INK_BOT = (22, 20, 16)
CREAM = (247, 246, 243)
CREAM_2 = (237, 233, 226)
DARKTEXT = (38, 36, 31)

ZH_FONT = '/System/Library/Fonts/StHeiti Medium.ttc'
SS = 4                      # 超采样倍数（画完再缩，边缘才干净）
SAFE = 0.400                # maskable 安全圆半径（相对边长）


# ───────────────────────── 色彩 ─────────────────────────
def v_grad(W, top, bot):
    t = np.linspace(0, 1, W)[:, None]
    g = np.array(top, float)[None, None, :] * (1 - t[..., None]) \
        + np.array(bot, float)[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def ground(W, tone='light'):
    """底：竖向渐变 + 中心一团极淡的暖金晕。"""
    top, bot = (CREAM, CREAM_2) if tone == 'light' else (INK_TOP, INK_BOT)
    t = np.linspace(0, 1, W)[:, None]
    g = np.array(top, float)[None, None, :] * (1 - t[..., None]) \
        + np.array(bot, float)[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    yy, xx = np.mgrid[0:W, 0:W]
    d = np.hypot(xx - W / 2, yy - W * 0.48) / (W * 0.62)
    glow = np.clip(1 - d, 0, 1) ** 2 * (0.08 if tone == 'light' else 0.16)
    g = g * (1 - glow[..., None]) + np.array(GOLD, float)[None, None, :] * glow[..., None]
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def gold_grad(W, top=GOLD_HI, bot=GOLD_LO):
    return v_grad(W, top, bot)


def ink_grad(W):
    return v_grad(W, INK_TOP, INK_BOT)


def shade_ink(W, tone='light'):
    """**石身材质**：离轴径向渐变（光自右上）。

    一块真正的石头是有体积的 —— 死平的黑块正是「旧」的来源。
    暖墨（不是纯黑）压在米白上才和「极简·暖」的调子对得上。
    """
    yy, xx = np.mgrid[0:W, 0:W].astype(float)
    d = np.hypot((xx - W * 0.660) / (W * 0.98), (yy - W * 0.320) / (W * 0.82))
    t = np.clip(d, 0, 1) ** 1.5
    hi, lo = ((70, 62, 52), (32, 29, 25)) if tone == 'light' else ((32, 29, 24), (11, 10, 8))
    hi, lo = np.array(hi, float), np.array(lo, float)
    g = hi[None, None, :] * (1 - t[..., None]) + lo[None, None, :] * t[..., None]
    return Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def shade_face(W, ang, d, tone='light'):
    """**磨面材质**：自切口向外由亮转深（光是从磨开的那道缝里透出来的），
    再叠一层**贴着切口的 AO**。

    ⚠️ AO 不能省 —— 平面的金色块靠「贴着切口压暗一点点」才读得出是一个
    有厚度的切面，否则只是一张色纸。
    """
    f = field(W, ang, d, 0.010)
    t = np.clip(f / 0.30, 0, 1) ** 1.05
    hi, lo = np.array(DEEP_HI, float), np.array(DEEP_LO, float)
    g = hi[None, None, :] * (1 - t[..., None]) + lo[None, None, :] * t[..., None]
    ao = 1.0 - 0.30 * np.exp(-np.clip(f, 0, None) / 0.045)
    g = g * ao[..., None]
    return Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')


# ───────────────────────── 基础绘制 ─────────────────────────
def circle_mask(W, cx, cy, r):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return m


def stroke_mask(W, pts, width, caps=True):
    """沿折线画**圆头粗线**。

    ⚠️ 别用 `ImageDraw.line(width=w)` —— 曲线采样成上百段小折线之后，
    PIL 把每一段各画成一个独立四边形，拐点处留下细缺口，渲染出来
    是一圈毛刺。正确做法：**每段显式画四边形，再在每个节点补一个半径
    = w/2 的圆** —— 圆接头，天然无缺口。
    """
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    r = width / 2.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        L = (dx * dx + dy * dy) ** 0.5
        if L < 1e-6:
            continue
        nx, ny = -dy / L * r, dx / L * r
        d.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny),
                   (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill=255)
    idx = range(len(pts)) if caps else (0, len(pts) - 1)
    for i in idx:
        x, y = pts[i]
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return m


def polygon_mask(W, pts):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).polygon([(float(x), float(y)) for x, y in pts], fill=255)
    return m


def arc_mask(W, cx, cy, r, a0, a1, width, round_caps=True):
    """粗圆弧。角度制：0°＝右，顺时针为正（屏幕 y 向下）。圆头另补两个圆。"""
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    d.arc([cx - r, cy - r, cx + r, cy + r], a0, a1, fill=255,
          width=max(1, int(round(width))))
    if round_caps:
        rr = width / 2.0
        for a in (a0, a1):
            t = np.radians(a)
            x, y = cx + np.cos(t) * r, cy + np.sin(t) * r
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=255)
    return m


def rrect_mask(W, cx, cy, w, h, rad, ang=0.0):
    """圆角矩形，可整体旋转（度，逆时针为正）。"""
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
    if ang:
        m = m.rotate(ang, resample=Image.BICUBIC, center=(C, C))
    return m.crop((int(C - W / 2), int(C - W / 2), int(C + W / 2), int(C + W / 2)))


def quad(p0, p1, p2, n=120):
    """二次贝塞尔采样成折线。"""
    out = []
    for t in np.linspace(0, 1, n):
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    return out


def cubic(p0, p1, p2, p3, n=110):
    """三次贝塞尔采样成折线。"""
    out = []
    for t in np.linspace(0, 1, n):
        u = 1 - t
        out.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
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


def band_poly(cl, wfun):
    """把一条中心线加一个「宽度随参数变化」的函数，铺成闭合多边形。"""
    out, inn = [], []
    n = len(cl) - 1
    for i, (x, y) in enumerate(cl):
        t = i / n
        w = max(0.0, wfun(t)) / 2.0
        j, k = min(i + 1, n), max(i - 1, 0)
        dx, dy = cl[j][0] - cl[k][0], cl[j][1] - cl[k][1]
        L = (dx * dx + dy * dy) ** 0.5 or 1.0
        nx, ny = -dy / L, dx / L
        out.append((x + nx * w, y + ny * w))
        inn.append((x - nx * w, y - ny * w))
    return out + inn[::-1]


def sstroke(W, ctrl, wmax, mode='head', p=1.5, n=150):
    """一笔行书：沿三次贝塞尔走一条变宽带。ctrl 是四个归一化控制点。

    mode='head' 头厚尾细（像一笔，也像浪头）；'tail' 反向；'leaf' 两头尖
    （⚠️ 两头尖的形状人眼一律读成叶子 / 刀片，别用）。
    """
    cl = cubic((ctrl[0][0] * W, ctrl[0][1] * W), (ctrl[1][0] * W, ctrl[1][1] * W),
               (ctrl[2][0] * W, ctrl[2][1] * W), (ctrl[3][0] * W, ctrl[3][1] * W), n)
    wf = (lambda t: (1 - t) ** p) if mode == 'head' else (lambda t: t ** p)
    m = polygon_mask(W, band_poly(cl, lambda t: wmax * W * wf(t)))
    r = wmax * W / 2
    x, y = (cl[0] if mode == 'head' else cl[-1])
    cap = Image.new('L', (W, W), 0)
    ImageDraw.Draw(cap).ellipse([x - r, y - r, x + r, y + r], fill=255)
    return union(m, cap)


# ───────────────────── 石头：卵石 与 磨面 ─────────────────────
def pebble(W, r=0.354, cx=0.5, cy=0.5, a=0.082, b=0.044, phi=-0.70, psi=1.75, n=480):
    """**有机卵石**：半径随角度做两级微弱起伏的圆。

    为什么不直接用正圆：正圆是最没性格的形，和满屏的 App 图标撞脸，
    而且「圆＋一条直线」读出来就是饼图 / 月相（前几轮全栽在这儿）。
    卵石是天然被水磨过的石头 —— 它本身就是「砺」的产物。
    a/b 控制在 8% / 4% 以内，起伏太大会变成土豆。
    """
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    R = r * W * (1 + a * np.cos(2 * th + phi) + b * np.cos(3 * th + psi))
    X, Y = cx * W, cy * W
    return polygon_mask(W, [(X + np.cos(t) * rr, Y + np.sin(t) * rr)
                            for t, rr in zip(th, R)])


def field(W, ang_deg, d, curve=0.0, width=0.90):
    """**切面场**（归一化）：正值＝在切口外侧。

    ang_deg 用屏幕坐标：-90 = 正上；-50 ≈ 右上。
    curve>0 → 边界朝石心凹进去（磨出来的弧势）；curve=0 → 一刀直口。
    返回带符号的距离场，做 AO 和磨面渐变都要用它。
    """
    a = np.radians(ang_deg)
    nx, ny = np.cos(a), np.sin(a)
    yy, xx = np.mgrid[0:W, 0:W].astype(float)
    u = ((xx - W / 2) * nx + (yy - W / 2) * ny) / W
    if curve:
        tx, ty = -ny, nx
        v = ((xx - W / 2) * tx + (yy - W / 2) * ty) / W
        u = u + curve * (1 - np.clip((v / width) ** 2, 0, 1))
    return u - d


def mask_of(f, W):
    return Image.fromarray((f > 0).astype(np.uint8) * 255, 'L')


def mark_grind(W, d_in=0.062, d_out=0.172, ang=-50, curve=0.012):
    """**磨面（定版）**：石被磨掉一面，轮廓上留一段笔直的磨面，磨面泛金。

    石头被磨过，形状上是看得出来的 —— 这就是「砺」。
    磨面太窄读成「一道高光」，太宽又不像石头；0.062→0.172 是试出来的档。
    """
    st = pebble(W, 0.354)
    outer = mask_of(field(W, ang, d_out, curve), W)
    inner = mask_of(field(W, ang, d_in, curve), W)
    return [(punched(st, inner), 'ink'), (punched(intersect(st, inner), outer), 'gold')]


def mark_slice(W, d=0.098, ang=-50, curve=0.012):
    """**剖面**（备选）：金面藏在石内，轮廓还是完整的卵石 —— 更含蓄、更像标志。"""
    st = pebble(W, 0.352)
    f = mask_of(field(W, ang, d, curve), W)
    return [(punched(st, f), 'ink'), (intersect(st, f), 'gold')]


def mark_grind_narrow(W):
    """磨面 · 窄：磨面最窄，最含蓄。"""
    return mark_grind(W, 0.094, 0.150)


def mark_grind_wide(W):
    """磨面 · 宽：磨面更宽，金多一分。"""
    return mark_grind(W, 0.006, 0.190)


VARIANTS = {
    'm': ('磨面 ⭐', '石被磨掉一面，轮廓上留一段笔直的磨面', mark_grind, (-50, 0.062)),
    's': ('剖面', '金面藏在石内，轮廓完整 —— 更含蓄', mark_slice, (-50, 0.098)),
    'n': ('磨面 · 窄', '磨面最窄，最含蓄', mark_grind_narrow, (-50, 0.094)),
    'w': ('磨面 · 宽', '磨面更宽，金多一分', mark_grind_wide, (-50, 0.006)),
}
TAGS = list(VARIANTS)


# ───────────────────── 合成 ─────────────────────
def render_layers(W, tag, tone):
    """把某候选渲染成 (RGBA 图形层, 最远半径, 合并 alpha)。

    色调只决定「哪种色号用在石上、哪种用在磨面上」：
    浅底 = 暖墨石 + 古铜金磨面；深底整套互换 —— 几何与色调彻底解耦。
    """
    ang, d = VARIANTS[tag][3]
    layers = VARIANTS[tag][2](W)
    allm = None
    base = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    for alpha, kind in layers:
        allm = alpha if allm is None else union(allm, alpha)
        stone = shade_ink(W, tone)
        face = shade_face(W, ang, d, tone)
        col = (stone if kind == 'ink' else face) if tone == 'light' else \
              (face if kind == 'ink' else stone)
        col.putalpha(alpha)
        base = Image.alpha_composite(base, col)
    return base, far_radius(W, allm), allm


def compose(size, tag, tone='light', rounded=False):
    W = size * SS
    layer, r, allm = render_layers(W, tag, tone)
    cv = ground(W, tone).convert('RGBA')

    # 极轻的落影：让石头在底上「浮起来」一丁点。不是装饰 ——
    # 一片纯平的大色块正是「旧」的主要来源之一。
    sh = allm.filter(ImageFilter.GaussianBlur(W * 0.020))
    sh = sh.point(lambda v: int(v * (0.16 if tone == 'light' else 0.34)))
    sc = Image.new('RGBA', (W, W), (28, 24, 18, 255))
    sc.putalpha(sh)
    plate = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    plate.paste(sc, (0, int(W * 0.013)))
    cv.alpha_composite(plate)
    cv.alpha_composite(layer)

    if rounded:      # 套 iOS 那种圆角方：半径 ≈ 22.4%
        m = Image.new('L', (W, W), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(m)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ───────────────────────── 出图 ─────────────────────────
def contact_sheet(tags, tone, stem, title, sub):
    cols = 4
    rows = (len(tags) + cols - 1) // cols
    cw, ch = 380, 536
    W, H = 40 * 2 + cols * cw, 170 + rows * ch + 330
    cv = Image.new('RGB', (W, H), (233, 230, 224))
    d = ImageDraw.Draw(cv)
    f = ImageFont.truetype(ZH_FONT, 29)
    ft = ImageFont.truetype(ZH_FONT, 23)
    fs = ImageFont.truetype(ZH_FONT, 17)

    d.text((40, 26), title, font=f, fill=DARKTEXT)
    d.text((40, 72), sub, font=fs, fill=(112, 106, 98))

    for i, tag in enumerate(tags):
        x, y = 40 + (i % cols) * cw, 126 + (i // cols) * ch
        big, r = compose(272, tag, tone)
        cv.paste(big, (x + 54, y))
        xx = x
        for px in (120, 76, 60, 44):      # 套上圆角方遮罩，按真机图标大小看
            im, _ = compose(px, tag, tone, rounded=True)
            cv.paste(im, (xx, y + 292 + (120 - px) // 2), im)
            xx += px + 14
        name, desc = VARIANTS[tag][0], VARIANTS[tag][1]
        d.text((x, y + 428), f'{tag} · {name}', font=ft, fill=DARKTEXT)
        d.text((x, y + 460), desc, font=fs, fill=(112, 106, 98))
        d.text((x, y + 488), f'最远半径 {r:.3f} / 上限 {SAFE:.3f} ' +
               ('✅' if r <= SAFE else '❌'), font=fs,
               fill=(70, 100, 70) if r <= SAFE else (170, 60, 60))

    y0 = 126 + rows * ch + 18
    d.text((40, y0), '桌面真实大小（手机上就这么大 —— 唯一算数的检验标准）',
           font=ft, fill=DARKTEXT)
    for row, px in enumerate((120, 76, 60, 44, 32)):
        y = y0 + 46 + row * (px + 16)
        d.text((38, y + px // 2 - 9), f'{px}px', font=fs, fill=(120, 114, 106))
        for i, tag in enumerate(tags):
            im, _ = compose(px, tag, tone)
            cv.paste(im, (118 + i * (max(px, 44) + 40), y))

    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'{stem}_{tone}.png')
    cv.save(p)
    return f'预览/{stem}_{tone}.png'


def main():
    pick, dark, sheet = None, False, True
    for a in sys.argv[1:]:
        if a.startswith('--pick='):
            pick = a.split('=', 1)[1]
        elif a in ('--dark', '--tone=dark'):
            dark = True
        elif a == '--no-sheet':
            sheet = False

    print('maskable 安全自检（图形层 alpha 的最远半径，上限 %.3f）：' % SAFE)
    bad = []
    for t in TAGS:
        _, r = compose(512, t)
        ok = r <= SAFE
        if not ok:
            bad.append(t)
        print(f'  {t} {VARIANTS[t][0]:<8} {r:.3f}  ' + ('✅' if ok else '❌ 超出安全圆'))

    if sheet:
        for tone in ('light', 'dark'):
            print(contact_sheet(
                TAGS, tone, '图标_定版',
                f'砺蕴 · 桌面图标 · 定版（纯图形 · {tone}）',
                '砺＝磨石，蕴＝藏。一块石被磨开一面 —— 磨面就是「砺」，露出的金就是「蕴」。'))

    if pick:
        if pick not in VARIANTS:
            print('未知版本', pick)
            sys.exit(2)
        tone = 'dark' if dark else 'light'
        _, r, _ = render_layers(512 * SS, pick, tone)
        if r > SAFE:
            print('❌ 该版本超出 maskable 安全圆，安卓桌面上会被切 —— 请调整几何')
            sys.exit(1)
        made = []
        for px, name in [(512, 'icon.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
            im, _ = compose(px, pick, tone)
            im.convert('RGB').save(os.path.join(ROOT, name))
            made.append(name)
        print(f'\n正式图标 = {pick} · {VARIANTS[pick][0]}（{tone}）')
        print('写出：', '、'.join(made))

    if bad:
        print('\n⚠️ 以下候选超出安全圆，安卓圆形裁切会切到：', '、'.join(bad))


if __name__ == '__main__':
    main()
