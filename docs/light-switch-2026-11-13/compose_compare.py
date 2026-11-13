# 5.35 全端口浅色化 · 13 页改版前后对比图（旧深色 vs 新浅色）
# 用法：node 拼 13 页（PIL），输出 docs/light-switch-2026-11-13/对比图/
import os
from PIL import Image, ImageDraw, ImageFont

DIR = os.path.dirname(os.path.abspath(__file__))
BEFORE = os.path.join(DIR, 'before')
AFTER = os.path.join(DIR, 'after')
OUT = os.path.join(DIR, '对比图')
os.makedirs(OUT, exist_ok=True)

# 13 页（三身份核心页）
PAGES = [
    ('m-A-home.png',      '教务首页'),
    ('m-A-att.png',       '考勤管理'),
    ('m-A-sign.png',      '打卡管理'),
    ('m-A-homework.png',  '作业管理'),
    ('m-A-timetable.png', '课表'),
    ('m-A-settings.png',  '设置（教务）'),
    ('m-T-today.png',     '老师·今日'),
    ('m-T-myclass.png',   '老师·我带的班'),
    ('m-T-tickets.png',   '老师·上报与申请'),
    ('m-S-stuHome.png',   '学生首页'),
    ('m-S-stuSign.png',   '学生·打卡'),
    ('m-S-stuHw.png',     '学生·我的作业'),
    ('m-S-stuTable.png',  '学生·我的课表'),
]

W = 390 * 2          # @2x 图原宽 780
PAD = 24
HEAD = 64
COLW = 720           # 每列缩放宽
try:
    FONT = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', 26)
    FONT_S = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', 22)
except Exception:
    FONT = FONT_S = ImageFont.load_default()

rows = []
for fn, name in PAGES:
    pb = os.path.join(BEFORE, fn); pa = os.path.join(AFTER, fn)
    if not (os.path.exists(pb) and os.path.exists(pa)):
        print('缺图跳过:', fn); continue
    ib = Image.open(pb).convert('RGB'); ia = Image.open(pa).convert('RGB')
    def scale(im):
        h = round(im.height * COLW / im.width)
        return im.resize((COLW, h), Image.LANCZOS)
    rows.append((name, scale(ib), scale(ia)))

# 每页一张对比图（左旧深色/右新浅色），再拼一张总览
for name, ib, ia in rows:
    H = max(ib.height, ia.height)
    canvas = Image.new('RGB', (COLW*2 + PAD*3, H + HEAD + PAD*2), '#efece6')
    d = ImageDraw.Draw(canvas)
    d.text((PAD, 18), f'{name} · 左：改版前（深色） / 右：改版后（浅色）', fill='#2a2a2a', font=FONT)
    canvas.paste(ib, (PAD, HEAD))
    canvas.paste(ia, (COLW + PAD*2, HEAD))
    fn_out = f'{name.replace("·", "-")}.png'
    canvas.save(os.path.join(OUT, fn_out))
    print('已出', fn_out)

# 总览：每页一行两列缩略（高 560）
TH = 560
THW = round(TH * COLW / COLW * 390 / 390 * 2 / 2)  # =390*2? 直接算
THW = round(COLW * TH / max(r[1].height for r in rows))
rowh = TH + 54
canvas = Image.new('RGB', (COLW*2 + PAD*3, rowh*len(rows) + HEAD + PAD), '#efece6')
d = ImageDraw.Draw(canvas)
d.text((PAD, 18), '砺蕴教务系统 · VoxOS 5.35 全端口浅色化 · 手机 13 页改版前后（左旧深色 / 右新浅色）', fill='#2a2a2a', font=FONT)
y = HEAD
for name, ib, ia in rows:
    def th(im):
        h = TH
        w = round(im.width * h / im.height)
        return im.resize((w, h), Image.LANCZOS)
    tb, ta = th(ib), th(ia)
    d.text((PAD, y + 8), name, fill='#57544c', font=FONT_S)
    canvas.paste(tb, (PAD, y + 44))
    canvas.paste(ta, (COLW + PAD*2, y + 44))
    y += rowh
canvas.save(os.path.join(OUT, '总览-13页对比.png'))
print('已出 总览-13页对比.png ·', f'{len(rows)} 页')
