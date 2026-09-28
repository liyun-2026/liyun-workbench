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
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'test', '.shots', 'stutut')
CROPS = os.path.join(SHOTS, 'crops')
ASSETS = os.path.join(ROOT, 'assets')
OUTDIR = os.path.expanduser('~/Desktop/砺蕴教务系统/砺蕴学生系统-使用教程')
QCDIR = os.path.join(ROOT, 'test', '.shots', 'stutut', 'qc')
os.makedirs(OUTDIR, exist_ok=True); os.makedirs(QCDIR, exist_ok=True)
PPTX_OUT = os.path.join(OUTDIR, '砺蕴学生系统_使用教程.pptx')

# ── 版面色板 ────────────────────────────────────────────
BG      = 'F7F5F1'
CARD    = 'FFFFFF'
INK     = '2A2724'
INK2    = '6C655A'
INK3    = 'A49C8E'
GOLD    = 'BE9F6E'
GOLD_D  = '96794A'
GOLD_L  = 'F3ECDF'
GREEN   = '4B9C7E'
GREEN_D = '3C7F67'
GREEN_BG= 'EAF4EF'
WARN    = 'A9793A'
WARN_BG = 'FBF2E3'
INFO    = '5578A0'
INFO_BG = 'EEF3F9'
STOP    = 'AF3A2E'
STOP_BG = 'FBEDEB'
LINE    = 'E6E0D5'
LINE2   = 'EFEAE1'
DARK    = '26231F'

FONT = 'PingFang SC'
# QC 渲染用字体（系统里确定存在的 CJK）
QCF = '/System/Library/Fonts/Hiragino Sans GB.ttc'
QCF_R = (QCF, 0)   # W3
QCF_B = (QCF, 2)   # W6

SW, SH = 13.333, 7.5
MARGIN = 0.62
BASE = 13.8

# ── 文本度量 ────────────────────────────────────────────
def _cw(ch):
    return 1.0 if ord(ch) > 0x2E80 else 0.545

def wrap(text, w, size):
    per = w / (size / 72.0)
    out = []
    for seg in str(text).split('\n'):
        cur, c = '', 0.0
        for ch in seg:
            cw = _cw(ch)
            if c + cw > per and cur:
                out.append(cur); cur, c = ch, cw
            else:
                cur += ch; c += cw
        out.append(cur)
    return out

def tw(text, w, size, lh=1.55):   # 文本块高度（英寸）
    return len(wrap(text, w, size)) * size * lh / 72.0

# ── 版面 ops ────────────────────────────────────────────
def R(ops, x, y, w, h, fill=None, line=None, lw=0.75, r=None):
    ops.append({'t': 'r', 'x': x, 'y': y, 'w': w, 'h': h, 'fill': fill, 'line': line, 'lw': lw, 'r': r})

def IMG(ops, path, x, y, w, h):
    ops.append({'t': 'img', 'path': path, 'x': x, 'y': y, 'w': w, 'h': h})

def T(ops, x, y, w, text, size=BASE, color=INK, bold=False, lh=1.55, align='l'):
    lines = wrap(text, w, size)
    h = len(lines) * size * lh / 72.0
    ops.append({'t': 't', 'x': x, 'y': y, 'w': w, 'h': h, 'lines': lines,
                'size': size, 'color': color, 'bold': bold, 'lh': lh, 'align': align})
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
    T(ops, x, y + 0.012, 0.3, '·', size=BASE, color=GOLD, bold=True)
    return y + T(ops, x + bx, y, w - bx, text, size=BASE, color=INK, lh=1.58) + 0.10

def B_kv(ops, x, y, w, key, val):
    """关键词 + 说明：左右两栏，同一行起，说明可折行。"""
    kw = 1.90
    T(ops, x, y, kw, key, size=BASE, color=GOLD_D, bold=True, lh=1.55)
    h = T(ops, x + kw, y, w - kw, val, size=BASE, color=INK, lh=1.55)
    return y + max(h, tw(key, kw, BASE)) + 0.11

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
        bh += tw(label, tw_, BASE - 1.6, lh=1.2) + 0.06
    bh += tw(text, tw_, BASE - 0.3, lh=1.5)
    R(ops, x, y, w, bh, fill=pal[0], r=0.10)
    R(ops, x, y, 0.055, bh, fill=pal[1])
    cy = ly
    if label:
        cy += T(ops, tx, cy, tw_, label, size=BASE - 1.6, color=pal[1], bold=True, lh=1.2) + 0.06
    T(ops, tx, cy, tw_, text, size=BASE - 0.3, color=INK, lh=1.5)
    return y + bh + 0.11

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
FOOT = '砺蕴学生系统 · 使用教程'

def page_bg(ops):
    R(ops, 0, 0, SW, SH, fill=BG)

def chrome(ops, kicker, title, page, sub=None):
    y = 0.44
    if kicker:
        y += T(ops, MARGIN, y, 9.5, kicker, size=13.0, color=GOLD_D, bold=True, lh=1.2) + 0.06
    T(ops, MARGIN, y, 12.2, title, size=27, color=INK, bold=True, lh=1.15)
    y += tw(title, 12.2, 25) + 0.10
    if sub:
        y += T(ops, MARGIN, y, 12.2, sub, size=BASE - 0.4, color=INK2, lh=1.5) + 0.06
    R(ops, MARGIN, y + 0.06, 0.9, 0.035, fill=GOLD)
    # 页脚
    R(ops, MARGIN, 7.03, SW - 2 * MARGIN, 0.012, fill=LINE)
    T(ops, MARGIN, 7.10, 6.0, FOOT, size=9, color=INK3, lh=1.2)
    T(ops, SW - MARGIN - 1.2, 7.10, 1.2, str(page), size=9.5, color=GOLD_D, bold=True, align='r', lh=1.2)
    return y + 0.28

def fig_frame(ops, path, box, pad=0.11, radius=0.10, shadow=True):
    bx, by, bw, bh = box
    x, y, w, h = fit_box(path, bx, by, bw, bh)
    if shadow:
        R(ops, x - pad + 0.03, y - pad + 0.04, w + 2 * pad, h + 2 * pad, fill='EDE8E0', r=radius + 0.03)
    R(ops, x - pad, y - pad, w + 2 * pad, h + 2 * pad, fill=CARD, line=LINE, lw=0.75, r=radius)
    IMG(ops, path, x, y, w, h)
    return x, y, w, h

LAYOUT = {
    'phone1': dict(boxes=[(9.90, 1.34, 2.80, 5.52)], textw=8.95, tx=MARGIN, ty=1.44),
    'phone2': dict(boxes=[(7.66, 1.72, 2.24, 4.94), (10.42, 1.72, 2.24, 4.94)],
                   textw=6.62, tx=MARGIN, ty=1.44),
    'crop1':  dict(boxes=[(7.30, 1.40, 5.42, 5.40)], textw=6.30, tx=MARGIN, ty=1.44),
    'crop2':  dict(boxes=[(7.30, 1.34, 5.42, 2.60), (7.30, 4.10, 5.42, 2.60)],
                   textw=6.30, tx=MARGIN, ty=1.44),
    'desk1':  dict(boxes=[(5.24, 1.40, 7.48, 5.20)], textw=4.34, tx=MARGIN, ty=1.44),
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

# ── 章节隔页 ────────────────────────────────────────────
def divider(ops, num, zh, title, desc):
    page_bg(ops)
    R(ops, 0, 0, 0.30, SH, fill=GOLD)
    T(ops, 1.55, 1.75, 4.0, '%02d' % num, size=96, color='EFE8DC', bold=True, lh=1.0)
    T(ops, 1.72, 2.05, 8.0, zh, size=15, color=GOLD_D, bold=True, lh=1.2)
    T(ops, 1.72, 2.42, 10.6, title, size=40, color=INK, bold=True, lh=1.12)
    R(ops, 1.78, 4.02, 1.15, 0.04, fill=GOLD)
    T(ops, 1.72, 4.28, 8.6, desc, size=14.5, color=INK2, lh=1.7)

def cover(ops):
    page_bg(ops)
    R(ops, 0, 0, SW, 0.22, fill=GOLD)
    R(ops, 0, 0.22, SW, 0.05, fill=GOLD_L)
    fp = os.path.join(ASSETS, 'brand-lock.png')
    x, y, w, h = fit_box(fp, SW / 2 - 2.9, 1.02, 5.8, 2.55)
    IMG(ops, fp, x, y, w, h)
    T(ops, 1.0, 4.02, SW - 2.0, '砺蕴学生系统', size=44, color=INK, bold=True, align='c', lh=1.1)
    T(ops, 1.0, 4.92, SW - 2.0, '使 用 教 程', size=19, color=GOLD_D, bold=True, align='c', lh=1.2)
    R(ops, SW / 2 - 1.0, 5.46, 2.0, 0.03, fill=GOLD)
    T(ops, 1.0, 5.66, SW - 2.0, '有不懂的，看看我就对了。',
      size=14, color=INK2, align='c', lh=1.4)
    T(ops, 1.0, 6.42, SW - 2.0, '博艺教育 · 2026', size=12, color=INK3, align='c', lh=1.2)

def closing(ops, page):
    page_bg(ops)
    R(ops, 0, 0, SW, 0.22, fill=GOLD)
    T(ops, 1.4, 1.55, SW - 2.8, '这一页，写给你', size=17, color=GOLD_D, bold=True, align='c', lh=1.2)
    T(ops, 1.4, 2.05, SW - 2.8, '你只管把今天的课上好，把该做的做好，',
      size=33, color=INK, bold=True, align='c', lh=1.25)
    T(ops, 1.4, 3.35, SW - 2.8, '剩下的交给我，好成绩自然就来了。',
      size=33, color=INK, bold=True, align='c', lh=1.25)
    R(ops, SW / 2 - 1.0, 4.62, 2.0, 0.03, fill=GOLD)
    T(ops, 2.2, 4.92, SW - 4.4,
      '让每一堂课被认真对待，让每一份付出被妥善安放。',
      size=15, color=INK2, align='c', lh=1.6)
    T(ops, 1.4, 5.70, SW - 2.8, '遇到问题：先翻「常见问题」那一章，或直接问教务老师。',
      size=14, color=INK2, align='c', lh=1.5)
    T(ops, 1.4, 6.35, SW - 2.8, '博艺教育 · 砺蕴学生系统 · liyun2026.top',
      size=12, color=INK3, align='c', lh=1.3)
    T(ops, SW - MARGIN - 1.2, 7.10, 1.2, str(page), size=9.5, color=GOLD_D, bold=True, align='r', lh=1.2)

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
         ('2', '今日', '打开系统第一眼看到的四张卡'),
         ('3', '打卡 / 请假', '两步打卡 · 断网 · 请假 · 查记录'),
         ('4', '每日新闻', '每天一份央视新闻'),
         ('5', '我的课表', '我这周都有什么课'),
         ('6', '考试与抽签', '出场序号 · 模考成绩'),
         ('7', '本班量化', '班级总分 · 我的加扣分'),
         ('8', '我的档案', '出勤 · 三科强弱 · 老师评语'),
         ('9', '我的作业', '作业交没交，一目了然'),
         ('10', '限时征集', '教务发起的临时填报'),
         ('11', '设置', '账号 · 同步 · 加到手机桌面'),
         ('12', '常见问题', '所有系统提示，一条条对照')])

S(kind='content', kicker='', title='先花一分钟，看这一页', page=3,
  blocks=[('p', '这本教程按「板块」一个一个讲。每个板块里都有几个小功能，每一个都配了图和例子，不讲跳过一个。'),
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
  figs=('phone1', [P('m-gate.png')]),
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
  figs=('phone1', [P('d-gate.png')]),
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
  figs=('phone1', [P('m-devgate.png')]),
  blocks=[('p', '一个学生账号最多登两台设备。第一台登进来的，会自动登记成「认证设备」。'),
          ('p', '如果你换了手机，或者在别人的手机上登录，会弹出这道门，要教务给的一次性密钥才能进。'),
          ('g', 0.04),
          ('h', '门上的两种说法'),
          ('q', '一个学生账号最多登两台设备。要让这台也能用，找教务要一个密钥（每个密钥只能用一次）。', 'info', '换设备时'),
          ('q', '这台设备上登过别的学生账号。要让这个号也能在这儿登，找教务要一个密钥（每个密钥只能用一次）。', 'info', '换账号时'),
          ('q', '输一下教务给的密钥', 'warn', '密钥没填就提交'),
          ('q', '这台设备登记好了（或：登记好了（挤掉了原来那台））', 'ok', '登记成功')])

S(kind='content', kicker='第一章 · 开始使用', title='认识主界面（手机）', page=8,
  figs=('phone2', [P('m-home.png'), P('m-drawer.png')]),
  blocks=[('h', '顶部'),
          ('p', '左边是你好 + 你的名字；右边「全部功能」，点开是全部板块。'),
          ('h', '底部五个标签'),
          ('p', '今日 / 打卡 / 每日新闻 / 我的课表 / 设置 —— 最常用的五个，随时点随时切。'),
          ('h', '全部功能'),
          ('p', '剩下的板块都收在这里：限时征集、考试与抽签、本班量化、我的档案、我的作业。'),
          ('q', '手机上大多数操作，都是先在上面选中板块，再在下面点按钮。', 'info', '小提示')])

S(kind='content', kicker='第一章 · 开始使用', title='认识主界面（电脑）', page=9,
  figs=('desk1', [P('d-home.png')]),
  blocks=[('p', '电脑上左侧一栏就是全部功能，点一下就进去，右边是内容。'),
          ('p', '电脑和手机用的是同一套数据，随时切换都同步。'),
          ('h', '电脑上更方便的事'),
          ('li', '看大课表、看量化统计'),
          ('li', '复制每日新闻（右上角「复制全文」）'),
          ('n', '手机加到主屏幕后，用起来和 App 一样。')])

# ── 第 2 章 ──
S(kind='divider', num=2, zh='第二章', title='今日',
  desc='打开系统第一眼看到的，就是把今天要做的事摊在你面前。')

S(kind='content', kicker='第二章 · 今日', title='今日页：四张卡', page=11,
  figs=('phone1', [P('m-home.png')]),
  blocks=[('p', '「今日」是首屏。它只回答一个问题：今天我要做什么？'),
          ('g', 0.03),
          ('s', 1, '打卡', '今天打了没有；没打，点「去打卡」。'),
          ('s', 2, '教务通知', '教务发的通知，最新的在上面。'),
          ('s', 3, '今天上什么课', '只显示今天的课。'),
          ('s', 4, '今日作业', '今天的作业，交了没有。'),
          ('g', 0.04),
          ('q', '页头那行会写今天的日期、你的名字和班级，确认一下是不是你自己。', 'info', '小提示')])

S(kind='content', kicker='第二章 · 今日', title='打卡卡：三种状态', page=12,
  figs=('crop2', [C('m-home__01_打卡.png'), C('m-home-scroll__04_今日作业.png')]),
  blocks=[('h', '还没打卡'),
          ('p', '显示「还没打卡」和绿色「去打卡」按钮，点它直接跳到打卡页。'),
          ('h', '已经打卡'),
          ('p', '显示状态、打卡时间，还有用的什么方式。'),
          ('h', '这天不用打卡'),
          ('p', '请假批准之后，会显示「今日已请假」「这天不用打卡。」'),
          ('g', 0.02),
          ('h', '打卡方式有五种'),
          ('kv', '动态码：', '定位 + 输入教务给的码（最常见）'),
          ('kv', '定位：', '定位打卡成功'),
          ('kv', '定位（存疑）：', '定位有点偏，教务会核对'),
          ('kv', '直接打卡：', '没取到位置，直接打的'),
          ('kv', '教务补签：', '教务那边帮你补的')])

S(kind='content', kicker='第二章 · 今日', title='教务通知', page=13,
  figs=('crop1', [C('m-home-scroll__02_教务通知.png')]),
  blocks=[('p', '教务发的通知都在这里，按时间倒序排 —— 最新的一条在最上面。'),
          ('p', '最多显示 5 条。每条消息下面写着日期和发布人，方便你确认是谁发的。'),
          ('g', 0.04),
          ('q', '还没有通知', 'info', '暂时没有时'),
          ('n', '看到重要通知，可以自己截图留一份。')])

S(kind='content', kicker='第二章 · 今日', title='今天上什么课', page=14,
  figs=('crop1', [C('m-home-scroll__03_今天上什么课.png')]),
  blocks=[('p', '只显示今天的课：时间、课程名、第几节、班级或教室。'),
          ('p', '右边那个小标签写着「大课」或「小课」—— 一对一那种就是小课。'),
          ('g', 0.05),
          ('q', '今天没有排课', 'info', '今天没课时')])

S(kind='content', kicker='第二章 · 今日', title='今日作业', page=15,
  figs=('crop1', [C('m-home-scroll__04_今日作业.png')]),
  blocks=[('p', '今天的作业列在这里，右边直接告诉你交了没：'),
          ('kv', '已交：', '绿色标签，说明已经登记为完成。'),
          ('kv', '未交：', '还没交，记得补上。'),
          ('g', 0.05),
          ('q', '今天没有作业', 'info', '今天没作业时')])

# ── 第 3 章 ──
S(kind='divider', num=3, zh='第三章', title='打卡 / 请假',
  desc='打卡、查记录、请假，都在同一个页面。这一章讲得最细。')

S(kind='content', kicker='第三章 · 打卡', title='打卡总览：为什么是两步', page=17,
  figs=('phone1', [P('m-sign.png')]),
  blocks=[('p', '打卡就一个动作：按中间那个圈。'),
          ('p', '圈里从上到下三样 —— 定位标、「打卡」两个字、此刻的时间（和办公室的钟一样准）。'),
          ('g', 0.04),
          ('h', '为什么要两步'),
          ('s', 1, '先定位', '证明你人确实在校区里。'),
          ('s', 2, '再输码', '证明这是这节课、这个时间。'),
          ('g', 0.03),
          ('p', '两样都要，所以是「先取位置、再要码」。少一步，教务那边就会标成「需核对」。'),
          ('q', '打卡时间 08:30', 'info', '圈下面这行')])

S(kind='content', kicker='第三章 · 打卡', title='第一步：定位', page=18,
  figs=('phone2', [P('m-sign-step1.png'), P('m-sign-geofail.png')]),
  blocks=[('s', 1, '站在校区里，点中间那个圈', '出现「正在定位…」，等几秒。'),
          ('g', 0.02),
          ('h', '定位成功（左图）'),
          ('p', '圈下方出现一行字：「已定位（误差约 12 米）—— 输一下码，再按上面的圈。」'),
          ('g', 0.02),
          ('h', '定位失败（右图）'),
          ('q', '取不到位置，直接输码也能打（会标需核对）', 'warn', '取不到位置'),
          ('q', '这个浏览器不支持定位，直接输码也能打（会标需核对）', 'warn', '浏览器不支持'),
          ('n', '别把「误差约 X 米」当成「离校区 X 米」—— 那是手机自己报的定位精度，跟远近没关系。')])

S(kind='content', kicker='第三章 · 打卡', title='第二步：输入动态码', page=19,
  figs=('phone1', [P('m-sign-step1.png')]),
  blocks=[('p', '码是教务给的那个 —— 可能写在讲台上，也可能教务发在群里。'),
          ('g', 0.03),
          ('s', 1, '在「码」框里输入', '输教务给的那个码。'),
          ('s', 2, '再按上面那个圈', '按下去就是提交。'),
          ('g', 0.04),
          ('q', '输一下讲台上那个码', 'warn', '码没填就按圈'),
          ('q', '输错了会被打回，重新输对的就行。', 'info', '输错了怎么办'),
          ('n', '定位好了、还差一个码的时候，圈下面才长出这个输入框；其余时候是干净的。')])

S(kind='content', kicker='第三章 · 打卡', title='打卡成功：三种结果', page=20,
  figs=('phone2', [P('m-sign-done.png'), P('m-sign-late.png')]),
  blocks=[('h', '正常'),
          ('q', '打上了，08:26 · 正常', 'ok', '系统会这样说'),
          ('g', 0.02),
          ('h', '迟到'),
          ('q', '打上了，08:36 · 迟到 6 分钟', 'warn', '系统会这样说'),
          ('p', '系统零宽限：到点就算迟到，过一分钟也算。'),
          ('g', 0.02),
          ('h', '待核'),
          ('q', '已记录，等教务核对（这不算缺卡）', 'info', '系统会这样说'),
          ('p', '定位存疑时会这样。放心，这不算你没打，等教务确认就好。'),
          ('n', '打上之后，圈里会变成一个对勾和「已打卡」。')])

S(kind='content', kicker='第三章 · 打卡', title='没网也能打', page=21,
  figs=('phone1', [P('m-sign.png')]),
  blocks=[('p', '没网的时候按下圈，系统会把你按下那一刻的时间，记在本机里。'),
          ('g', 0.03),
          ('q', '现在没网，已记下打卡时间 08:29，联网后自动提交（就按这个时间算迟到）', 'warn', '断网按下时'),
          ('g', 0.02),
          ('p', '等有网了会自动补传，页面上也会告诉你：'),
          ('q', '断网时记的打卡已补传（按当时按下的时间算的）', 'ok', '联网补传后'),
          ('g', 0.03),
          ('h', '两个让人安心的地方'),
          ('li', '断网不会让你白打 —— 按你按下的那一刻算。'),
          ('li', '改手机时间没用 —— 系统的时间是按服务端校准过的。')])

S(kind='content', kicker='第三章 · 打卡', title='已经打了，还想再打一次', page=22,
  figs=('phone1', [P('m-sign-done.png')]),
  blocks=[('p', '万一刚才打错了，点「重新打卡」，重新走一遍定位和输码。'),
          ('h', '会怎样'),
          ('li', '可以重新打，以最后一次为准。'),
          ('li', '记录里会留下痕迹，教务那边看得到，别乱按。'),
          ('g', 0.03),
          ('q', '重新打卡是给你改错的，不是用来补昨天的。', 'info', '小提示')])

S(kind='content', kicker='第三章 · 打卡', title='我这个月的打卡', page=23,
  figs=('crop1', [C('m-sign-scroll__02_我这个月的打卡.png')]),
  blocks=[('p', '这个月每天的打卡记录都在这儿，一行一天，写着：'),
          ('kv', '日期：', '哪天打的（如 09-27）。'),
          ('kv', '状态：', '正常 / 迟到 N 分钟 / 待核（教务会核对）。'),
          ('kv', '时间：', '打上的那一刻。'),
          ('kv', '方式：', '动态码 / 定位 / 直接 / 教务补签。'),
          ('g', 0.04),
          ('q', '这个月还没有打卡记录', 'info', '还没有时')])

S(kind='content', kicker='第三章 · 请假', title='怎么请假', page=24,
  figs=('crop1', [C('m-sign-scroll__03_请假.png')]),
  blocks=[('p', '请假就在打卡页最下面那块，和打卡在同一个页面。'),
          ('g', 0.02),
          ('s', 1, '选日期', '请哪天就选哪天。'),
          ('s', 2, '选类型', '病假，或者事假。'),
          ('s', 3, '写清楚原因', '例如「上午去医院复查，下午回校」。'),
          ('s', 4, '点「提交请假」', '提交后就等教务批。'),
          ('g', 0.03),
          ('q', '写一句原因再提交', 'warn', '原因没写'),
          ('q', '已提交，教务批准后会自动写进考勤', 'ok', '提交成功')])

S(kind='content', kicker='第三章 · 请假', title='我请过的假', page=25,
  figs=('crop1', [C('m-sign-scroll__04_我请过的假.png')]),
  blocks=[('p', '你提交过的请假都在这里，右边是当前状态。'),
          ('g', 0.03),
          ('kv', '待处理：', '教务还没批，等一等。'),
          ('kv', '已批准：', '批了 —— 会自动写进考勤，也会自动进量化。'),
          ('kv', '已驳回：', '没批。想知道为什么，可以问教务。'),
          ('g', 0.04),
          ('q', '还没有请过假', 'info', '还没请过时')])

# ── 第 4 章 ──
S(kind='divider', num=4, zh='第四章', title='每日新闻',
  desc='看最新新闻，开阔视野。')

S(kind='content', kicker='第四章 · 每日新闻', title='每日新闻怎么看', page=27,
  figs=('phone1', [P('m-news.png')]),
  blocks=[('p', '教务老师每天统一更新就可以了。'),
          ('h', '每条新闻'),
          ('li', '左边是发布时间，右边是标题。'),
          ('li', '标题下面有一句摘要，读一眼就知道讲了什么。'),
          ('li', '点标题、或者长按，可以打开原文。'),
          ('g', 0.02),
          ('h', '复制全文'),
          ('p', '右上角「复制全文」，一键把所有标题和摘要复制走，做练习、做素材都方便。'),
          ('g', 0.02),
          ('q', '还没有今天的新闻', 'info', '还没拉到当天新闻时'),
          ('n', '来源写得很清楚：央视新闻。')])

# ── 第 5 章 ──
S(kind='divider', num=5, zh='第五章', title='我的课表',
  desc='这一周，你都有什么课。')

S(kind='content', kicker='第五章 · 我的课表', title='我的课表怎么看', page=29,
  figs=('crop1', [C('m-table__01_课表.png')]),
  blocks=[('p', '课表按星期分组，一天一块，写着：'),
          ('li', '时间，和这是第几节。'),
          ('li', '课程名。'),
          ('li', '班级或教室。'),
          ('li', '右边标「大课」或「小课」。'),
          ('g', 0.03),
          ('h', '关于小课'),
          ('p', '小课（一对一那种）只显示你自己的，别人看不到。'),
          ('g', 0.03),
          ('q', '教务还没有给你排课', 'info', '还没排课时')])

# ── 第 6 章 ──
S(kind='divider', num=6, zh='第六章', title='考试与抽签',
  desc='什么时候考、考第几个、考了多少分。')

S(kind='content', kicker='第六章 · 考试与抽签', title='我的出场序号', page=31,
  figs=('crop1', [C('m-exam__01_我的出场序号.png')]),
  blocks=[('p', '教务抽签之后，这里会出现你的出场序号。'),
          ('p', '下面还写清楚：这次抽签叫什么、一共多少人、第几次抽签、谁抽的。'),
          ('g', 0.05),
          ('q', '教务还没有开抽。开抽后这里会出现你的出场序号。', 'info', '还没开抽时'),
          ('n', '抽签是教务在系统里一键开的，开完每个人都能看到自己的号。')])

S(kind='content', kicker='第六章 · 考试与抽签', title='我的模考成绩', page=32,
  figs=('crop1', [C('m-exam__02_我的模考成绩.png')]),
  blocks=[('p', '每场模考一行，写着：'),
          ('li', '场次名字和日期。'),
          ('li', '三科分数：朗读、播报、评述。'),
          ('li', '总分（满分 300）和等第。'),
          ('g', 0.03),
          ('h', '怎么看自己的强弱'),
          ('p', '哪一科分数低、等第靠后，哪一科就是要多练的。想看更细的平均和等第，去「我的档案」。'),
          ('g', 0.02),
          ('q', '还没有你的成绩', 'info', '还没有成绩时')])

# ── 第 7 章 ──
S(kind='divider', num=7, zh='第七章', title='本班量化',
  desc='班级整体多少分，你自己加减了多少。')

S(kind='content', kicker='第七章 · 本班量化', title='班级总分', page=34,
  figs=('crop1', [C('m-quant__01_班级总分.png')]),
  blocks=[('p', '最上面那个大数字，是你们班的总分（起始 100 分）。'),
          ('p', '下面一行「最近」，是最近几次的加减分，一眼能看到班级这两天的情况。'),
          ('g', 0.04),
          ('q', '这个班还没有加减分记录', 'info', '还没有记录时'),
          ('n', '总分是全班一起挣的，每个人都在里面。')])

S(kind='content', kicker='第七章 · 本班量化', title='我的加扣分', page=35,
  figs=('crop1', [C('m-quant__02_我的加扣分.png')]),
  blocks=[('p', '下面是你自己的加扣分：先是你一共加/扣了多少，再一项一项列清楚。'),
          ('kv', '出勤正常：', '每正常一次 +1。'),
          ('kv', '作业按时提交：', '每按时一次 +1。'),
          ('g', 0.03),
          ('h', '为什么要这么设计'),
          ('p', '你只看到「班级总分 + 你自己那几条」，不显示别人的名字，也不排名。这既是保护每个人的隐私，也少生是非。'),
          ('g', 0.02),
          ('q', '这段时间没有你的加扣分', 'info', '没有时')])

# ── 第 8 章 ──
S(kind='divider', num=8, zh='第八章', title='我的档案',
  desc='你的出勤、强弱、考勤明细和老师评语，都在这一页。')

S(kind='content', kicker='第八章 · 我的档案', title='六个指标 + 三科强弱', page=37,
  figs=('crop2', [C('m-profile__六项指标.png'), C('m-profile__三科强弱.png')]),
  blocks=[('h', '上面六个数（左图）'),
          ('li', '出勤率、迟到、病假、事假。'),
          ('li', '作业已交、作业未交。'),
          ('g', 0.02),
          ('h', '三科强弱（右图）'),
          ('p', '朗读、播报、评述三科的平均分和等第。'),
          ('p', '分数最低、等第靠后的那一科，就是你最该补的。'),
          ('g', 0.03),
          ('q', '请联系教务把你的账号关联到学员档案', 'warn', '如果账号还没关联')])

S(kind='content', kicker='第八章 · 我的档案', title='考勤明细 + 老师评语', page=38,
  figs=('crop2', [C('m-profile__考勤明细.png'), C('m-profile__老师评语.png')]),
  blocks=[('h', '考勤明细'),
          ('p', '一天一条，写着日期和当天的状态（正常 / 迟到 / 病假 / 事假）。'),
          ('g', 0.03),
          ('h', '老师评语'),
          ('p', '老师写给你的话都在这里，写着日期和是哪位老师写的。'),
          ('g', 0.03),
          ('q', '还没有考勤记录', 'info', '没有考勤时'),
          ('q', '老师还没有写评语', 'info', '没有评语时')])

# ── 第 9 章 ──
S(kind='divider', num=9, zh='第九章', title='我的作业',
  desc='布置了什么，你交了没有。')

S(kind='content', kicker='第九章 · 我的作业', title='我的作业怎么看', page=40,
  figs=('crop1', [C('m-hw__01_作业列表.png')]),
  blocks=[('p', '这个班的作业都在这儿，最新的在上面。一行一条：'),
          ('li', '左边是日期。'),
          ('li', '中间是作业内容。'),
          ('li', '右边是「已交」或「未交」。'),
          ('g', 0.04),
          ('q', '这个班还没有作业', 'info', '还没有作业时'),
          ('n', '看到「未交」，就赶紧补上 —— 它也连着量化分。')])

# ── 第 10 章 ──
S(kind='divider', num=10, zh='第十章', title='限时征集',
  desc='教务临时发起的填报，截止前交掉就行。')

S(kind='content', kicker='第十章 · 限时征集', title='限时征集怎么填', page=42,
  figs=('crop1', [C('m-gather__01_征集一.png')]),
  blocks=[('p', '教务有时会发一个「征集」让你填点东西，比如报节目、核对信息。'),
          ('g', 0.02),
          ('s', 1, '看标题和截止时间', '右上角写着截止到什么时候。'),
          ('s', 2, '一个个问题填', '标题下面有几个问题，一条条填。'),
          ('s', 3, '点「提交」', '提交后就变成「已完成」。'),
          ('g', 0.03),
          ('kv', '进行中：', '还没截止，可以填。'),
          ('kv', '已完成：', '你已经填过了，下面会回显你填的内容。'),
          ('kv', '已结束：', '截止了，不能填了。'),
          ('g', 0.01),
          ('q', '还有没填的', 'warn', '有题没填就提交'),
          ('q', '暂时没有要完成的征集', 'info', '没有征集时')])

# ── 第 11 章 ──
S(kind='divider', num=11, zh='第十一章', title='设置',
  desc='管账号、同步数据、加到手机桌面。')

S(kind='content', kicker='第十一章 · 设置', title='我的账号', page=44,
  figs=('crop1', [C('m-settings__01_我的账号.png')]),
  blocks=[('p', '上面写着你的名字、账号和角色，还能看到「上次同步」的时间。'),
          ('g', 0.02),
          ('h', '四个按钮'),
          ('kv', '立即同步：', '把本机记的东西立刻传上去。'),
          ('kv', '改密码：', '换成自己记得住的密码。'),
          ('kv', '切换账号：', '在这台设备上换个人用（要密钥）。'),
          ('kv', '退出登录：', '退出，这台设备上就看不清数据了。'),
          ('g', 0.02),
          ('n', '打开系统会自动同步一次，切回前台再自动一次 —— 平时不用手动点。')])

S(kind='content', kicker='第十一章 · 设置', title='加到手机桌面 & 危险操作', page=45,
  figs=('crop2', [C('m-settings__02_危险操作.png'), P('m-drawer.png')]),
  blocks=[('h', '加到手机桌面'),
          ('p', '在手机浏览器里点「分享 → 添加到主屏幕」，之后就是一个独立图标，打开更快，也不容易被系统清掉缓存。'),
          ('g', 0.03),
          ('h', '危险操作：清空所有数据'),
          ('p', '红色那个按钮会把本机数据全清掉，清了没法撤销。用之前一定先确认已经同步过。'),
          ('g', 0.02),
          ('q', '清空前请确认已经导出过备份，这个操作无法撤销。', 'stop', '注意')])

# ── 第 12 章 ──
S(kind='divider', num=12, zh='第十二章', title='常见问题',
  desc='系统所有会弹的话，都收在这一章，一条条对照。')

S(kind='content', kicker='第十二章 · 常见问题', title='登录与设备', page=47,
  blocks=[('q', '没有这个账号。请让教务老师在「学生管理」里创建。', 'warn', '登录说没这个账号'),
          ('p', '→ 说明教务还没给你建号，直接找教务。'),
          ('g', 0.03),
          ('q', '密码不对。', 'warn', '登录说密码不对'),
          ('p', '→ 检查大小写、有没有多打空格；还不行就找教务重置。'),
          ('g', 0.03),
          ('q', '连不上服务器（网络断了，或正在重新部署）。本地已记的东西都在，过一会儿刷新试试。', 'warn', '登录连不上'),
          ('p', '→ 换 Wi-Fi 或流量，过一会儿再试；已经记下的东西不会丢。'),
          ('g', 0.03),
          ('q', '这台设备还没登记 / 换账号要密钥', 'info', '换了手机或被挡在门外'),
          ('p', '→ 找教务要一次性密钥，填进去就能进。')])

S(kind='content', kicker='第十二章 · 常见问题', title='打卡相关', page=48,
  blocks=[('q', '输一下讲台上那个码', 'warn', '码没填'),
          ('p', '→ 把教务给的码填进「码」框，再按圈。'),
          ('g', 0.03),
          ('q', '取不到位置，直接输码也能打（会标需核对）', 'warn', '定位失败'),
          ('p', '→ 照样能打；教务会核对一下。也可以点「再试定位」。'),
          ('g', 0.03),
          ('q', '现在没网，已记下打卡时间 08:29，联网后自动提交（就按这个时间算迟到）', 'warn', '断网时打卡'),
          ('p', '→ 不用重打；有网了会自动补传，按你按下的时间算。'),
          ('g', 0.03),
          ('q', '已记录，等教务核对（这不算缺卡）', 'info', '显示「待核」'),
          ('p', '→ 这不是缺卡，等教务确认就好。')])

S(kind='content', kicker='第十二章 · 常见问题', title='其它常见情况', page=49,
  blocks=[('q', '写一句原因再提交', 'warn', '请假没写原因'),
          ('p', '→ 在框里写一句，比如「下午去医院复查」，再提交。'),
          ('g', 0.02),
          ('q', '已提交，教务批准后会自动写进考勤', 'ok', '请假提交成功'),
          ('p', '→ 等教务批；批了会自动进考勤，也会自动进量化。'),
          ('g', 0.02),
          ('q', '还有没填的', 'warn', '征集有题没填'),
          ('p', '→ 每个问题都要填，填完再提交。'),
          ('g', 0.02),
          ('q', '教务还没有开抽 / 还没有你的成绩 / 这个班还没有作业 / 这个月还没有打卡记录 / 今天没有排课 / 还没有通知',
           'info', '看到这些空状态'),
          ('p', '→ 这些都不是出错，只是还没到时候；到点了自然会出现。')])

S(kind='closing', page=50)

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
            R(ops, x, y, 0.055, ch, fill=GOLD)
            T(ops, x + 0.28, y + 0.11, 0.75, n, size=18, color=GOLD_D, bold=True, lh=1.1)
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
                box = s.shapes.add_textbox(Inches(o['x']), Inches(o['y']),
                                           Inches(o['w'] + 0.06), Inches(o['h'] + 0.06))
                tf = box.text_frame; tf.word_wrap = True
                tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
                al = {'l': PP_ALIGN.LEFT, 'c': PP_ALIGN.CENTER, 'r': PP_ALIGN.RIGHT}[o['align']]
                for i, ln in enumerate(o['lines']):
                    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                    p.alignment = al
                    p.line_spacing = o['lh']
                    r = p.add_run(); r.text = ln
                    f = r.font
                    f.size = Pt(o['size']); f.bold = o['bold']
                    f.color.rgb = RGBColor.from_string(o['color']); f.name = FONT
                    rPr = r._r.get_or_add_rPr()
                    for tag in ('a:ea', 'a:cs'):
                        el = rPr.find(qn(tag))
                        if el is None:
                            el = rPr.makeelement(qn(tag), {}); rPr.append(el)
                        el.set('typeface', FONT)
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

if __name__ == '__main__':
    all_ops = [build_ops(sl) for sl in SLIDES_FINAL]
    n = emit_pptx(all_ops, PPTX_OUT)
    print('✅ PPTX 已生成（%d 页）-> %s' % (n, PPTX_OUT))
    for i, ops in enumerate(all_ops, 1):
        emit_png(ops, os.path.join(QCDIR, 'p%02d.png' % i))
    print('✅ QC 图 %d 张 -> %s' % (len(all_ops), QCDIR))
    # 溢出检查（忽略页脚，页脚 y≈7.1）
    for i, ops in enumerate(all_ops, 1):
        mx = max((o['y'] + o['h'] for o in ops if o['t'] != 'r' and o['y'] < 7.0), default=0)
        if mx > 6.95:
            print('  ⚠️ 第 %d 页内容触底 y=%.2f' % (i, mx))
