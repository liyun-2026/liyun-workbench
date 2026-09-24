#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砺蕴 · 桌面图标 v22 —— 2026 的语言：mesh 渐变 + 白色极简符号

════════════════════════════════════════════════════════
这一轮改的不是「形」，是「年份」
════════════════════════════════════════════════════════
用户原话：「不好看 / 配色都好丑 / 有那种零几年才会用的那种配色 / 要眼前一亮」

v21 已经解决了「一眼认出」（话筒），但用户还是不满意 —— 说明这一轮的问题
不在识别，在**审美年代**。回看我给过的配色：
    深咖 #32261C · 暖金 #CDA765 · 墨赤 #92342A · 石青绿 #216070 · 博艺蓝 #50638E
    —— 全是**印刷色**（低明度、带灰、靠材质显贵），这正是 2005 年企业 VI 的调色逻辑。
    用户说「零几年的配色」一点没错：我不是配色挑错了，是**整个色系是上一个年代的**。

2026 的图标长什么样（查证：Google 2026 全套图标改版、top100 App 约 40% 用渐变）：
  1. **渐变回来了，但不是 2000 年代的金属高光渐变**，而是
     **mesh gradient —— 多个光斑柔和叠加**（Instagram / Google Photos 的做法）
  2. **邻近色配对**（青→蓝、紫→靛、粉→橙），互补色在小尺寸会脏
  3. **前景符号必须极简 + 纯白** —— 渐变负责"跳"，符号负责"认"
  4. **不要投影**（shadowing 是 2010s 的遗产，现在显脏显旧）
  5. 允许**柔光（glow）**代替投影 —— 让符号"发光"而不是"浮起来"
  6. 深色模式优先 —— 深底 + 亮符号在 OLED 上穿透力最强（抖音的黑底就是这个道理）

所以 v22 = **mesh 渐变满铺 + 纯白话筒 + 一层极轻的柔光**。
形沿用 v21 已经验证过的话筒（识别那道题已经答对了），只把"年份"拨到 2026。

用法
----
  python3 test/icon_v22.py                      # 出全部对照图
  python3 test/icon_v22.py --pick=1 --pal=A     # 出 512 正式资产
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from make_app_mark import far_radius
from icon_v18 import SS, SAFE, ZH_FONT, rrect, poly_mask, arc_band, union, punched
from icon_v21 import capsule, place, trapezoid, sh_desk, sh_hand, sh_lite, sh_u, sh_wave


# ═══════════════════════════ 配色：mesh 渐变（2026 屏幕色） ═══════════════════════════
# base = 底色；blobs = 光斑 (cx, cy, rgb, 半径, 权重)
# 铁律：**邻近色**。青↔蓝、紫↔靛、粉↔橙 —— 跨度一大，小尺寸立刻发脏。
PAL22 = {
    'A': dict(name='深海极光', desc='深空底 + 青紫双光斑 —— 最像 2026，OLED 上会发光',
              base=(12, 18, 38), glow=(120, 220, 255), glowk=0.55,
              blobs=[(0.24, 0.16, (34, 211, 238), 0.62, 1.9),
                     (0.82, 0.90, (109, 93, 246), 0.66, 1.9),
                     (0.92, 0.10, (56, 189, 248), 0.40, 0.9)]),
    'B': dict(name='电光蓝', desc='青→蓝→靛 —— 专业、通透，最"正"的一版',
              base=(29, 78, 216), glow=(255, 255, 255), glowk=0.22,
              blobs=[(0.20, 0.14, (56, 189, 248), 0.66, 1.8),
                     (0.84, 0.92, (67, 56, 202), 0.70, 1.8)]),
    'C': dict(name='紫梦', desc='淡紫→靛 —— 创意、教育、有 AI 味',
              base=(109, 40, 217), glow=(255, 255, 255), glowk=0.24,
              blobs=[(0.18, 0.12, (192, 132, 252), 0.64, 1.9),
                     (0.86, 0.94, (79, 70, 229), 0.70, 1.9)]),
    'D': dict(name='霞光', desc='橙→玫红 —— 舞台、聚光灯、年轻',
              base=(244, 63, 94), glow=(255, 236, 210), glowk=0.26,
              blobs=[(0.20, 0.14, (253, 186, 116), 0.64, 1.8),
                     (0.84, 0.92, (190, 24, 93), 0.70, 1.8)]),
    'E': dict(name='翠玉青', desc='绿松石→湖蓝 —— 清爽、有文化气',
              base=(13, 148, 136), glow=(255, 255, 255), glowk=0.22,
              blobs=[(0.20, 0.14, (94, 234, 212), 0.64, 1.8),
                     (0.84, 0.92, (2, 132, 199), 0.70, 1.8)]),
    'F': dict(name='曜石', desc='近黑石墨 + 极淡冷光 —— 克制、高级，但桌面上偏暗',
              base=(24, 24, 30), glow=(190, 210, 255), glowk=0.42,
              blobs=[(0.26, 0.14, (72, 76, 104), 0.60, 1.5),
                     (0.80, 0.92, (16, 24, 48), 0.70, 1.5)]),
}
PAL_ORDER = ['A', 'B', 'C', 'D', 'E', 'F']

FG = (255, 255, 255)          # 符号：纯白
FG2 = (226, 234, 250)         # 符号底部：极淡冷白（给一点体积，不是投影）


# ═══════════════════════════ mesh 渐变底 ═══════════════════════════
def bg_mesh(W, pal):
    """多光斑高斯叠加 —— 这是 mesh gradient，不是线性渐变。

    线性渐变在 512 上会看出"带状"，且太 2015。
    光斑叠加出来的过渡是各向异性的，有"光从左上角打进来"的方向感，
    Instagram / Google Photos 2025 之后都是这个做法。
    """
    n = W
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) / max(n - 1, 1)
    acc = np.zeros((n, n, 3), np.float32)
    ws = np.zeros((n, n, 1), np.float32)
    for cx, cy, col, rad, wt in pal['blobs']:
        d2 = ((xs - cx) ** 2 + (ys - cy) ** 2) / (rad * rad)
        w = (np.exp(-d2 * 1.75) * wt)[..., None]
        acc += w * np.array(col, np.float32)[None, None, :]
        ws += w
    base = np.array(pal['base'], np.float32)[None, None, :]
    out = (acc + base) / (ws + 1.0)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), 'RGB')


# ═══════════════════════════ 形状 ═══════════════════════════
def sh_word(W, ch='声'):
    """05 字标「声」—— 2026 第一大趋势就是极简字标（Stripe / Notion 的路子）。

    小红书＝红底白字，一个道理。汉字里「声」只有 7 画，小尺寸扛得住。
    """
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    f = ImageFont.truetype(ZH_FONT, int(W * 0.66))
    d.text((W / 2, W / 2), ch, font=f, fill=255, anchor='mm')
    return m


def sh_desk2(W):
    """01 播音话筒 —— v21 验证过的比例，一个参数不动。"""
    return sh_desk(W)


SHAPES = [
    (1, '播音话筒', sh_desk2, '网罩+细颈+圆条底座 —— v21 已验证，主推'),
    (2, '手持话筒', sh_hand,  '网罩+锥形握柄+尾帽 —— 主持人手里那支'),
    (3, '简话筒',   sh_lite,  '只留网罩和一根细颈 —— 最轻'),
    (4, 'U弧话筒',  sh_u,     '网罩+U型环+支杆+横条 —— 标准式'),
    (5, '字标「声」', sh_word, '极简字标，2026 第一大趋势'),
    (6, '声纹(对照)', sh_wave, 'v20 那条路：要人猜，留着做反例'),
]
BY_ID = {s[0]: s for s in SHAPES}
NAMES = {s[0]: s[1] for s in SHAPES}


# ═══════════════════════════ 渲染 ═══════════════════════════
def render(size, sid, tag='A', glow=True, rounded=True):
    pal = PAL22[tag]
    W = size * SS
    bg = bg_mesh(W, pal).convert('RGBA')

    mask = place(W, BY_ID[sid][2](W))

    # 柔光：代替投影。让符号像"自己会发光"，而不是"浮在底上"
    if glow and pal['glowk'] > 0:
        gl = mask.filter(ImageFilter.GaussianBlur(W * 0.020))
        gl = gl.point(lambda v: int(v * pal['glowk']))
        gl_l = Image.new('RGBA', (W, W), tuple(pal['glow']) + (255,))
        gl_l.putalpha(gl)
        bg.alpha_composite(gl_l)

    # 符号：纯白 → 极淡冷白（上下只差 12%，够给体积，又不脏）
    g = np.linspace(0, 1, W, dtype=np.float32)[:, None]          # (W,1)
    c1 = np.array(FG, np.float32); c2 = np.array(FG2, np.float32)
    col = c1[None, :] * (1 - g) + c2[None, :] * g                 # (W,3) 竖向渐变
    arr = np.repeat(col[:, None, :], W, axis=1)                   # (W,W,3)
    sym = Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    sym.putalpha(mask)
    cv = bg
    cv.alpha_composite(sym)

    r = far_radius(W, mask)
    if rounded:
        mm = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mm).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.224, fill=255)
        cv.putalpha(mm)
        return cv.resize((size, size), Image.LANCZOS).convert('RGBA'), r
    return cv.convert('RGB').resize((size, size), Image.LANCZOS), r


# ═══════════════════════════ 出图 ═══════════════════════════
def _fonts():
    return (ImageFont.truetype(ZH_FONT, 34), ImageFont.truetype(ZH_FONT, 23),
            ImageFont.truetype(ZH_FONT, 17), ImageFont.truetype(ZH_FONT, 15))


def sheet(tag='A'):
    """六个形并排 + 五个真机尺寸。"""
    cols, cw, ch = 3, 420, 560
    rows = math.ceil(len(SHAPES) / cols)
    W = 60 * 2 + cols * cw
    H = 250 + rows * ch + 30
    cv = Image.new('RGB', (W, H), (22, 24, 30))
    d = ImageDraw.Draw(cv)
    f1, f2, f3, f4 = _fonts()
    d.text((60, 30), '砺蕴 · 桌面图标 v22 · 2026 语言', font=f1, fill=(240, 242, 248))
    d.text((60, 82), 'mesh 渐变满铺 + 纯白极简符号 + 一层柔光（不要投影）',
           font=f2, fill=(150, 158, 176))
    d.text((60, 124), '配色：%s —— %s' % (PAL22[tag]['name'], PAL22[tag]['desc']),
           font=f4, fill=(120, 128, 148))

    for k, (i, name, fn, note) in enumerate(SHAPES):
        r_, c_ = divmod(k, cols)
        x, y = 60 + c_ * cw, 250 + r_ * ch
        big, rr = render(280, i, tag)
        cv.paste(big, (x + 40, y), big)
        yy = y + 280 + 24
        xx = x + 12
        for px in (120, 76, 60, 44, 32):
            im, _ = render(px, i, tag)
            cv.paste(im, (xx, yy + (120 - px) // 2), im)
            xx += px + 14
        d.text((x + 12, yy + 136), '%02d %s' % (i, name), font=f2, fill=(236, 240, 248))
        d.text((x + 12, yy + 172), note, font=f4, fill=(140, 148, 166))
        d.text((x + 12, yy + 196), '安全半径 %.3f / 上限 %.3f %s' % (rr, SAFE, 'OK' if rr <= SAFE else '超标'),
               font=f4, fill=(110, 190, 140) if rr <= SAFE else (210, 110, 110))
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '图标v22_六案_%s.png' % tag)
    cv.save(p)
    return p


def pal_sheet(shape_ids=(1, 3, 5)):
    cols = len(PAL_ORDER)
    cw, ch = 300, 356
    W = 130 + cols * cw
    H = 300 + len(shape_ids) * ch + 30
    cv = Image.new('RGB', (W, H), (22, 24, 30))
    d = ImageDraw.Draw(cv)
    f1, f2, f3, f4 = _fonts()
    d.text((130, 30), '砺蕴 · 图标 v22 · 六套 2026 配色', font=f1, fill=(240, 242, 248))
    d.text((130, 82), '全是邻近色配对 —— 跨度一大，缩到 44px 就发脏。',
           font=f2, fill=(150, 158, 176))
    for c, tag in enumerate(PAL_ORDER):
        p = PAL22[tag]
        d.text((130 + c * cw + 12, 226), p['name'], font=f3, fill=(228, 232, 242))
        d.text((130 + c * cw + 12, 252), p['desc'][:15], font=f4, fill=(130, 138, 158))
    for r_, sid in enumerate(shape_ids):
        y = 300 + r_ * ch
        d.text((20, y + 122), '%02d' % sid, font=f3, fill=(150, 158, 176))
        d.text((16, y + 148), NAMES[sid], font=f3, fill=(160, 168, 186))
        for c, tag in enumerate(PAL_ORDER):
            im, _ = render(258, sid, tag)
            cv.paste(im, (130 + c * cw + 12, y), im)
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '图标v22_六配色.png')
    cv.save(p)
    return p


def _wallpaper(W, H):
    t = np.linspace(0, 1, H)[:, None]
    top, bot = np.array((38, 46, 72), float), np.array((10, 13, 24), float)
    g = top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None]
    g = np.repeat(g, W, axis=1)
    return Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def _chrome(cv, W, title, sub):
    dr = ImageDraw.Draw(cv)
    f1 = ImageFont.truetype(ZH_FONT, 92)
    f2 = ImageFont.truetype(ZH_FONT, 26)
    f3 = ImageFont.truetype(ZH_FONT, 21)
    f4 = ImageFont.truetype(ZH_FONT, 18)
    dr.text((48, 30), '9:41', font=f3, fill=(255, 255, 255))
    dr.text((W - 48, 30), '5G  100%', font=f3, fill=(255, 255, 255), anchor='ra')
    dr.text((W / 2, 128), '9:41', font=f1, fill=(255, 255, 255), anchor='mm')
    dr.text((W / 2, 198), sub, font=f2, fill=(196, 204, 224), anchor='mm')
    return f4


def home_grid(shape_ids, pal_map=None, stem='图标v22_桌面同屏'):
    """放进真机桌面 —— 「放桌面上好不好看」只有这一张说了算。"""
    pal_map = pal_map or {i: 'A' for i in shape_ids}
    W, H = 1000, 1120
    cv = _wallpaper(W, H)
    f4 = _chrome(cv, W, '', '9月24日 星期四')

    ic, gap, cols = 138, 42, 4
    gw = cols * ic + (cols - 1) * gap
    x0 = (W - gw) // 2
    y0 = 272
    cells = [('now', '现在线上')] + [(i, '%02d %s' % (i, NAMES[i])) for i in shape_ids]
    ph = [(150, 158, 178), (180, 150, 136), (138, 166, 156), (160, 150, 182),
          (182, 170, 140), (140, 158, 186), (168, 140, 150), (146, 170, 150)]
    rows = math.ceil(len(cells) / cols)
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
            im = Image.open(src).convert('RGBA').resize((ic, ic), Image.LANCZOS)
            mark = (255, 214, 150)
        else:
            im, _ = render(ic, idx, pal_map.get(idx, 'A'))
            mark = (214, 222, 238)
        cv.paste(im, (x, y), im)
        ImageDraw.Draw(cv).text((x + ic / 2, y + ic + 8), label, font=f4, fill=mark, anchor='ma')

    dw, dh = W - 140, ic + 34
    dy = y0 + rows * (ic + 62) + 28
    dock = Image.new('RGBA', (dw, dh), (255, 255, 255, 255))
    dm = Image.new('L', (dw, dh), 0)
    ImageDraw.Draw(dm).rounded_rectangle([0, 0, dw - 1, dh - 1], radius=dh * 0.30, fill=255)
    a = Image.new('L', (dw, dh), 34)
    dock.putalpha(Image.composite(a, Image.new('L', (dw, dh), 0), dm))
    cv.alpha_composite(dock, (70, dy))
    dx0 = 70 + (dw - (4 * ic + 3 * gap)) // 2
    for c_ in range(4):
        x = dx0 + c_ * (ic + gap)
        if c_ == 0 and shape_ids:
            im, _ = render(ic, shape_ids[0], pal_map.get(shape_ids[0], 'A'))
            cv.paste(im, (x, dy + 17), im)
        else:
            b = Image.new('RGBA', (ic, ic), ph[(c_ + 3) % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, dy + 17), b)
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '%s.png' % stem)
    cv.convert('RGB').save(p)
    return p


def home_pal(shape_id=1, tags=None, stem='图标v22_桌面同形六色'):
    tags = tags or PAL_ORDER
    W, H = 1000, 1120
    cv = _wallpaper(W, H)
    f4 = _chrome(cv, W, '', '9月24日 星期四')
    ic, gap, cols = 152, 42, 3
    gw = cols * ic + (cols - 1) * gap
    x0 = (W - gw) // 2
    y0 = 282
    cells = [('now', '现在线上')] + [('pal', t) for t in tags]
    ph = [(150, 158, 178), (180, 150, 136), (138, 166, 156)]
    rows = math.ceil(len(cells) / cols)
    while len(cells) < rows * cols:
        cells.append(('ph', ''))
    for k, (kind, val) in enumerate(cells):
        r_, c_ = divmod(k, cols)
        x, y = x0 + c_ * (ic + gap), y0 + r_ * (ic + 78)
        if kind == 'now':
            src = os.path.join(ROOT, 'icon.png')
            im = Image.open(src).convert('RGBA').resize((ic, ic), Image.LANCZOS)
            label, mark = '现在线上', (255, 214, 150)
        elif kind == 'pal':
            im, _ = render(ic, shape_id, val)
            label, mark = PAL22[val]['name'], (214, 222, 238)
        else:
            b = Image.new('RGBA', (ic, ic), ph[k % len(ph)] + (255,))
            mm = Image.new('L', (ic, ic), 0)
            ImageDraw.Draw(mm).rounded_rectangle([0, 0, ic - 1, ic - 1], radius=ic * 0.224, fill=255)
            b.putalpha(mm)
            cv.paste(b, (x, y), b)
            continue
        cv.paste(im, (x, y), im)
        ImageDraw.Draw(cv).text((x + ic / 2, y + ic + 10), label, font=f4, fill=mark, anchor='ma')
    os.makedirs(REVIEW, exist_ok=True)
    p = os.path.join(REVIEW, '%s.png' % stem)
    cv.convert('RGB').save(p)
    return p


def main():
    pick, pal = None, 'A'
    for a in sys.argv[1:]:
        if a.startswith('--pick='):
            pick = int(a.split('=', 1)[1])
        if a.startswith('--pal='):
            pal = a.split('=', 1)[1]

    if pick:
        os.makedirs(REVIEW, exist_ok=True)
        im, r = render(512, pick, pal)
        im.save(os.path.join(REVIEW, '图标v22_%02d_%s.png' % (pick, pal)))
        print('已出 512：', pick, pal, '安全半径 %.3f' % r)
        return

    print('自检（安全圆上限 %.3f）：' % SAFE)
    for i, name, fn, _ in SHAPES:
        r = far_radius(512, place(512, fn(512)))
        print('  %02d %-10s %.3f %s' % (i, name, r, 'OK' if r <= SAFE else '超标'))
    print('六案（深海极光）：', sheet('A'))
    print('六案（电光蓝）：', sheet('B'))
    print('六配色：', pal_sheet((1, 3, 5)))
    print('桌面同屏：', home_grid([1, 2, 3, 4, 5, 6], {i: 'A' for i in range(1, 7)}))
    print('桌面·同形六色：', home_pal(1))
    for tag in PAL_ORDER:
        im, _ = render(512, 1, tag)
        im.save(os.path.join(REVIEW, '图标v22_01_%s.png' % tag))
    print('01 号六配色 512 已出')


if __name__ == '__main__':
    main()
