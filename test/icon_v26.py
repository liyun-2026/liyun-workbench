#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v26 —— 「声」字的设计化

用户这一轮的话很关键：
  "我博艺那个 logo 它也是博的简化呀、优化呀、变形啊。字声上来你在敷衍谁呢？"

上一轮把字体打的「声」直接放上去 —— 那不是 logo，那是打字。
真正做法（也是博艺徽章的做法）是：**取这个字，重新设计它**。

所以这一版分两层：

【第一层 · 造字】: 用形态学量出原字每一笔的精确坐标，然后按自己的规范**重画**：
    统一粗细 t=0.095、所有端点圆头、下部框做成精确矩形、笔画左对齐。
    出来的「声」是画出来的，不是打出来的。

【第二层 · 改造】: 在重画的字上做 6 种结构手术，看哪一种真的"一眼认得 + 有变化"：
    geo   只重画（地基）
    emit  撇变双撇回声（声音甩出去）
    vibe  整字横向正弦振动（振幅自下而上衰减）
    slice 横切成 7 条按波形错位（字在发声的一瞬）
    neg   字内挖一道负空间正弦波（声音穿过字）
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import far_radius
from icon_v18 import (SS, SAFE, circle_mask, rrect, poly_mask, arc_band,
                      union, punched)
from icon_v21 import place
from icon_v22 import _wallpaper, _chrome
from icon_v18 import ZH_FONT


def font(sz):
    return ImageFont.truetype(ZH_FONT, sz)

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'


# ═══════════════════════ 字面坐标系 ═══════════════════════
# 所有笔画都写在「字面方框」0..1 里，再统一映射到画布。改字号只动 FW。
FW = 0.90
OX = OY = (1 - FW) / 2
T = 0.095                       # 笔画粗细（字面坐标）


def U(u):
    return OX + u * FW


def V(v):
    return OY + v * FW


def rbox(u0, v0, u1, v1, rk=0.5):
    """字面坐标的矩形 → 画布 rrect。rk=0.5 即圆头（半径 = 短边一半）。"""
    w, h = (u1 - u0) * FW, (v1 - v0) * FW
    return rrect(512, U((u0 + u1) / 2), V((v0 + v1) / 2), w, h, min(w, h) * rk * 0.995)


def hbar(v, u0, u1, t=None):
    """横画：以 v 为中心的圆头横条。"""
    t = t or T
    return rbox(u0, v - t / 2, u1, v + t / 2, 0.5)


def vbar(u, v0, v1, t=None):
    t = t or T
    return rbox(u - t / 2, v0, u + t / 2, v1, 0.5)


def taper(pts, w0, w1, n=64, wbreak=None, W=512):
    """变宽笔画（沿折线，两端圆头）。pts 是**字面坐标**点列，会做 Catmull-Rom 平滑。

    汉字撇是弧不是直线 —— 用折线会硬，所以先插值平滑再生成四边形。
    """
    p = np.array(pts, float)
    if len(p) < 3:
        t = np.linspace(0, 1, n)[:, None]
        p = p[0] * (1 - t) + p[-1] * t
    else:
        # Catmull-Rom
        ext = np.vstack([p[0] + (p[0] - p[1]), p, p[-1] + (p[-1] - p[-2])])
        curve = []
        seg = max(2, n // (len(p) - 1))
        for i in range(1, len(ext) - 2):
            p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
            for s in np.linspace(0, 1, seg, endpoint=False):
                curve.append(0.5 * ((2 * p1) + (-p0 + p2) * s +
                                    (2 * p0 - 5 * p1 + 4 * p2 - p3) * s ** 2 +
                                    (-p0 + 3 * p1 - 3 * p2 + p3) * s ** 3))
        curve.append(p[-1])
        p = np.array(curve)
    d = np.gradient(p, axis=0)
    nv = np.stack([-d[:, 1], d[:, 0]], 1)
    nv /= (np.linalg.norm(nv, axis=1, keepdims=True) + 1e-9)
    tt = np.linspace(0, 1, len(p))[:, None]
    if wbreak:                      # 宽度到 wbreak[0] 之前保持不变，之后收到 w1
        k = np.clip((tt - wbreak[0]) / (wbreak[1] - wbreak[0]), 0, 1)
        wid = w0 + (w1 - w0) * k
    else:
        wid = w0 + (w1 - w0) * tt
    hw = wid / 2
    L, R = p + nv * hw, p - nv * hw
    poly = np.vstack([L, R[::-1]])
    m = poly_mask(W, [(U(x), V(y)) for x, y in poly], soft=0.004)
    return union(m, circle_mask(W, U(p[0][0]), V(p[0][1]), w0 / 2 * FW),
                 circle_mask(W, U(p[-1][0]), V(p[-1][1]), w1 / 2 * FW))


# ═══════════════════════ 一、造字：重画「声」 ═══════════════════════
# 坐标全部来自 test/glyph_measure.py 的实测，再按设计规范归一（对齐 / 等粗 / 等距）
H1_V, H2_V, H3_V, H4_V = 0.142, 0.315, 0.470, 0.665     # 四条横的轴线
FL, FR = 0.155, 0.852                                   # 下部框左右竖的轴线
VM_U = 0.500                                            # 中竖
TOP_U = 0.500                                           # 上部中竖


def she_geo(extra=()):
    """★ 几何重画版「声」。extra 里放额外笔画（变形方案用）。"""
    box_l, box_r = FL - T / 2, FR + T / 2
    parts = [
        hbar(H1_V, 0.045, 0.955),                       # 士 · 上横（最长）
        hbar(H2_V, 0.105, 0.905),                       # 士 · 下横
        vbar(TOP_U, 0.000, 0.362),                      # 士 · 中竖
        hbar(H3_V, box_l, box_r),                       # 框 · 顶横
        hbar(H4_V, box_l, box_r),                       # 框 · 底横
        vbar(FL, H3_V - T / 2, 0.720),                  # 框 · 左竖（伸出并接撇）
        vbar(VM_U, H3_V - T / 2, H4_V + T / 2),         # 框 · 中竖
        vbar(FR, H3_V - T / 2, 0.775),                  # 框 · 右竖（伸出带钩）
        taper([(FL, 0.700), (0.128, 0.858), (0.048, 0.968)], T, T * 0.30),   # 撇
    ]
    parts.extend(extra)
    return union(*parts)


def she_raw(W=512, index=2, size=760):
    """对照用：字体原字（缩放到同一字面）。"""
    f = ImageFont.truetype(FONT, size, index=index)
    img = Image.new('L', (size * 2, size * 2), 0)
    ImageDraw.Draw(img).text((size // 2, size // 2), '声', font=f, fill=255)
    img = img.crop(img.getbbox())
    k = (FW * W) / img.width
    nw, nh = max(1, int(img.width * k)), max(1, int(img.height * k))
    img = img.resize((nw, nh), Image.LANCZOS)
    out = Image.new('L', (W, W), 0)
    out.paste(img, (int((W - nw) / 2), int(OX * W)))
    return out


# ═══════════════════════ 二、改造：6 种手术 ═══════════════════════
def op_emit():
    """撇变「双撇回声」：主撇之外再加一道更短更粗的平行弧 —— 声音甩出去还有回响。"""
    return [taper([(FL, 0.700), (0.128, 0.858), (0.048, 0.968)], T, T * 0.30),
            taper([(FL + 0.108, 0.706), (0.146, 0.812), (0.092, 0.916)], T * 0.62, T * 0.16),
            taper([(FL + 0.196, 0.710), (0.238, 0.786), (0.196, 0.862)], T * 0.44, T * 0.12)]


def op_vibe(mask, amp0=0.008, amp1=0.055, freq=1.9, phase=0.0):
    """整字横向正弦振动 —— 振幅自下而上衰减，像声音在字里往上扩散。"""
    a = np.array(mask, float) / 255
    H, W = a.shape
    ys = np.arange(H)
    amp = amp0 + (amp1 - amp0) * (ys / (H - 1))
    shift = amp * np.sin(2 * np.pi * freq * (ys / (H - 1)) + phase) * W
    xs = np.arange(W)[None, :]
    idx = np.clip((xs - shift[:, None]).round().astype(int), 0, W - 1)
    return Image.fromarray((a[ys[:, None], idx] * 255).astype(np.uint8), 'L')


def op_slice(mask, n=7, amp=0.072, gap=0.013):
    """横切成 n 条，每条按正弦错位，条间留缝 —— 字在发声的那一瞬间。"""
    a = np.array(mask, float) / 255.0
    H, W = a.shape
    out = np.zeros_like(a)
    bb = mask.getbbox()
    y0, y1 = bb[1], bb[3]
    span = (y1 - y0) / n
    for i in range(n):
        s0, s1 = int(y0 + i * span), int(y0 + (i + 1) * span)
        dx = int(round(amp * math.sin(2 * math.pi * i / n) * W))
        band = a[s0:s1, :]
        if dx >= 0:
            out[s0:s1, dx:] = band[:, :W - dx]
        else:
            out[s0:s1, :W + dx] = band[:, -dx:]
    m = Image.fromarray((out * 255).astype(np.uint8), 'L')
    # 挖缝
    cuts = []
    for i in range(1, n):
        yy = y0 + i * span
        cuts.append(rrect(512, 0.5, yy / H, 1.2, gap * FW, 0.001))
    return punched(m, union(*cuts))


def op_neg(mask, cy=0.512, thick=0.105, amp=0.070, freq=1.15, ph=math.pi * 0.92):
    """字内挖一道负空间正弦波 —— 声音穿过字，字还是完整的。"""
    W = 512
    xs = np.linspace(-0.08, 1.08, 160)
    up = [(x, cy + amp * math.sin(2 * math.pi * freq * x + ph) - thick / 2) for x in xs]
    dn = [(x, cy + amp * math.sin(2 * math.pi * freq * x + ph) + thick / 2) for x in reversed(xs)]
    return punched(mask, poly_mask(W, [(U(x), V(y)) for x, y in up + dn], soft=0.004))


# ═══════════════════════ 三、出图 ═══════════════════════
def mono(mask, W=512, ink=(246, 246, 248)):
    bg = np.array([18, 19, 24], np.float32)
    a = (np.array(mask.resize((W, W), Image.LANCZOS), np.float32) / 255)[..., None]
    arr = bg * (1 - a) + np.array(ink, np.float32) * a
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')


def sheet(items, path, cols=4, cell=340):
    rows = (len(items) + cols - 1) // cols
    cv = Image.new('RGB', (cols * cell, rows * (cell + 26)), (24, 24, 29))
    d = ImageDraw.Draw(cv)
    f = font(int(cell * 0.052))
    for i, (lab, im) in enumerate(items):
        r, c = divmod(i, cols)
        x, y = c * cell, r * (cell + 26)
        cv.paste(mono(im, cell), (x, y))
        d.text((x + 12, y + cell + 5), lab, font=f, fill=(228, 228, 236))
    cv.save(path)
    return path


def main():
    W = 512
    print('造字 …')
    raw = she_raw()
    geo = she_geo()
    emit = she_geo(op_emit())

    items = [('01 原字（字体打的 · 对照）', place(W, raw)),
             ('02 几何重画（圆头/等粗/对齐）', place(W, geo)),
             ('03 双撇回声', place(W, emit)),
             ('04 横向振动', place(W, op_vibe(place(W, geo)))),
             ('05 切片错位', place(W, op_slice(place(W, geo)))),
             ('06 负形波', place(W, op_neg(place(W, geo))))]

    sheet(items, os.path.join(REVIEW, '图标v26_六案_A.png'), cols=3, cell=380)

    # 小尺寸检验：44 / 84 / 120 / 180
    sizes = [44, 84, 120, 180]
    rows = []
    for lab, m in [('02 重画', geo), ('03 双撇', emit),
                   ('04 振动', op_vibe(place(W, geo))),
                   ('05 切片', op_slice(place(W, geo))),
                   ('06 负波', op_neg(place(W, geo)))]:
        pm = place(W, m)
        rows.append((lab, [mono(pm, s) for s in sizes]))
    CW, CH = 210, 210
    cv = Image.new('RGB', (CW * len(sizes), CH * len(rows)), (24, 24, 29))
    d = ImageDraw.Draw(cv)
    f = font(20)
    for r, (lab, ims) in enumerate(rows):
        for c, im in enumerate(ims):
            s = sizes[c]
            cv.paste(im, (c * CW + (CW - s) // 2, r * CH + (CH - s) // 2))
        d.text((6, r * CH + 6), lab, font=f, fill=(230, 230, 238))
    cv.save(os.path.join(REVIEW, '图标v26_小尺寸.png'))
    print('→ 图标v26_六案_A.png / 图标v26_小尺寸.png')


if __name__ == '__main__':
    main()
