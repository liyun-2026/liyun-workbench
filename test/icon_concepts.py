#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴工作系统 · 桌面图标 —— 六个**全新母题**（第二版：追求「好看」）

用户反馈：来回全是「石头+浪」，没新意、视觉疲劳。要求参考
小红书/抖音/微信/QQ/红果短剧/腾讯视频/芒果TV，结合动物／字变形／图形变形／桌面卡片。

六母题（都从「播音=发声」长出来）：
  A 麦克风 —— 播音最直白的符号（对标 抖音/K歌类）
  B 鸣禽   —— 张嘴鸣叫的鸟 + 声波（动物吉祥物，对标 QQ/红果）
  C 声字   —— 「声」字坐在一道声波上（字变形，对标 小红书 单标）
  D 话泡   —— 对话泡里藏均衡器（对标 微信）
  E 喇叭   —— 扩音喇叭 + 声波（图形变形，对标 芒果TV，播音/广播）
  F 卡片   —— 上 logo 下「今日主推」切影（对标 腾讯视频/芒果TV 桌面卡片）

品质要点（上一版栽在这）：
  背景＝有能量的**对角渐变**（不要沉闷径向）；主体＝**金/暖渐变 + 顶部高光 + 投影**；
  主体**自动缩放进 maskable 安全圆**（0.40）；2~3 色、44px 仍立得住。
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)
import make_app_mark as M

SS = 4
SAFE = M.SAFE
ZH_FONT = M.ZH_FONT
rrect_mask = M.rrect_mask
far_radius = M.far_radius


# ───────────────────────── 底层 ─────────────────────────
def _b(a):
    return np.asarray(a, dtype=np.int16)


def union(*masks):
    out = _b(masks[0])
    for m in masks[1:]:
        out = np.maximum(out, _b(m))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'L')


def sub(a, b):
    return Image.fromarray(np.clip(_b(a) - _b(b), 0, 255).astype(np.uint8), 'L')


def isect(*masks):
    out = _b(masks[0])
    for m in masks[1:]:
        out = np.minimum(out, _b(m))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'L')


def ellipse_mask(W, cx, cy, rx, ry):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).ellipse([(cx - rx) * W, (cy - ry) * W, (cx + rx) * W, (cy + ry) * W], fill=255)
    return m


def circle_mask(W, cx, cy, r):
    return ellipse_mask(W, cx, cy, r, r)


def poly_mask(W, pts):
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).polygon([(x * W, y * W) for x, y in pts], fill=255)
    return m


def ring_mask(W, cx, cy, rout, rin):
    return sub(circle_mask(W, cx, cy, rout), circle_mask(W, cx, cy, rin))


def wedge_mask(W, cx, cy, rout, rin, a0, a1):
    yy, xx = np.mgrid[0:W, 0:W].astype(float)
    d = np.hypot(xx - cx * W, yy - cy * W) / W
    ang = np.degrees(np.arctan2(yy - cy * W, xx - cx * W))
    m = (d >= rin) & (d <= rout) & (((ang - a0) % 360) <= (a1 - a0))
    return Image.fromarray((m * 255).astype(np.uint8), 'L')


def wave_mask(W, yc, amp, cycles, thick, x0=0.07, x1=0.93, phase=0.0, n=240):
    top, bot = [], []
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        y = yc + amp * np.sin(2 * np.pi * cycles * t + phase)
        top.append((x, y - thick)); bot.append((x, y + thick))
    return poly_mask(W, top + bot[::-1])


# ───────────────────────── 材质 ─────────────────────────
def bg(W, c1, c2, glow_c=None, gy=0.40):
    """有能量的对角渐变。"""
    yy, xx = np.mgrid[0:W, 0:W].astype(float)
    t = np.clip((xx + yy) / (2 * W), 0, 1)[..., None]
    a, b = np.array(c1, float), np.array(c2, float)
    g = a * (1 - t) + b * t
    if glow_c is not None:
        d = np.hypot(xx - 0.5 * W, yy - gy * W) / (W * 0.72)
        gl = np.clip(1 - d, 0, 1) ** 2 * 0.18
        g = g * (1 - gl[..., None]) + np.array(glow_c, float)[None, None, :] * gl[..., None]
    return Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def gold(W, cx=0.42, cy=0.32, r0=0.0, r1=0.62, hi=(255, 231, 172), lo=(186, 138, 76)):
    yy, xx = np.mgrid[0:W, 0:W].astype(float)
    d = np.hypot(xx - cx * W, yy - cy * W) / W
    t = np.clip((d - r0) / (r1 - r0), 0, 1)
    a, b = np.array(hi, float), np.array(lo, float)
    return a[None, None, :] * (1 - t[..., None]) + b[None, None, :] * t[..., None]


def flat(W, color):
    return np.broadcast_to(np.array(color, float), (W, W, 3)).copy()


def paint(W, mask, garr):
    im = Image.fromarray(garr.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    im.putalpha(mask)
    return im


def blank(W):
    return Image.new('RGBA', (W, W), (0, 0, 0, 0))


def sheen(subj, W, mask, cx=0.40, cy=0.30, r=0.36, s=0.34):
    """顶部高光：给主体一点光泽感（纯平大色块＝「旧」的元凶）。"""
    yy, xx = np.mgrid[0:W, 0:W].astype(float)
    d = np.hypot(xx - cx * W, yy - cy * W) / (r * W)
    a = (np.clip(1 - d, 0, 1) ** 2 * s * 255) * (np.array(mask, float) / 255)
    lay = Image.new('RGBA', (W, W), (255, 255, 255, 255))
    lay.putalpha(Image.fromarray(a.astype(np.uint8), 'L'))
    subj.alpha_composite(lay)
    return subj


def drop(cv, W, mask, dy=0.020, blur=0.024, alpha=0.34):
    sh = mask.filter(ImageFilter.GaussianBlur(W * blur)).point(lambda v: int(v * alpha))
    sc = Image.new('RGBA', (W, W), (0, 0, 0, 255)); sc.putalpha(sh)
    plate = blank(W); plate.paste(sc, (0, int(W * dy)))
    cv.alpha_composite(plate)
    return cv


def fit(W, subj, target=0.385):
    """把主体自动缩放进 maskable 安全圆，并保持居中。"""
    r = far_radius(W, subj.split()[3])
    if r <= target:
        return subj, r
    f = target / r
    nw = max(1, int(round(W * f)))
    sm = subj.resize((nw, nw), Image.LANCZOS)
    out = blank(W)
    out.alpha_composite(sm, ((W - nw) // 2, (W - nw) // 2))
    return out, far_radius(W, out.split()[3])


# ───────────────────────── A 麦克风 ─────────────────────────
def c_mic(W):
    b = bg(W, (30, 34, 78), (62, 34, 96), (150, 130, 210))
    s = blank(W)
    head = rrect_mask(W, 0.5, 0.385, 0.245, 0.345, 0.1225)
    slots = union(*[rrect_mask(W, 0.5, y, 0.155, 0.018, 0.009) for y in (0.305, 0.365, 0.425, 0.485)])
    head_s = sub(head, slots)
    yoke = isect(ring_mask(W, 0.5, 0.44, 0.245, 0.207),
                 poly_mask(W, [(0, 0.44), (1, 0.44), (1, 1), (0, 1)]))
    stem = rrect_mask(W, 0.5, 0.70, 0.048, 0.135, 0.024)
    base = rrect_mask(W, 0.5, 0.785, 0.185, 0.048, 0.024)
    body = union(head_s, yoke, stem, base)
    s.alpha_composite(paint(W, body, gold(W)))
    s = sheen(s, W, body)
    return b, s


# ───────────────────────── B 鸣禽 ─────────────────────────
def c_bird(W):
    b = bg(W, (18, 66, 74), (9, 30, 44), (90, 190, 170))
    s = blank(W)
    body = ellipse_mask(W, 0.415, 0.635, 0.170, 0.190)
    neck = ellipse_mask(W, 0.505, 0.470, 0.105, 0.115)
    head = circle_mask(W, 0.575, 0.375, 0.113)
    tail = poly_mask(W, [(0.14, 0.80), (0.27, 0.585), (0.33, 0.715)])
    beak_u = poly_mask(W, [(0.655, 0.360), (0.845, 0.315), (0.672, 0.400)])
    beak_l = poly_mask(W, [(0.665, 0.412), (0.830, 0.408), (0.680, 0.458)])
    mark = union(body, neck, head, tail, beak_u, beak_l)
    s.alpha_composite(paint(W, mark, gold(W, 0.40, 0.34, 0.0, 0.60, (255, 233, 178), (194, 146, 80))))
    wing = isect(ring_mask(W, 0.375, 0.655, 0.185, 0.140), mark)
    s.alpha_composite(paint(W, wing, flat(W, (172, 128, 70))))
    s.alpha_composite(paint(W, circle_mask(W, 0.575, 0.352, 0.020), flat(W, (26, 22, 18))))
    s = sheen(s, W, mark, 0.40, 0.38, 0.34, 0.32)
    for rout, rin in ((0.115, 0.090), (0.160, 0.135), (0.205, 0.180)):
        s.alpha_composite(paint(W, wedge_mask(W, 0.845, 0.345, rout, rin, -26, 30), flat(W, (255, 245, 222))))
    return b, s


# ───────────────────────── C 声字 ─────────────────────────
def c_sheng(W):
    b = bg(W, (48, 42, 38), (20, 17, 15), (120, 94, 58))
    s = blank(W)
    wv = wave_mask(W, 0.600, 0.058, 1.4, 0.024, 0.05, 0.95, phase=0.5)
    s.alpha_composite(paint(W, wv, flat(W, (232, 198, 138))))
    font = ImageFont.truetype(ZH_FONT, int(W * 0.60))
    tmp = Image.new('L', (W, W), 0)
    ImageDraw.Draw(tmp).text((W / 2, W * 0.50), '声', font=font, fill=255, anchor='mm')
    ys, xs = np.nonzero(np.array(tmp))
    glyph = Image.fromarray(((np.array(tmp) > 40) * 255).astype(np.uint8), 'L')
    s.alpha_composite(paint(W, glyph, gold(W, 0.45, 0.40, 0.0, 0.55)))
    s = sheen(s, W, glyph, 0.45, 0.34, 0.34, 0.30)
    return b, s


# ───────────────────────── D 话泡 ─────────────────────────
def c_bubble(W):
    b = bg(W, (206, 78, 62), (132, 34, 40), (255, 150, 120))
    s = blank(W)
    bub = rrect_mask(W, 0.5, 0.46, 0.54, 0.54, 0.17)
    tail = poly_mask(W, [(0.32, 0.70), (0.48, 0.70), (0.28, 0.85)])
    mark = union(bub, tail)
    s.alpha_composite(paint(W, mark, flat(W, (255, 252, 246))))
    bars = [0.34, 0.56, 0.80, 0.44, 0.62]
    for i, h in enumerate(bars):
        x = 0.30 + i * 0.10
        bb = rrect_mask(W, x, 0.46 + (0.34 - h * 0.34) / 2, 0.052, h * 0.34, 0.026)
        s.alpha_composite(paint(W, bb, gold(W, 0.5, 0.35, 0.0, 0.5, (232, 96, 74), (176, 44, 42))))
    return b, s


# ───────────────────────── E 喇叭 ─────────────────────────
def c_horn(W):
    b = bg(W, (24, 44, 96), (10, 18, 42), (110, 140, 210))
    s = blank(W)
    horn = poly_mask(W, [(0.27, 0.43), (0.27, 0.57), (0.62, 0.75), (0.62, 0.25)])
    back = rrect_mask(W, 0.265, 0.50, 0.11, 0.20, 0.035)
    mark = union(horn, back)
    s.alpha_composite(paint(W, mark, gold(W, 0.40, 0.40, 0.0, 0.60, (255, 231, 172), (192, 142, 78))))
    s = sheen(s, W, mark, 0.40, 0.42, 0.32, 0.30)
    for rout, rin in ((0.135, 0.108), (0.185, 0.158), (0.235, 0.208)):
        s.alpha_composite(paint(W, wedge_mask(W, 0.66, 0.50, rout, rin, -34, 34), flat(W, (255, 243, 218))))
    return b, s


# ───────────────────────── F 卡片（桌面卡片/海报型） ─────────────────────────
def c_card(W):
    b = bg(W, (44, 50, 70), (16, 20, 32), (100, 120, 168))
    s = blank(W)
    horn = poly_mask(W, [(0.36, 0.31), (0.36, 0.41), (0.60, 0.50), (0.60, 0.22)])
    back = rrect_mask(W, 0.355, 0.36, 0.075, 0.14, 0.025)
    mark = union(horn, back)
    s.alpha_composite(paint(W, mark, gold(W, 0.42, 0.30, 0.0, 0.5)))
    line = rrect_mask(W, 0.5, 0.575, 0.84, 0.006, 0.003)
    s.alpha_composite(paint(W, line, flat(W, (245, 245, 250))))
    strip = rrect_mask(W, 0.5, 0.78, 0.84, 0.36, 0.03)
    s.alpha_composite(paint(W, strip, flat(W, (34, 40, 58))))
    thumb = rrect_mask(W, 0.28, 0.78, 0.22, 0.24, 0.03)
    s.alpha_composite(paint(W, thumb, flat(W, (86, 112, 156))))
    tri = poly_mask(W, [(0.255, 0.735), (0.255, 0.825), (0.315, 0.78)])
    s.alpha_composite(paint(W, tri, flat(W, (255, 255, 255))))
    for i, yy in enumerate((0.735, 0.795, 0.835)):
        bar = rrect_mask(W, 0.645, yy, 0.36 - (0.10 if i == 2 else 0), 0.020, 0.010)
        s.alpha_composite(paint(W, bar, flat(W, (206, 212, 226))))
    return b, s


CONCEPTS = {
    'A': (c_mic, '麦克风', '对标 抖音/K歌 · 最直白', '话筒＝播音发声'),
    'B': (c_bird, '鸣禽', '动物吉祥物 · 对标 QQ/红果', '张嘴鸣叫的鸟 + 声波'),
    'C': (c_sheng, '声字', '字变形 · 对标 小红书', '「声」字坐在声波上'),
    'D': (c_bubble, '话泡', '对标 微信 · 播音=对话', '对话泡里藏均衡器'),
    'E': (c_horn, '喇叭', '图形变形 · 对标 芒果TV', '扩音喇叭 + 声波'),
    'F': (c_card, '卡片', '对标 腾讯视频/芒果TV', '上 logo 下「今日主推」'),
}


def render(key, size, rounded=False):
    W = size * SS
    cfn = CONCEPTS[key][0]
    b, s = cfn(W)
    if key != 'F':                       # F 是海报型，本就走满版
        s, r = fit(W, s)
    else:
        r = far_radius(W, s.split()[3])
    mark = s.split()[3]
    b = drop(b, W, mark)
    b.alpha_composite(s)
    im = b.resize((size, size), Image.LANCZOS).convert('RGB')
    if rounded:
        m = Image.new('L', (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.224, fill=255)
        im = im.convert('RGBA'); im.putalpha(m)
    return im, r


def contact_sheet(stem, title, sub):
    keys = list(CONCEPTS)
    cw, ch = 356, 560
    W = 40 * 2 + len(keys) * cw
    y0 = 176 + ch
    strip = 44 + sum(px + 16 for px in (120, 76, 60, 44, 32))
    H = y0 + strip + 30
    cv = Image.new('RGB', (W, H), (226, 222, 215))
    d = ImageDraw.Draw(cv)
    f = ImageFont.truetype(ZH_FONT, 32); ft = ImageFont.truetype(ZH_FONT, 24); fs = ImageFont.truetype(ZH_FONT, 16)
    d.text((40, 26), title, font=f, fill=(34, 31, 26))
    d.text((40, 76), sub, font=fs, fill=(112, 105, 96))
    y = 176
    for i, key in enumerate(keys):
        x = 40 + i * cw
        big, r = render(key, 272)
        cv.paste(big, (x + 40, y))
        xx = x
        for px in (120, 76, 60, 44):
            im, _ = render(key, px, rounded=True)
            cv.paste(im, (xx, y + 300 + (120 - px) // 2), im)
            xx += px + 10
        d.text((x, y + 444), f"{key} · {CONCEPTS[key][1]}", font=ft, fill=(34, 31, 26))
        d.text((x, y + 476), CONCEPTS[key][2], font=fs, fill=(96, 90, 82))
        d.text((x, y + 502), CONCEPTS[key][3], font=fs, fill=(52, 92, 66))
        d.text((x, y + 528), f"最远半径 {r:.3f}/{SAFE:.3f} " + ('OK' if r <= SAFE else '海报型·走满版'),
               font=fs, fill=(52, 92, 66) if r <= SAFE else (150, 110, 40))
    d.text((40, y0 - 4), '桌面真实大小（手机上就这么大 —— 唯一算数的检验标准）', font=ft, fill=(34, 31, 26))
    for row, px in enumerate((120, 76, 60, 44, 32)):
        yy = y0 + 40 + row * (px + 16)
        d.text((38, yy + px // 2 - 9), f'{px}px', font=fs, fill=(120, 114, 106))
        for i, key in enumerate(keys):
            im, _ = render(key, px)
            cv.paste(im, (116 + i * (max(px, 44) + 30), yy))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'{stem}.png')
    cv.save(p)
    return p


def home_mock(keys, stem):
    W, H = 1000, 1000
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    t = np.clip((xx + yy) / (2 * W), 0, 1)[..., None]
    g = np.array((46, 58, 88), float) * (1 - t) + np.array((14, 19, 34), float) * t
    d = np.hypot(xx - W * 0.2, yy - H * 0.1) / (W * 0.8)
    gl = np.clip(1 - d, 0, 1) ** 2 * 0.30
    g = g * (1 - gl[..., None]) + np.array((110, 130, 180), float)[None, None, :] * gl[..., None]
    cv = Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    dr = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 96); f2 = ImageFont.truetype(ZH_FONT, 27); f3 = ImageFont.truetype(ZH_FONT, 22)
    dr.text((58, 34), '9:41', font=f3, fill=(255, 255, 255))
    dr.text((W - 58, 34), '5G  100%', font=f3, fill=(255, 255, 255), anchor='ra')
    dr.text((W / 2, 150), '9:41', font=f1, fill=(255, 255, 255), anchor='mm')
    dr.text((W / 2, 224), '9月20日 星期日', font=f2, fill=(214, 220, 234), anchor='mm')
    ic, gap = 132, 44
    cols = 3
    gw = cols * ic + (cols - 1) * gap
    x0 = (W - gw) // 2
    for i, key in enumerate(keys):
        r, c = divmod(i, cols)
        x = x0 + c * (ic + gap); y = 330 + r * (ic + 74)
        im, _ = render(key, ic, rounded=True)
        cv.paste(im, (x, y), im)
        dr.text((x + ic // 2, y + ic + 16), CONCEPTS[key][1], font=f3, fill=(224, 228, 238), anchor='mm')
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, f'{stem}.png')
    cv.convert('RGB').save(p)
    return p


def main():
    print('maskable 安全自检：')
    for k in CONCEPTS:
        _, r = render(k, 512)
        print(f'  {k} {CONCEPTS[k][1]:<4} {r:.3f}  ' + ('OK' if r <= SAFE else '（海报型，走满版）'))
    print('候选图：', contact_sheet('桌面图标_六母题', '砺蕴 · 桌面图标 · 六个新母题',
          '不再围着石头转：麦克风 / 鸣禽 / 声字 / 话泡 / 喇叭 / 卡片'))
    print('桌面实景：', home_mock(list(CONCEPTS), '桌面图标_六母题_实景'))


if __name__ == '__main__':
    main()
