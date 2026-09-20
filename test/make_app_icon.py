#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
砺蕴工作系统 —— 手机桌面图标生成器（纯图形版）

用户的两条硬要求：① 不要文字，要图形；② 要有质感、不老气。
「砺」字标、金盘三柱、以及一系列几何尝试都被否掉了，最后收敛到下面这条路线。

定版路线：**暖墨盘 + 一道金色行书笔触**
--------------------------------------
盘＝「砺」的本义（磨石），笔触＝「破石出声」的那一声。
用户唯一点头过的是「米白底 + 墨盘」这个组合，所以浅底是默认色调；
深底（暖墨底 + 金盘）整套自动互换，是备选。

⚠️ 这一轮最关键的一条经验：**笔触必须「头厚尾细」**
  · 两头尖、中段最厚的对称形状（月牙 / 叶形）—— 人眼一律读成「叶子」「刀片」「豆子」，
    连试五版都是这个结果。
  · 改成**起笔按下去、收笔提起来**（mode='head'）之后，立刻变成一笔行书，也像浪头。
  · 同理，等宽直棒会被读成柱状图 / 信号格（最老那版金盘三柱就是这么过时的）。

尺寸规矩（很重要，别乱改）
--------------------------
  · maskable 安全圆半径 = 0.40 × 边长。Android 按圆形裁切，凡「必须看得见」的图形
    都要落在这个圆里。⚠️ 盘做到 0.368 之后只剩 0.03 余量 —— 所以**任何「盘外长出来的
    东西」都必然超标**，笔触一律 intersect(disc) 裁在盘内。
  · 安全自检用**图形层自己的 alpha** 算最远半径 —— 不能拿合成图算：
    底色不透明，合成图会把整张画布都当墨迹，得出 0.707 的假警报。

坐标约定
--------
所有几何一律用 0~1 归一化坐标描述，画的时候再乘宽度 —— 换尺寸不用重算。

候选一览（--list 可打印）
------------------------
  甲组 1–6：其他方向（浪分双色 / 盘·开口 / 破·飞片 / 对称月牙(反面参照) /
             石与升浪(轻) / 一笔·墨锋）
  乙组 g–l：笔触选形（同一枚盘，只换弧势与哪一头厚）—— **主推**
     g 头厚尾细·立      ⭐ 当前定版
     h 头厚尾细·长锋    i 头厚尾细·上卷    j 头厚尾细·横
     k 细头粗尾(对照)   l 两头尖(对照)

用法
----
  python3 test/make_app_icon.py                    # 出四张对比图（不改正式图标）
  python3 test/make_app_icon.py --pick=g           # 用 g 出正式图标（浅底）
  python3 test/make_app_icon.py --pick=i --dark    # 用 i 的深底版
  出正式图标会同时写 icon.png(512) / icon-192.png / apple-touch-icon.png(180)，
  ⚠️ 换图标后记得把 sw.js 的 VERSION 提一档，否则预缓存里还是旧图。
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
DEEP_HI = (206, 172, 116)   # 浅底上用的金：比 --gold 深一档，压在米白上才不发飘
DEEP_LO = (163, 128, 78)
INK_TOP = (40, 37, 33)      # 暖墨（上）
INK_BOT = (22, 20, 16)      # 暖墨（下）
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


# ───────────────────────── 基础绘制 ─────────────────────────
def circle_mask(W, cx, cy, r):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return m


def stroke_mask(W, pts, width, caps=True):
    """沿折线画**圆头粗线**。

    ⚠️ 别用 `ImageDraw.line(width=w)` —— 曲线采样成上百段小折线之后，
    PIL 把每一段各画成一个独立四边形，拐点处留下细缺口，渲染出来
    是一圈毛刺（第一版就是这么废的）。正确做法：**每段显式画四边形，
    再在每个节点补一个半径 = w/2 的圆** —— 圆接头，天然无缺口。
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


def blade(W, t0, t1, c_out, c_in, n=110):
    """一片**锥形浪叶**：两端收成尖，中段最厚。

    做法＝两条二次贝塞尔围成的闭区域 —— 外弧从 t0 走到 t1，内弧从 t1 走回 t0，
    两条的控制点错开多少，中段就有多厚。这是画「浪 / 帆 / 声」这类
    上冲形状最稳的基本形：一根等宽的棒子没有方向感，锥形的才有。
    参数一律用 0~1 归一化坐标。
    """
    S = lambda p: (p[0] * W, p[1] * W)
    pts = quad(S(t0), S(c_out), S(t1), n) + quad(S(t1), S(c_in), S(t0), n)
    return polygon_mask(W, pts)


def blade_w(W, t0, t1, c_out, c_in):
    """同上，返回中段最厚处的大致厚度（归一化），用来守「≥0.11」这条线。"""
    mx = abs(c_out[0] - c_in[0]) * 0.5
    my = abs(c_out[1] - c_in[1]) * 0.5
    return (mx * mx + my * my) ** 0.5


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
    """圆角矩形，可整体旋转（度，逆时针为正）。画在 3 倍画布上再转，免得转出来缺角。"""
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


def warp(mask, W, ang=0.0, dx=0.0, dy=0.0):
    """把 mask 绕画布中心转 ang 度、再平移 (dx,dy)×边长。"""
    S = W * 3
    big = Image.new('L', (S, S), 0)
    big.paste(mask, (W, W))
    if ang:
        big = big.rotate(ang, resample=Image.BICUBIC, center=(S / 2, S / 2))
    if dx or dy:
        big = big.transform((S, S), Image.AFFINE,
                            (1, 0, -dx * W, 0, 1, -dy * W), resample=Image.BICUBIC)
    return big.crop((W, W, 2 * W, 2 * W))


def leaf(W, bx, base_y, height, curl=0.105, lean=0.190, thick=0.118, bulge=0.56):
    """一片自 (bx, base_y) 起、向上扬起并微微右倾的**锥形浪叶**。

    thick 是中段最厚处（归一化）—— 图标里**别低于 0.11**，
    再细在 60px 桌面上就断成一缕烟了。
    """
    t0 = (bx, base_y)
    t1 = (bx + curl, base_y - height)
    my = base_y - height * bulge
    c_out = (bx - lean, my)
    c_in = (bx - lean + thick * 2.0, my + 0.012)
    return blade(W, t0, t1, c_out, c_in)


def cubic(p0, p1, p2, p3, n=110):
    """三次贝塞尔采样成折线。"""
    out = []
    for t in np.linspace(0, 1, n):
        u = 1 - t
        out.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
    return out


def side_poly(pts, direction):
    """把一条曲线变成「曲线某一侧的全部区域」的闭合多边形（方向 'L' / 'R'）。"""
    far = -3.0 * 1e4 if direction == 'L' else 3.0 * 1e4
    return list(pts) + [(far, pts[-1][1]), (far, pts[0][1])]


def split_by(mask, W, cl, gap):
    """用一条曲线 cl（像素点列）把 mask 切成两片，中间留 gap 宽的空隙。

    做法是把曲线**各向左右平移 gap/2**，两侧各取一次 —— 这样两片之间
    天然留出一道等宽的缝，且都是干净的原轮廓，不需要做腐蚀。
    返回 (左片, 右片)。
    """
    return split_var(mask, W, cl, gap, gap)


def split_var(mask, W, cl, gap0, gap1):
    """同上，但缝宽沿曲线从 gap0（起点）渐变到 gap1（终点）。

    锥形缝是要点：等宽缝看着像「切了一刀」，下细上宽的缝才像「顶开的」。
    """
    n = max(1, len(cl) - 1)
    a, b = [], []
    for i, (x, y) in enumerate(cl):
        g = (gap0 + (gap1 - gap0) * i / n) * W / 2
        a.append((x - g, y))
        b.append((x + g, y))
    L = intersect(mask, polygon_mask(W, side_poly(a, 'L')))
    R = intersect(mask, polygon_mask(W, side_poly(b, 'R')))
    return L, R


def band_poly(cl, wfun):
    """把一条中心线加一个「宽度随参数变化」的函数，铺成闭合多边形。

    这是画**行书笔触**的正解：等宽棒子没有起收笔，对称月牙又会被读成豆子 / 叶子；
    只有「两端收尖、中段饱满、弧势连贯」的一条带，才像一笔写出来的东西。
    """
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


def sstroke(W, ctrl, wmax, mode='head', p=1.5, asym=1.25, sharp=0.75, n=150):
    """一笔行书：沿三次贝塞尔走一条变宽带。ctrl 是四个归一化控制点。

    mode 决定「哪一头厚」，这一条决定读出来像什么：
      'head' 头厚尾细 —— 起笔按下去、收笔提出去。**像一笔，也像浪头**（推荐）
      'tail' 头细尾厚 —— 反向
      'leaf' 两头收、中段最厚 —— 会被读成叶子 / 刀片（6 号之前的失败原因）
    """
    cl = cubic((ctrl[0][0] * W, ctrl[0][1] * W), (ctrl[1][0] * W, ctrl[1][1] * W),
               (ctrl[2][0] * W, ctrl[2][1] * W), (ctrl[3][0] * W, ctrl[3][1] * W), n)
    if mode == 'head':
        wf = lambda t: (1 - t) ** p
    elif mode == 'tail':
        wf = lambda t: t ** p
    else:
        wf = lambda t: max(0.0, np.sin(np.pi * t ** asym)) ** sharp
    m = polygon_mask(W, band_poly(cl, lambda t: wmax * W * wf(t)))
    if mode in ('head', 'tail'):
        # 厚的那一头补一个圆头 —— 否则是个平口，像被切断的刀片
        r = wmax * W / 2
        x, y = (cl[0] if mode == 'head' else cl[-1])
        cap = Image.new('L', (W, W), 0)
        ImageDraw.Draw(cap).ellipse([x - r, y - r, x + r, y + r], fill=255)
        m = union(m, cap)
    return m


# ───────────────────────── 候选 ─────────────────────────
# 图层语义：'ink' = 墨色，'gold' = 金色。浅底 → 墨色图形 + 金色点子；
# 深底整套互换（墨盘变金盘），所以色调是色调、几何是几何，互不污染。
DISC_R = 0.368          # 圆盘半径：盘是主角，能大就大（安全上限 0.400）


def stroke_mark(ctrl, wmax, mode='head', p=1.5, negative=False, R=DISC_R):
    """墨盘 + 一道行书笔触；negative=True 时把笔触挖成负空间、单色墨。"""
    def fn(W):
        d = circle_mask(W, W * 0.5, W * 0.5, W * R)
        s = intersect(d, sstroke(W, ctrl, wmax, mode, p))   # 笔触裁在盘内，别探出盘缘
        return [(punched(d, s), 'ink')] if negative else [(d, 'ink'), (s, 'gold')]
    return fn


# ── 甲组：其他方向（给「不要圆盘」「要双色」的取向一个出口）──
def mark_1(W):
    """浪分双色：圆盘被一道**下细上宽的浪形缝**分开 —— 左下留墨（砺石），右上透金（升）。

    缝宽从 0.018 渐开到 0.104：起点几乎接上、终点张开成浪 ——
    所以看着是「一道浪把石头顶开」，而不是「切了一刀」。
    """
    d = circle_mask(W, W * 0.5, W * 0.5, W * DISC_R)
    cl = quad((0.430 * W, 0.980 * W), (0.360 * W, 0.450 * W), (0.660 * W, 0.020 * W), 120)
    L, R = split_var(d, W, cl, 0.018, 0.104)
    return [(L, 'ink'), (R, 'gold')]


def mark_2(W):
    """盘 · 开口：盘内一道锥形负空间，自盘底起、向上把盘顶开一道口。"""
    d = circle_mask(W, W * 0.5, W * 0.5, W * DISC_R)
    cut = blade(W, (0.422, 0.700), (0.628, 0.120), (0.300, 0.430), (0.520, 0.395))
    return [(punched(d, cut), 'ink')]


def mark_3(W):
    """破 · 飞片：圆盘被咬掉一片，那一片错开飞向右上。"""
    d = circle_mask(W, W * 0.478, W * 0.518, W * 0.352)
    bite = blade(W, (0.470, 0.920), (0.650, 0.215), (0.398, 0.470), (0.590, 0.435))
    return [(union(punched(d, bite), shift(intersect(d, bite), W * 0.050, -W * 0.046)), 'ink')]


def mark_4(W):
    """金浪嵌盘（对照）：对称月牙 —— 留着当反面参照，60px 会被读成豆子 / 叶子。"""
    d = circle_mask(W, W * 0.5, W * 0.5, W * DISC_R)
    wave = blade(W, (0.438, 0.760), (0.628, 0.178), (0.302, 0.440), (0.522, 0.404))
    return [(d, 'ink'), (wave, 'gold')]


def mark_5(W):
    """石与升浪（轻）：一枚小墨石 ＋ 一道古铜金大浪 —— 主体是金，不是一大坨墨。"""
    stone = circle_mask(W, W * 0.338, W * 0.678, W * 0.120)
    wave = blade(W, (0.412, 0.700), (0.700, 0.185), (0.268, 0.440), (0.500, 0.400))
    return [(stone, 'ink'), (wave, 'gold')]


def mark_6(W):
    """一笔 · 墨锋：笔触做负空间、单色墨 —— 最克制的一版。"""
    d = circle_mask(W, W * 0.5, W * 0.5, W * DISC_R)
    s = sstroke(W, [(0.420, 0.852), (0.334, 0.600), (0.470, 0.430), (0.566, 0.184)],
                0.196, 'head', 1.5)
    return [(punched(d, s), 'ink')]


# ── 乙组：笔触选形（本轮主推）—— 同一枚盘，只换这一笔的「弧势」与「哪一头厚」──
STUDY = [
    ('g', ('头厚尾细 · 立', '起笔按下去、收笔提起来，最像一笔，也最像浪头'),
     [(0.420, 0.852), (0.334, 0.600), (0.470, 0.430), (0.566, 0.184)], 0.196, 'head', 1.5),
    ('h', ('头厚尾细 · 长锋', '同一笔拉长，尾锋扫得更远'),
     [(0.398, 0.870), (0.286, 0.584), (0.520, 0.396), (0.664, 0.158)], 0.180, 'head', 1.7),
    ('i', ('头厚尾细 · 上卷', '尾锋向左上卷回去 —— 浪头翻卷的样子'),
     [(0.446, 0.860), (0.330, 0.560), (0.648, 0.424), (0.548, 0.188)], 0.190, 'head', 1.4),
    ('j', ('头厚尾细 · 横', '同一笔放横，像一道掠过的笔势'),
     [(0.298, 0.360), (0.372, 0.618), (0.612, 0.660), (0.700, 0.436)], 0.196, 'head', 1.5),
    ('k', ('细头粗尾', '反过来：起笔轻、收笔重（当对照）'),
     [(0.420, 0.196), (0.470, 0.430), (0.334, 0.600), (0.420, 0.852)], 0.196, 'tail', 1.5),
    ('l', ('两头尖（对照）', '就是 6 号那种对称叶 —— 会被读成叶子 / 刀片'),
     [(0.372, 0.812), (0.268, 0.560), (0.520, 0.330), (0.668, 0.212)], 0.152, 'leaf', 1.3),
]

MET = ['1', '2', '3', '4', '5', '6']
BRUSH = [k for k, _, _, _, _, _ in STUDY]

MARKS = {}
MARKS.update({k: globals()['mark_' + k] for k in MET})
MARKS.update({k: stroke_mark(c, w, m, p) for k, _, c, w, m, p in STUDY})

TITLES = {
    '1': ('浪分双色', '浪形缝把盘分开：左下墨石、右上透金'),
    '2': ('盘·开口', '盘内锥形负空间，向上把盘顶开'),
    '3': ('破·飞片', '盘被咬掉一片，那一片错开飞向右上'),
    '4': ('对称月牙（反面参照）', '一样的盘子换对称形 —— 会被读成豆子'),
    '5': ('石与升浪（轻）', '一枚小墨石 ＋ 一道古铜金大浪'),
    '6': ('一笔 · 墨锋', '笔触做负空间、单色墨 — 最克制'),
}
TITLES.update({k: v for k, v, _, _, _, _ in STUDY})
TAGS = MET + BRUSH


def render_layers(W, tag, tone):
    """把某候选渲染成 (RGBA 图形层, 最远半径, 合并 alpha)。候选返回 [(alpha,'ink'|'gold'),…]。

    色调只决定「哪种色号用在墨上、哪种用在金上」：浅底 = 墨色图形 + 金色点子；
    深底整套互换 —— 几何与色调彻底解耦，换色不用重画。
    """
    layers = MARKS[tag](W)
    allm = None
    base = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    for alpha, kind in layers:
        allm = alpha if allm is None else union(allm, alpha)
        if tone == 'light':
            color = ink_grad(W) if kind == 'ink' else gold_grad(W, DEEP_HI, DEEP_LO)
        else:
            color = gold_grad(W) if kind == 'ink' else ink_grad(W)
        color.putalpha(alpha)
        base = Image.alpha_composite(base, color)
    return base, far_radius(W, allm), allm


def compose(size, tag, tone='light'):
    W = size * SS
    layer, r, allm = render_layers(W, tag, tone)
    cv = ground(W, tone).convert('RGBA')

    # 极轻的落影：让盘在米白底上「浮起来」一丁点。
    # 不是装饰 —— 一片纯平的大黑块正是「旧」的主要来源之一。
    sh = allm.filter(ImageFilter.GaussianBlur(W * 0.020))
    sh = sh.point(lambda v: int(v * (0.15 if tone == 'light' else 0.30)))
    sc = Image.new('RGBA', (W, W), (28, 24, 18, 255))
    sc.putalpha(sh)
    plate = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    plate.paste(sc, (0, int(W * 0.013)))
    cv.alpha_composite(plate)
    cv.alpha_composite(layer)
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ───────────────────────── 出图 ─────────────────────────
def contact_sheet(tags, tone, title, subtitle, stem):
    cols = 3
    rows = (len(tags) + cols - 1) // cols
    cw, ch = 380, 438
    W, H = 40 * 2 + cols * cw, 172 + rows * ch + 330
    cv = Image.new('RGB', (W, H), (233, 230, 224))
    d = ImageDraw.Draw(cv)
    f = ImageFont.truetype(ZH_FONT, 28)
    ft = ImageFont.truetype(ZH_FONT, 22)
    fs = ImageFont.truetype(ZH_FONT, 17)

    d.text((40, 26), title, font=f, fill=DARKTEXT)
    d.text((40, 70), subtitle, font=fs, fill=(112, 106, 98))

    for i, tag in enumerate(tags):
        x = 40 + (i % cols) * cw
        y = 118 + (i // cols) * ch
        im, r = compose(300, tag, tone)
        cv.paste(im, (x, y))
        name, desc = TITLES[tag]
        d.text((x, y + 314), f'{tag} · {name}', font=ft, fill=DARKTEXT)
        d.text((x, y + 346), desc, font=fs, fill=(112, 106, 98))
        d.text((x, y + 372), f'最远半径 {r:.3f} / 上限 {SAFE:.3f} ' +
               ('✅' if r <= SAFE else '❌'), font=fs,
               fill=(70, 100, 70) if r <= SAFE else (170, 60, 60))

    y0 = 118 + rows * ch + 18
    d.text((40, y0), '桌面真实大小（手机上就这么大 —— 唯一算数的检验标准）',
           font=ft, fill=DARKTEXT)
    for row, px in enumerate((120, 76, 60, 44, 32)):
        y = y0 + 44 + row * (px + 16)
        d.text((38, y + px // 2 - 9), f'{px}px', font=fs, fill=(120, 114, 106))
        for i, tag in enumerate(tags):
            im, _ = compose(px, tag, tone)
            cv.paste(im, (118 + i * (max(px, 44) + 42), y))

    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'{stem}_{tone}.png')
    cv.save(p)
    return f'预览/{stem}_{tone}.png'


def main():
    pick, dark, sheet = None, False, True
    for a in sys.argv[1:]:
        if a.startswith('--pick='):
            pick = a.split('=', 1)[1]
        elif a == '--tone=':
            dark = a.split('=', 1)[1] == 'dark'
        elif a == '--dark':
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
        print(f'  {t} {TITLES[t][0]:<4} {r:.3f}  ' + ('✅' if ok else '❌ 超出安全圆'))

    if sheet:
        for tone in ('light', 'dark'):
            print(f'\n【笔触选形 · 主推】{tone}:',
                  contact_sheet(BRUSH, tone,
                                '砺蕴工作系统 · 桌面图标 · 笔触选形（纯图形 · 无文字）',
                                '同一枚盘、同一道行书笔触，只换弧势与起收笔 —— 挑最顺眼的一道',
                                '图标_笔触'))
            print(f'【其他方向 · 陪跑】{tone}:',
                  contact_sheet(MET, tone,
                                '砺蕴工作系统 · 桌面图标 · 其他方向',
                                '给「不要圆盘」「要双色」「要更轻」的取向各留一个出口',
                                '图标_候选'))

    if pick:
        if pick not in MARKS:
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
        print(f'\n正式图标 = {pick} · {TITLES[pick][0]}（{tone}）')
        print('写出：', '、'.join(made))

    if bad:
        print('\n⚠️ 以下候选超出安全圆，安卓圆形裁切会切到：', '、'.join(bad))


if __name__ == '__main__':
    main()
