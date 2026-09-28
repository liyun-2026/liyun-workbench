#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《砺蕴学生系统 · 使用教程》PPT 生成器
  python test/build_stu_tutorial_ppt.py

同一份版面规格渲染两路：
  ① PPTX（python-pptx）——交付物
  ② PNG（PIL，离线质检）—— 逐页目视核对，确保 PPT 不跑版
文字先自己折行，两边一致，所以 QC 图 ≈ PPT 实际效果。
"""
import os, math
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR, MSO_AUTO_SIZE
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'test', '.shots', 'teatut')
CROPS = SHOTS            # 老师教程用整屏截图框入样机，不再逐卡裁切
ASSETS = os.path.join(ROOT, 'assets')
OUTDIR = os.path.expanduser('~/Desktop/砺蕴教务系统/砺蕴授课老师使用教程')
QCDIR = os.path.join(ROOT, 'test', '.shots', 'teatut', 'qc')
os.makedirs(OUTDIR, exist_ok=True); os.makedirs(QCDIR, exist_ok=True)
PPTX_OUT = os.path.join(OUTDIR, '砺蕴授课老师使用教程.pptx')

# ── 版面色板（高端大气：深墨底封面/章节 + 暖白内容 + 珊瑚(老师品牌) + 沉金）──
BG      = 'FAF8F3'   # 内容页暖白
CARD    = 'FFFFFF'
INK     = '20242C'   # 近黑墨
INK2    = '515A66'
INK3    = '8B9099'
GOLD    = 'B08D57'   # 沉金
GOLD_D  = '8A6D3B'
GOLD_L  = 'F1E9D9'
CORAL   = 'C2705A'   # 授课老师品牌色（珊瑚）
CORAL_D = 'A8543F'
CORAL_L = 'F6E7E1'
GREEN   = '4B9C7E'
GREEN_D = '3C7F67'
GREEN_BG= 'EAF4EF'
WARN    = 'A9793A'
WARN_BG = 'FBF2E3'
INFO    = '5578A0'
INFO_BG = 'EEF3F9'
STOP    = 'AF3A2E'
STOP_BG = 'FBEDEB'
LINE    = 'E7E2D8'
LINE2   = 'EFEAE1'
DARK    = '1E2530'   # 封面 / 章节 / 结尾深墨底
DARK2   = '262E3A'
DARKTX  = 'C6CDD6'   # 深底上的浅灰字
GOLDLT  = 'C9A86A'   # 深底上的金

FONT = 'PingFang SC'
DISP = 'Songti SC'    # 大标题用衬线，显高端
# QC 渲染用字体（系统里确定存在的 CJK 黑体）
QCF = '/System/Library/Fonts/Hiragino Sans GB.ttc'
QCF_R = (QCF, 0)   # W3
QCF_B = (QCF, 2)   # W6

SW, SH = 13.333, 7.5
MARGIN = 0.62
BASE = 14.0

# ── 文本度量（真实字体度量，QC 与 PPTX 一致）──────────────
# 用 PIL 直接量字形宽度，替代原来的 em 近似（CJK=1.0 / 其余=0.545）。
# 折行结果同时用于 ① PPTX 预折行（关闭自动换行，见 emit_pptx）② QC PNG，
# 两边同一份折行 → 版式确定，不随渲染器的字体度量漂移。
_FONT_CACHE = {}
def _mfont(size, bold):
    key = (round(size, 2), bool(bold))
    if key not in _FONT_CACHE:
        px = max(8, int(round(size * 4)))   # 4px/pt，量宽足够精细
        _FONT_CACHE[key] = (ImageFont.truetype(QCF, px, index=(QCF_B[1] if bold else QCF_R[1])), px)
    return _FONT_CACHE[key]

# 折行时留的余量：真机上字体度量可能略有差异，留 1% 防止末字被挤出
_WRAP_SAFE = 0.99

def wrap(text, w, size, bold=False):
    avail = w * 72.0 * _WRAP_SAFE
    f, P = _mfont(size, bold)
    out = []
    for seg in str(text).split('\n'):
        cur, curw = '', 0.0
        for ch in seg:
            cw = f.getlength(ch) / P * size      # 该字在该字号下的宽度（pt）
            if cur and curw + cw > avail:
                out.append(cur); cur, curw = ch, cw
            else:
                cur += ch; curw += cw
        out.append(cur)
    return out

def tw(text, w, size, lh=1.55, bold=False):   # 文本块高度（英寸）
    return len(wrap(text, w, size, bold)) * size * lh / 72.0

# ── 版面 ops ────────────────────────────────────────────
def R(ops, x, y, w, h, fill=None, line=None, lw=0.75, r=None):
    ops.append({'t': 'r', 'x': x, 'y': y, 'w': w, 'h': h, 'fill': fill, 'line': line, 'lw': lw, 'r': r})

def IMG(ops, path, x, y, w, h):
    ops.append({'t': 'img', 'path': path, 'x': x, 'y': y, 'w': w, 'h': h})

def T(ops, x, y, w, text, size=BASE, color=INK, bold=False, lh=1.55, align='l', font=None):
    lines = wrap(text, w, size, bold)
    h = len(lines) * size * lh / 72.0
    ops.append({'t': 't', 'x': x, 'y': y, 'w': w, 'h': h, 'lines': lines,
                'size': size, 'color': color, 'bold': bold, 'lh': lh, 'align': align,
                'font': font or FONT})
    return h

def fit_box(path, bx, by, bw, bh):
    iw, ih = Image.open(path).size
    ar = iw / ih
    if ar > bw / bh:
        nw = bw; nh = bw / ar
    else:
        nh = bh; nw = bh * ar
    return bx + (bw - nw) / 2, by + (bh - nh) / 2, nw, nh

# ── 区块渲染 ────────────────────────────────────────────
def B_head(ops, x, y, w, text):
    h = T(ops, x, y, w, text, size=15.2, color=GOLD_D, bold=True, lh=1.2)
    return y + h + 0.10

def B_p(ops, x, y, w, text):
    return y + T(ops, x, y, w, text, size=BASE, color=INK, lh=1.62) + 0.11

def B_note(ops, x, y, w, text):
    return y + T(ops, x, y, w, text, size=BASE - 0.8, color=INK3, lh=1.5) + 0.10

def B_li(ops, x, y, w, text):
    bx = 0.16
    T(ops, x, y + 0.012, 0.13, '·', size=BASE, color=GOLD, bold=True)
    return y + T(ops, x + bx, y, w - bx, text, size=BASE, color=INK, lh=1.58) + 0.10

def B_kv(ops, x, y, w, key, val):
    """关键词 + 说明：左右两栏，同一行起，说明可折行。"""
    kw = 1.90
    T(ops, x, y, kw, key, size=BASE, color=GOLD_D, bold=True, lh=1.55)
    h = T(ops, x + kw, y, w - kw, val, size=BASE, color=INK, lh=1.55)
    return y + max(h, tw(key, kw, BASE, bold=True)) + 0.11

def B_step(ops, x, y, w, n, title, desc):
    d = 0.30
    R(ops, x, y + 0.015, d, d, fill=GOLD_L, r=d / 2)
    T(ops, x, y + 0.015, d, str(n), size=BASE - 0.6, color=GOLD_D, bold=True, align='c', lh=1.9)
    tx = x + d + 0.16
    hh = T(ops, tx, y, w - (d + 0.16), title, size=BASE + 0.2, color=INK, bold=True, lh=1.35)
    y2 = y + hh + 0.03
    if desc:
        y2 += T(ops, tx, y2, w - (d + 0.16), desc, size=BASE - 0.6, color=INK2, lh=1.5)
    return max(y + d, y2) + 0.14

def B_q(ops, x, y, w, text, tone='info', label='系统会这样说'):
    pal = {'info': (INFO_BG, INFO), 'ok': (GREEN_BG, GREEN_D),
           'warn': (WARN_BG, WARN), 'stop': (STOP_BG, STOP)}[tone]
    tx = x + 0.24
    tw_ = w - 0.46
    ly = y + 0.12
    # 先量出高度，再画底色块，最后画字（确保文字在色块之上）
    bh = 0.22
    if label:
        bh += tw(label, tw_, BASE - 1.6, lh=1.2, bold=True) + 0.06
    bh += tw(text, tw_, BASE - 0.3, lh=1.5)
    R(ops, x, y, w, bh, fill=pal[0], r=0.10)
    R(ops, x, y, 0.055, bh, fill=pal[1])
    cy = ly
    if label:
        cy += T(ops, tx, cy, tw_, label, size=BASE - 1.6, color=pal[1], bold=True, lh=1.2) + 0.06
    T(ops, tx, cy, tw_, text, size=BASE - 0.3, color=INK, lh=1.5)
    return y + bh + 0.06

def render_blocks(ops, x, y, w, blocks):
    for b in blocks:
        k = b[0]
        if k == 'h':    y = B_head(ops, x, y, w, b[1])
        elif k == 'p':  y = B_p(ops, x, y, w, b[1])
        elif k == 'n':  y = B_note(ops, x, y, w, b[1])
        elif k == 'li': y = B_li(ops, x, y, w, b[1])
        elif k == 'kv': y = B_kv(ops, x, y, w, b[1], b[2])
        elif k == 's':  y = B_step(ops, x, y, w, b[1], b[2], b[3])
        elif k in ('q',): y = B_q(ops, x, y, w, b[1], b[2] if len(b) > 2 else 'info',
                                  b[3] if len(b) > 3 else '系统会这样说')
        elif k == 'g':  y += b[1]
    return y

def B_q_plain(ops, x, y, w, text, tone='info'):
    return B_q(ops, x, y, w, text, tone, label=None)

# ── 页面骨架 ────────────────────────────────────────────
FOOT = '砺蕴授课老师系统 · 使用教程'

def page_bg(ops):
    R(ops, 0, 0, SW, SH, fill=BG)

def chrome(ops, kicker, title, page, sub=None):
    y = 0.46
    if kicker:
        y += T(ops, MARGIN, y, 9.5, kicker, size=13.0, color=CORAL, bold=True, lh=1.2) + 0.07
    T(ops, MARGIN, y, 12.2, title, size=29, color=INK, bold=True, lh=1.12, font=DISP)
    y += tw(title, 12.2, 29) + 0.10
    if sub:
        y += T(ops, MARGIN, y, 12.2, sub, size=BASE - 0.2, color=INK2, lh=1.5) + 0.06
    R(ops, MARGIN, y + 0.08, 0.9, 0.04, fill=GOLD)
    # 页脚
    R(ops, MARGIN, 7.03, SW - 2 * MARGIN, 0.012, fill=LINE)
    T(ops, MARGIN, 7.10, 6.0, FOOT, size=9, color=INK3, lh=1.2)
    T(ops, SW - MARGIN - 1.2, 7.10, 1.2, str(page), size=9.5, color=GOLD_D, bold=True, align='r', lh=1.2)
    return y + 0.30

def fig_frame(ops, path, box, pad=0.11, radius=0.10, shadow=True):
    bx, by, bw, bh = box
    x, y, w, h = fit_box(path, bx, by, bw, bh)
    if shadow:
        R(ops, x - pad + 0.03, y - pad + 0.04, w + 2 * pad, h + 2 * pad, fill='EDE8E0', r=radius + 0.03)
    R(ops, x - pad, y - pad, w + 2 * pad, h + 2 * pad, fill=CARD, line=LINE, lw=0.75, r=radius)
    IMG(ops, path, x, y, w, h)
    return x, y, w, h

LAYOUT = {
    'phone1': dict(boxes=[(9.70, 1.05, 3.10, 5.55)], textw=8.6, tx=MARGIN, ty=1.42),
    'phone2': dict(boxes=[(7.40, 1.35, 2.40, 5.05), (10.10, 1.35, 2.40, 5.05)],
                   textw=6.3, tx=MARGIN, ty=1.42),
    'desk1':  dict(boxes=[(5.05, 1.28, 7.95, 5.45)], textw=4.1, tx=MARGIN, ty=1.42),
}

def content_slide(ops, kicker, title, blocks, figs=None, page=1, sub=None, ty=None, textw=None):
    page_bg(ops)
    y0 = chrome(ops, kicker, title, page, sub)
    if figs:
        spec = LAYOUT[figs[0]]
        tx = spec['tx']; tww = spec['textw']; tyy = ty or spec['ty']
        for i, fp in enumerate(figs[1]):
            fig_frame(ops, fp, spec['boxes'][i])
    else:
        tx = MARGIN; tww = textw or (SW - 2 * MARGIN); tyy = ty or y0 + 0.10
    render_blocks(ops, tx, tyy, tww, blocks)

# ── 章节隔页（深墨底 · 高端大气）────────────────────────
def divider(ops, num, zh, title, desc):
    # 章节号「01」单独占一行做视觉锚点，下面再是「第X章 + 标题」，上下不叠字
    R(ops, 0, 0, SW, SH, fill=DARK)
    R(ops, 0, 0, 0.16, SH, fill=GOLD)
    T(ops, 1.55, 1.30, 8.0, '%02d' % num, size=90, color=GOLDLT, bold=True, lh=1.0, font=DISP)
    T(ops, 1.62, 2.95, 8.0, zh, size=15, color=CORAL, bold=True, lh=1.2)
    T(ops, 1.62, 3.30, 10.6, title, size=42, color='FFFFFF', bold=True, lh=1.1, font=DISP)
    R(ops, 1.66, 4.28, 1.15, 0.04, fill=GOLD)
    T(ops, 1.62, 4.54, 8.8, desc, size=15, color=DARKTX, lh=1.7)

def cover(ops):
    R(ops, 0, 0, SW, SH, fill=DARK)
    R(ops, 0, 0, SW, 0.20, fill=GOLD)
    R(ops, 0, 0.20, SW, 0.05, fill=GOLD_L)
    fp = os.path.join(ASSETS, 'brand-lock.png')
    cx, cy, cw, ch = fit_box(fp, SW / 2 - 2.6, 1.15, 5.2, 2.1)
    R(ops, cx - 0.22, cy - 0.18, cw + 0.44, ch + 0.36, fill='FBFBF9', r=0.14)
    IMG(ops, fp, cx, cy, cw, ch)
    T(ops, 1.0, 4.10, SW - 2.0, '砺蕴授课老师系统', size=46, color='FFFFFF', bold=True, align='c', lh=1.1, font=DISP)
    T(ops, 1.0, 5.02, SW - 2.0, '使 用 教 程', size=19, color=GOLDLT, bold=True, align='c', lh=1.2)
    R(ops, SW / 2 - 1.0, 5.56, 2.0, 0.03, fill=GOLD)
    T(ops, 1.0, 5.78, SW - 2.0, '上课用得到的功能，一页一页讲透。',
      size=14, color=DARKTX, align='c', lh=1.4)
    T(ops, 1.0, 6.52, SW - 2.0, '博艺教育 · 2026', size=12, color='8A93A0', align='c', lh=1.2)

def closing(ops, page):
    R(ops, 0, 0, SW, SH, fill=DARK)
    R(ops, 0, 0, SW, 0.20, fill=GOLD)
    T(ops, 1.4, 1.55, SW - 2.8, '这一页，写给你', size=17, color=GOLDLT, bold=True, align='c', lh=1.2)
    T(ops, 1.4, 2.10, SW - 2.8, '你只管把课教好，把学生带好，',
      size=34, color='FFFFFF', bold=True, align='c', lh=1.25, font=DISP)
    T(ops, 1.4, 3.40, SW - 2.8, '剩下的琐事，交给系统。',
      size=34, color='FFFFFF', bold=True, align='c', lh=1.25, font=DISP)
    R(ops, SW / 2 - 1.0, 4.66, 2.0, 0.03, fill=GOLD)
    T(ops, 2.2, 4.96, SW - 4.4,
      '让每一堂课被认真对待，让每一份付出被妥善安放。',
      size=15, color=DARKTX, align='c', lh=1.6)
    T(ops, 1.4, 5.74, SW - 2.8, '遇到问题：先翻「常见问题」那一章，或直接问教务。',
      size=14, color=DARKTX, align='c', lh=1.5)
    T(ops, 1.4, 6.38, SW - 2.8, '博艺教育 · 砺蕴授课老师系统 · liyun2026.top',
      size=12, color='8A93A0', align='c', lh=1.3)
    T(ops, SW - MARGIN - 1.2, 7.10, 1.2, str(page), size=9.5, color=GOLDLT, bold=True, align='r', lh=1.2)

# ═══════════════════════════════════════════════════════
#  内容
# ═══════════════════════════════════════════════════════
def P(n): return os.path.join(SHOTS, n)
def C(n): return os.path.join(CROPS, n)

SLIDES = []
def S(**kw): SLIDES.append(kw)

# ── 封面 / 目录 / 前言 ──
S(kind='cover')

S(kind='toc', title='目录',
  items=[('1', '开始使用', '打开 · 登录 · 设备登记 · 认界面'),
         ('2', '今天', '打开系统第一眼看到的五张卡'),
         ('3', '录入今日', '标状态 · 记作业 · 写表现 · 保存'),
         ('4', '我带的班', '班级列表 · 点开看每个学员'),
         ('5', '学员档案', '出勤 · 三科强弱 · 考勤 · 评语'),
         ('6', '每日新闻', '每天一份央视新闻'),
         ('7', '上报与申请', '调课 · 请假上报 · 异常 · 我发过的'),
         ('8', '设置', '账号 · 同步 · 加到桌面'),
         ('9', '常见问题', '所有系统提示，一条条对照')])

S(kind='content', kicker='', title='先花一分钟，看这一页', page=3,
  blocks=[('p', '这本教程按「板块」一个一个讲。每个板块里都有几个小功能，每一个都配了系统里真实的截图和例子，不跳过任何一个。'),
          ('g', 0.06),
          ('h', '一张图看懂三步'),
          ('s', 1, '看图', '左边是系统里真实的样子，文字里说到的地方，就照着图对。'),
          ('s', 2, '照着做', '一个功能通常就 1~3 步，一步一步来就行，不用记。'),
          ('s', 3, '看提示', '每页灰底那一块，是系统真会弹给你的话。看到了不用慌，对着看就好。'),
          ('g', 0.06),
          ('q', '这本教程就是把系统里所有会出现的字，全部收拢到一处：怎么用、会遇到什么、遇到之后该干嘛，都写清楚了。', 'info', '说明')])

# ── 第 1 章 ──
S(kind='divider', num=1, zh='第一章', title='开始使用',
  desc='第一次打开系统，从登录到认路，四步就够。')

S(kind='content', kicker='第一章 · 开始使用', title='怎么打开系统', page=5,
  figs=('phone1', [P('m-tea-gate.png')]),
  blocks=[('p', '在手机或电脑的浏览器里，输入网址：'),
          ('q', 'liyun2026.top', 'ok', '网址'),
          ('g', 0.02),
          ('s', 1, '打开浏览器', '手机自带的浏览器、Safari、Chrome 都可以。'),
          ('s', 2, '地址栏里输入', '输入 liyun2026.top，按回车（手机上点「前往」）。'),
          ('s', 3, '看到「欢迎回来」', '说明打开了，可以登录了。'),
          ('g', 0.04),
          ('h', '强烈建议：加到手机桌面'),
          ('p', '在手机浏览器里点「分享 → 添加到主屏幕」。以后点桌面图标就能直接进，打开更快，也不容易被系统清掉缓存。'),
          ('n', '一个账号最多能在两台设备上登录。')])

S(kind='content', kicker='第一章 · 开始使用', title='怎么登录', page=6,
  figs=('phone1', [P('d-tea-gate.png')]),
  blocks=[('p', '用户名就是你的名字，密码是教务发给你的。'),
          ('s', 1, '填用户名', '就填你的姓名。'),
          ('s', 2, '填密码', '教务给的密码，注意大小写，别多打空格。'),
          ('s', 3, '点「登 录」', '等一两秒就进去了。'),
          ('g', 0.03),
          ('h', '登录不进去？对着这三句找原因'),
          ('q', '没有这个账号。请让教务老师在「学生管理」里创建。', 'warn', '情况一'),
          ('q', '密码不对。', 'warn', '情况二'),
          ('q', '连不上服务器（网络断了，或正在重新部署）。本地已记的东西都在，过一会儿刷新试试。', 'warn', '情况三')])

S(kind='content', kicker='第一章 · 开始使用', title='第一次登录：设备登记', page=7,
  figs=('phone1', [P('m-tea-devgate.png')]),
  blocks=[('p', '一个账号最多登两台设备。第一台登进来的，会自动登记成「认证设备」。'),
          ('p', '如果你换了手机，或者在别人的手机上登录，会弹出这道门，要教务给的一次性密钥才能进。'),
          ('g', 0.04),
          ('h', '门上的两种说法'),
          ('q', '一个账号最多登两台设备。要让这台也能用，找教务要一个密钥（每个密钥只能用一次）。', 'info', '换设备时'),
          ('q', '这台设备上登过别的账号。要让这个号也能在这儿登，找教务要一个密钥（每个密钥只能用一次）。', 'info', '换账号时'),
          ('q', '输一下教务给的密钥', 'warn', '密钥没填就提交'),
          ('q', '这台设备登记好了（或：登记好了（挤掉了原来那台））', 'ok', '登记成功')])

S(kind='content', kicker='第一章 · 开始使用', title='认识主界面（手机）', page=8,
  figs=('phone2', [P('m-tea-home.png'), P('m-tea-drawer.png')]),
  blocks=[('h', '顶部'),
          ('p', '左边是砺蕴的标志和你的名字；右边是「全部功能」按钮。'),
          ('h', '底部五个标签'),
          ('p', '今天 / 录入今日 / 我带的班 / 上报与申请 / 设置 —— 最常用的五个，随时点随时切。'),
          ('h', '「全部功能」抽屉（放不下的都在这儿）'),
          ('p', '点右上角「全部功能」，会从下面滑出一个抽屉，把您能用到的功能一次全列出来：今天、每日新闻、录入今日、我带的班、学员档案、上报与申请、设置。'),
          ('p', '底部五个标签之外的「每日新闻」「学员档案」，就从这里进。'),
          ('q', '先点底部标签进板块，再在页面里点按钮；一时找不到的功能，点「全部功能」抽屉里翻。', 'info', '小提示')])

S(kind='content', kicker='第一章 · 开始使用', title='认识主界面（电脑）', page=9,
  figs=('desk1', [P('d-tea-home.png')]),
  blocks=[('p', '电脑上左侧一栏就是全部功能，点一下就进去，右边是内容。'),
          ('p', '电脑和手机用的是同一套数据，随时切换都同步。'),
          ('h', '电脑上更方便的事'),
          ('li', '看大课表、看学员档案更顺手'),
          ('li', '复制每日新闻（右上角「复制全文」）'),
          ('n', '手机加到主屏幕后，用起来和 App 一样。')])

# ── 第 2 章 ──
S(kind='divider', num=2, zh='第二章', title='今天',
  desc='打开系统第一眼看到的，就是把今天要做的事摊在你面前。')

S(kind='content', kicker='第二章 · 今天', title='今天页：五张卡', page=11,
  figs=('phone1', [P('m-tea-home.png')]),
  blocks=[('p', '「今天」是老师端的首屏。它只回答一个问题：今天我要上什么、班里什么情况？'),
          ('g', 0.03),
          ('s', 1, '教务通知', '教务发的通知，最新的在上面。'),
          ('s', 2, '今天谁到了', '考勤结果一眼扫完（只读，不用改）。'),
          ('s', 3, '我今天要上的课', '只显示今天的课。'),
          ('s', 4, '本周我的课', '这一周排给您的课，整周排布。'),
          ('s', 5, '每日新闻', '央视新闻，出评述题目前先看这里。'),
          ('g', 0.04),
          ('q', '页头那行会写今天的日期、你的名字，和今天有几节课。', 'info', '小提示')])

S(kind='content', kicker='第二章 · 今天', title='今天页 · 今天谁到了', page=12,
  figs=('phone1', [P('m-tea-home-scroll.png')]),
  blocks=[('p', '这一块把今天这个班的考勤，先给四个数，再把没到的、迟到的名字列出来：'),
          ('kv', '已到 X/Y 人：', '今天这个班应到 Y 人，已到 X 人。'),
          ('kv', '迟到：', '迟到的名字列在下面。'),
          ('kv', '请假：', '请了病假 / 事假的名字。'),
          ('kv', '没打卡：', '还没打卡的名字（要留意）。'),
          ('g', 0.03),
          ('q', '这是教务那边的考勤结果，只看不改。要改、要补签都归教务，老师这边不用管。', 'info', '说明')])

S(kind='content', kicker='第二章 · 今天', title='今天页 · 我的课（今天 / 本周）', page=13,
  figs=('desk1', [P('d-tea-home.png')]),
  blocks=[('p', '「我今天要上的课」只显示今天的课：时间、课程名、第几节、班级或教室。'),
          ('p', '「本周我的课」按星期排好，一整周的课程都在，方便您提前准备。'),
          ('g', 0.05),
          ('q', '今天没有排你的课', 'info', '今天没课时'),
          ('q', '教务还没有给你排课', 'info', '还没排课时')])

# ── 第 3 章 ──
S(kind='divider', num=3, zh='第三章', title='录入今日',
  desc='老师端最核心的一页：扫一眼名单，只点有情况的那几个。')

S(kind='content', kicker='第三章 · 录入今日', title='录入今日：怎么进、选班选日期', page=15,
  figs=('phone1', [P('m-tea-record.png')]),
  blocks=[('p', '点底部「录入今日」就进来了。'),
          ('g', 0.02),
          ('s', 1, '选班级', '教务把您带的班分配好，这里就能选（没分配会提示您联系教务）。'),
          ('s', 2, '选日期', '默认是今天，要补记哪天就选哪天。'),
          ('s', 3, '看学生一行一行', '这个班的学生一列出来，谁有情况点谁。'),
          ('g', 0.03),
          ('p', '整体逻辑：您不用把全班都点一遍——只点今天有情况的那几个就行，没点的就是「无特殊情况」。'),
          ('q', '教务还没给你分配班级，联系一下教务', 'warn', '还没分配班级时')])

S(kind='content', kicker='第三章 · 录入今日', title='录入今日：给学生标状态', page=16,
  figs=('phone1', [P('m-tea-record.png')]),
  blocks=[('p', '每个学生右边有四个状态按钮，点一下就记上：'),
          ('li', '状态好 —— 今天表现不错。'),
          ('li', '一般 —— 正常，无特别。'),
          ('li', '需关注 —— 状态不太对，值得留意。'),
          ('li', '身体不适 —— 身体不舒服，需注意。'),
          ('g', 0.02),
          ('p', '再点一下同一个按钮，就取消刚才标的（同一个状态反复点 = 取消）。'),
          ('p', '标过的学生，名字旁边会出现「已记」两个字，方便您确认没漏。')])

S(kind='content', kicker='第三章 · 录入今日', title='录入今日：作业交没交', page=17,
  figs=('phone1', [P('m-tea-record-scroll.png')]),
  blocks=[('p', '学生那一行里有一栏「作业」，显示全班共用的作业登记：'),
          ('kv', '交了：', '绿色标签，说明已经交。'),
          ('kv', '没交：', '灰色标签，还没交。'),
          ('g', 0.03),
          ('p', '一个学生如果有多条作业，会标出是哪一条；多了会写「…还有 N 条」，不会挤成一团。'),
          ('q', '这一栏帮您顺手把量化分的原料也采了：谁交谁没交，一眼清楚。', 'info', '小提示')])

S(kind='content', kicker='第三章 · 录入今日', title='录入今日：课堂表现一句话', page=18,
  figs=('phone1', [P('m-tea-record.png')]),
  blocks=[('p', '每个学生下面有一行「课堂表现」，可以写一句话：'),
          ('q', '课堂表现，一句话，可以不写', 'info', '输入框提示'),
          ('g', 0.02),
          ('p', '写几句今天这个学生的亮点或要注意的地方，家长会看到、教务也会看到。'),
          ('p', '没有特别要说的，空着也行——这不是必填项。')])

S(kind='content', kicker='第三章 · 录入今日', title='录入今日：全部保存', page=19,
  figs=('phone1', [P('m-tea-record.png')]),
  blocks=[('p', '页面右上角有「全部保存」按钮。'),
          ('q', '都存好了（本来就是边填边存）', 'ok', '点全部保存后'),
          ('g', 0.02),
          ('p', '其实您每标一个状态、每写一句，系统就已经存好了。「全部保存」更多是让您安心——不怕漏存。'),
          ('n', '下次打开同一天，您记过的内容都还在，接着补就行。')])

# ── 第 4 章 ──
S(kind='divider', num=4, zh='第四章', title='我带的班',
  desc='您带的班级都在这里，点开就能看每一个学员。')

S(kind='content', kicker='第四章 · 我带的班', title='我带的班：班级 → 点学生', page=21,
  figs=('phone1', [P('m-tea-myclass.png')]),
  blocks=[('p', '这一页列出教务分配给您的班级，每个班后面写着人数。'),
          ('g', 0.02),
          ('s', 1, '看到班级', '班名 + 人数，一目了然。'),
          ('s', 2, '点一个学生', '点名字，直接进入这个学员的「学员档案」。'),
          ('s', 3, '回得去', '看完档案，点返回就回到班级列表。'),
          ('g', 0.03),
          ('q', '教务还没给你分配班级。分配好之后这里会出现你的班。', 'info', '还没分配班级时'),
          ('q', '这个班还没有学员', 'info', '班建好但还没人时')])

# ── 第 5 章 ──
S(kind='divider', num=5, zh='第五章', title='学员档案',
  desc='老师视角看一个学生：出勤、强弱、考勤明细和老师评语。')

S(kind='content', kicker='第五章 · 学员档案', title='学员档案：六项指标 + 三科强弱', page=23,
  figs=('phone1', [P('m-tea-profile.png')]),
  blocks=[('p', '点开一个学生，档案最上面是他的名字和班级。'),
          ('g', 0.02),
          ('h', '上面六个数'),
          ('li', '出勤率、迟到、病假、事假。'),
          ('li', '作业已交、作业未交。'),
          ('g', 0.02),
          ('h', '三科强弱'),
          ('p', '朗读、播报、评述三科的平均分和等第。'),
          ('p', '分数最低、等第靠后的那一科，就是这个学生最该补的地方。'),
          ('q', '老师看档案是看「这一个学生」，不会显示别人的名字，也不排名。', 'info', '说明')])

S(kind='content', kicker='第五章 · 学员档案', title='学员档案：考勤明细 + 老师评语', page=24,
  figs=('desk1', [P('d-tea-profile.png')]),
  blocks=[('h', '考勤明细'),
          ('p', '一天一条，写着日期和当天的状态（正常 / 迟到 / 病假 / 事假）。'),
          ('g', 0.03),
          ('h', '老师评语'),
          ('p', '老师写给这个学生的话都在这里，写着日期和是哪位老师写的。'),
          ('g', 0.03),
          ('q', '还没有考勤记录', 'info', '没有考勤时'),
          ('q', '老师还没有写评语', 'info', '没有评语时')])

# ── 第 6 章 ──
S(kind='divider', num=6, zh='第六章', title='每日新闻',
  desc='看最新新闻，开阔视野。')

S(kind='content', kicker='第六章 · 每日新闻', title='每日新闻怎么看', page=26,
  figs=('phone1', [P('m-tea-news.png')]),
  blocks=[('p', '教务老师每天统一更新就可以了。'),
          ('h', '每条新闻'),
          ('li', '左边是发布时间，右边是标题。'),
          ('li', '标题下面有一句摘要，读一眼就知道讲了什么。'),
          ('li', '点标题，可以打开原文。'),
          ('g', 0.02),
          ('h', '复制全文（电脑更方便）'),
          ('p', '右上角「复制全文」，一键把所有标题和摘要复制走，做练习、做素材都方便。'),
          ('g', 0.02),
          ('q', '还没有今天的新闻', 'info', '还没拉到当天新闻时'),
          ('n', '来源写得很清楚：央视新闻。')])

# ── 第 7 章 ──
S(kind='divider', num=7, zh='第七章', title='上报与申请',
  desc='有事儿要找教务，不用跑办公室——在这里发一条就行。')

S(kind='content', kicker='第七章 · 上报与申请', title='上报与申请：四种类型 + 写一句发出', page=28,
  figs=('phone1', [P('m-tea-tickets.png')]),
  blocks=[('p', '顶部选类型，下面写一句，点「发出」就提交给教务：'),
          ('kv', '调课申请：', '想调课、换节。'),
          ('kv', '请假上报：', '您或学生要请假。'),
          ('kv', '学生异常：', '某个学生情况不对，请教务关注。'),
          ('kv', '其他：', '说不清归哪类的，写这里。'),
          ('g', 0.03),
          ('q', '写一句再发', 'warn', '什么都没写就点发出'),
          ('q', '已发出，教务那边会出现待办', 'ok', '发出成功后')])

S(kind='content', kicker='第七章 · 上报与申请', title='上报与申请：说调课会自动弹空闲时段', page=29,
  figs=('phone1', [P('m-tea-tickets-slots.png')]),
  blocks=[('p', '如果您在文字里提到调课（比如「想换到周四同一节」），系统会先不发出，而是：'),
          ('g', 0.02),
          ('q', '看到你在说调课。下面是你本周没课的时间段，点选想调去的时间（可多选）：', 'info', '调课面板提示'),
          ('g', 0.02),
          ('p', '系统扫了一遍您的课表，把您没课的时段摆出来，您点选想调去的时间。'),
          ('li', '「带上时段发出」—— 把您选的时段一起发给教务。'),
          ('li', '「不用了，直接发出」—— 不挑时段，原话发出。'),
          ('n', '教务收到后确认，调课才生效；这里只是提出申请。')])

S(kind='content', kicker='第七章 · 上报与申请', title='上报与申请：我发过的', page=30,
  figs=('phone1', [P('m-tea-tickets.png')]),
  blocks=[('p', '页面下方「我发过的」，列出您提交过的所有申请，右边是当前状态：'),
          ('kv', '教务已处理：', '教务已经看了、处理了（有的还会附回复）。'),
          ('kv', '等待处理：', '教务还没看，等一等。'),
          ('g', 0.03),
          ('p', '如果教务回了话，会在那条下面显示「教务回复：…」，您直接在这页就能看到。'),
          ('q', '还没发过', 'info', '一次都还没发过时')])

# ── 第 8 章 ──
S(kind='divider', num=8, zh='第八章', title='设置',
  desc='管账号、同步数据、加到手机桌面。')

S(kind='content', kicker='第八章 · 设置', title='设置：我的账号', page=32,
  figs=('phone1', [P('m-tea-settings.png')]),
  blocks=[('p', '上面写着您的名字、账号和角色，还能看到「上次同步」的时间。'),
          ('g', 0.02),
          ('h', '几个按钮'),
          ('kv', '立即同步：', '把本机记的东西立刻传上去。'),
          ('kv', '改密码：', '换成自己记得住的密码。'),
          ('kv', '切换账号：', '在这台设备上换个人用（要密钥）。'),
          ('kv', '退出登录：', '退出，这台设备上就看不清数据了。'),
          ('g', 0.02),
          ('n', '打开系统会自动同步一次，切回前台再自动一次 —— 平时不用手动点。')])

S(kind='content', kicker='第八章 · 设置', title='设置：加到桌面 & 老师端能看到什么', page=33,
  figs=('phone1', [P('m-tea-settings.png')]),
  blocks=[('h', '加到手机桌面'),
          ('p', '在手机浏览器里点「分享 → 添加到主屏幕」，之后就是一个独立图标，打开更快，也不容易被系统清掉缓存。'),
          ('g', 0.03),
          ('h', '老师端的设置里有什么'),
          ('p', '设置页能管账号、同步和加桌面。和教务端相比，这里少了「数据备份」「量化细则」「接口配置」几张卡——那些是教务才用得上的，老师这边不用操心。'),
          ('q', '您能管的是：自己班的录入、上报申请、看学员档案；真正改数据、建号、批假都归教务。', 'info', '权限边界')])

# ── 第 9 章 ──
S(kind='divider', num=9, zh='第九章', title='常见问题',
  desc='系统所有会弹的话，都收在这一章，一条条对照。')

S(kind='content', kicker='第九章 · 常见问题', title='登录与设备', page=35,
  blocks=[('q', '没有这个账号。请让教务老师在「学生管理」里创建。', 'warn', '登录说没这个账号'),
          ('p', '→ 说明教务还没给您建号，直接找教务。'),
          ('g', 0.03),
          ('q', '密码不对。', 'warn', '登录说密码不对'),
          ('p', '→ 检查大小写、有没有多打空格；还不行就找教务重置。'),
          ('g', 0.03),
          ('q', '连不上服务器（网络断了，或正在重新部署）。本地已记的东西都在，过一会儿刷新试试。', 'warn', '登录连不上'),
          ('p', '→ 换 Wi-Fi 或流量，过一会儿再试；已经记下的东西不会丢。'),
          ('g', 0.03),
          ('q', '这台设备还没登记 / 换账号要密钥', 'info', '换了手机或被挡在门外'),
          ('p', '→ 找教务要一次性密钥，填进去就能进。')])

S(kind='content', kicker='第九章 · 常见问题', title='录入与上报', page=36,
  blocks=[('q', '教务还没给你分配班级，联系一下教务', 'warn', '录入今日里没有班级'),
          ('p', '→ 教务还没把班分给您；分好之后这里就会出现班级。'),
          ('g', 0.03),
          ('q', '写一句再发', 'warn', '上报与申请什么都没写就点发出'),
          ('p', '→ 在框里写一句，比如「周三第 2 节想换到周四同一节」，再点发出。'),
          ('g', 0.03),
          ('q', '已发出，教务那边会出现待办', 'ok', '上报发出成功'),
          ('p', '→ 等教务处理；处理完状态会变成「教务已处理」，有的还会附回复，您在这页就能看到。'),
          ('g', 0.03),
          ('q', '还没有今天的新闻 / 还没发过 / 教务还没给你分配班级', 'info', '看到这些空状态'),
          ('p', '→ 这些都不是出错，只是还没到时候；到点了自然会出现。')])

S(kind='closing', page=38)

SLIDES_FINAL = SLIDES
# ═══════════════════════════════════════════════════════
#  渲染：规格 → ops
# ═══════════════════════════════════════════════════════
def build_ops(sl):
    ops = []
    k = sl['kind']
    if k == 'cover':
        cover(ops)
    elif k == 'closing':
        closing(ops, sl['page'])
    elif k == 'divider':
        divider(ops, sl['num'], sl['zh'], sl['title'], sl['desc'])
    elif k == 'toc':
        page_bg(ops)
        chrome(ops, '', sl['title'], 2)
        items = sl['items']
        cw, ch, gx, gy = 5.86, 0.82, 0.28, 0.11
        x0, y0 = MARGIN, 1.30
        for i, (n, t, d) in enumerate(items):
            col = i % 2; row = i // 2
            x = x0 + col * (cw + gx); y = y0 + row * (ch + gy)
            R(ops, x, y, cw, ch, fill=CARD, line=LINE, r=0.09)
            R(ops, x, y, 0.055, ch, fill=CORAL)
            T(ops, x + 0.28, y + 0.11, 0.52, n, size=18, color=CORAL_D, bold=True, lh=1.1, font=DISP)
            T(ops, x + 0.92, y + 0.13, cw - 1.1, t, size=15, color=INK, bold=True, lh=1.15)
            T(ops, x + 0.92, y + 0.47, cw - 1.1, d, size=11.2, color=INK3, lh=1.3)
    elif k == 'content':
        content_slide(ops, sl.get('kicker', ''), sl['title'], sl['blocks'],
                      sl.get('figs'), sl.get('page', 0), sl.get('sub'))
    return ops

# ── 后端 ①：PPTX ────────────────────────────────────────
def emit_pptx(all_ops, path):
    prs = Presentation(); prs.slide_width = Inches(SW); prs.slide_height = Inches(SH)
    blank = prs.slide_layouts[6]
    for ops in all_ops:
        s = prs.slides.add_slide(blank)
        for o in ops:
            if o['t'] == 'r':
                shp = s.shapes.add_shape(
                    MSO_SHAPE.ROUNDED_RECTANGLE if o['r'] else MSO_SHAPE.RECTANGLE,
                    Inches(o['x']), Inches(o['y']), Inches(o['w']), Inches(o['h']))
                if o['fill']:
                    shp.fill.solid(); shp.fill.fore_color.rgb = RGBColor.from_string(o['fill'])
                else:
                    shp.fill.background()
                if o['line']:
                    shp.line.color.rgb = RGBColor.from_string(o['line']); shp.line.width = Pt(o['lw'])
                else:
                    shp.line.fill.background()
                shp.shadow.inherit = False
                if o['r']:
                    try: shp.adjustments[0] = min(0.5, o['r'] / min(o['w'], o['h']))
                    except Exception: pass
            elif o['t'] == 'img':
                s.shapes.add_picture(o['path'], Inches(o['x']), Inches(o['y']),
                                     Inches(o['w']), Inches(o['h']))
            elif o['t'] == 't':
                # ⚠️ 排版正确性的关键：关闭自动换行 + 用「精确行距」，让 PPT 严格按我们预折好的
                #    行来排。否则 PowerPoint / 预览器按自己的字体度量重新折行——行数变多就撑高、
                #    盖住下一块、溢出彩色提示框，正是用户看到的「全部错位」。几何固定后 QC≈实际。
                box = s.shapes.add_textbox(Inches(o['x']), Inches(o['y']),
                                           Inches(o['w']), Inches(o['h'] + 0.06))
                tf = box.text_frame
                tf.word_wrap = False
                try: tf.auto_size = MSO_AUTO_SIZE.NONE
                except Exception: pass
                tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
                tf.vertical_anchor = MSO_ANCHOR.TOP
                al = {'l': PP_ALIGN.LEFT, 'c': PP_ALIGN.CENTER, 'r': PP_ALIGN.RIGHT}[o['align']]
                for i, ln in enumerate(o['lines']):
                    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                    p.alignment = al
                    p.line_spacing = Pt(o['size'] * o['lh'])   # 精确行距 = 行数×size×lh/72 的高度模型
                    p.space_before = Pt(0); p.space_after = Pt(0)
                    r = p.add_run(); r.text = ln
                    f = r.font
                    f.size = Pt(o['size']); f.bold = o['bold']
                    f.color.rgb = RGBColor.from_string(o['color']); f.name = o.get('font') or FONT
                    rPr = r._r.get_or_add_rPr()
                    for tag in ('a:ea', 'a:cs'):
                        el = rPr.find(qn(tag))
                        if el is None:
                            el = rPr.makeelement(qn(tag), {}); rPr.append(el)
                        el.set('typeface', o.get('font') or FONT)
    prs.save(path)
    return len(all_ops)

# ── 后端 ②：PNG（质检）─────────────────────────────────
def _font(size_pt, bold=False):
    px = max(6, int(round(size_pt * 96.0 / 72.0)))
    return ImageFont.truetype(QCF, px, index=(QCF_B[1] if bold else QCF_R[1]))

def emit_png(ops, path, scale=96):
    W, H = int(SW * scale), int(SH * scale)
    im = Image.new('RGB', (W, H), '#' + BG)
    d = ImageDraw.Draw(im)
    def PX(v): return int(round(v * scale))
    for o in ops:
        if o['t'] == 'r':
            box = [PX(o['x']), PX(o['y']), PX(o['x'] + o['w']), PX(o['y'] + o['h'])]
            fill = '#' + o['fill'] if o['fill'] else None
            outline = '#' + o['line'] if o['line'] else None
            rad = PX(o['r']) if o['r'] else 0
            if rad:
                d.rounded_rectangle(box, radius=rad, fill=fill, outline=outline,
                                    width=max(1, int(o['lw'] * scale / 72)))
            else:
                d.rectangle(box, fill=fill, outline=outline,
                            width=max(1, int(o['lw'] * scale / 72)) if outline else 0)
        elif o['t'] == 'img':
            try:
                ic = Image.open(o['path']).convert('RGBA')
                ic = ic.resize((max(1, PX(o['w'])), max(1, PX(o['h']))), Image.LANCZOS)
                im.paste(ic, (PX(o['x']), PX(o['y'])), ic)
            except Exception as e:
                d.rectangle([PX(o['x']), PX(o['y']), PX(o['x'] + o['w']), PX(o['y'] + o['h'])],
                            outline='red')
        elif o['t'] == 't':
            f = _font(o['size'], o['bold'])
            lh = o['size'] * o['lh'] * 96.0 / 72.0
            for i, ln in enumerate(o['lines']):
                yy = PX(o['y']) + int(i * lh)
                if o['align'] == 'c':
                    twp = d.textlength(ln, font=f)
                    d.text((PX(o['x']) + (PX(o['w']) - twp) / 2, yy), ln, font=f, fill='#' + o['color'])
                elif o['align'] == 'r':
                    twp = d.textlength(ln, font=f)
                    d.text((PX(o['x']) + PX(o['w']) - twp, yy), ln, font=f, fill='#' + o['color'])
                else:
                    d.text((PX(o['x']), yy), ln, font=f, fill='#' + o['color'])
    im.save(path)

def _glyph_bbox(o):
    """文字按真实字形宽度 + 对齐，算它在页面上实际占的框（用于查重叠）。"""
    f, P = _mfont(o['size'], o['bold'])
    W = max((f.getlength(ln) / P * o['size'] for ln in o['lines']), default=0) / 72.0
    W = min(o['w'], W)
    x = o['x']
    if o['align'] == 'c':   x += (o['w'] - W) / 2
    elif o['align'] == 'r': x += (o['w'] - W)
    return x, o['y'], W, o['h']

def selfcheck(all_ops):
    """交付前自检：① 不出画布 ② 文字块不互相压字 ③ 不触底。"""
    bad = 0
    for i, ops in enumerate(all_ops, 1):
        mx = max((o['y'] + o['h'] for o in ops if o['t'] != 'r' and o['y'] < 7.0), default=0)
        if mx > 6.98:
            print('  ⚠️ 第 %d 页内容触底 y=%.2f' % (i, mx)); bad += 1
        ts = [o for o in ops if o['t'] == 't']
        bx = [_glyph_bbox(o) for o in ts]
        for a in range(len(bx)):
            for b in range(a + 1, len(bx)):
                x1, y1, w1, h1 = bx[a]; x2, y2, w2, h2 = bx[b]
                ox = min(x1 + w1, x2 + w2) - max(x1, x2)
                oy = min(y1 + h1, y2 + h2) - max(y1, y2)
                if ox > 0.05 and oy > 0.03:
                    print('  ⚠️ 第 %d 页文字重叠：%r / %r'
                          % (i, ts[a]['lines'][0][:16], ts[b]['lines'][0][:16])); bad += 1
    print('✅ 版式自检通过（无触底 / 无文字重叠）' if bad == 0 else '⚠️ 版式自检有 %d 处告警' % bad)

if __name__ == '__main__':
    all_ops = [build_ops(sl) for sl in SLIDES_FINAL]
    n = emit_pptx(all_ops, PPTX_OUT)
    print('✅ PPTX 已生成（%d 页）-> %s' % (n, PPTX_OUT))
    for i, ops in enumerate(all_ops, 1):
        emit_png(ops, os.path.join(QCDIR, 'p%02d.png' % i))
    print('✅ QC 图 %d 张 -> %s' % (len(all_ops), QCDIR))
    selfcheck(all_ops)
