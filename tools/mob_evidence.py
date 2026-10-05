#!/usr/bin/env python3
"""手机端体检：把「问题现场」逐处裁出来 + 配一句说明，拼成一张可读的证据图。
   用法: python3 tools/mob_evidence.py
   出图: test/.shots/mobile/_evidence/手机端体检.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOB = os.path.join(ROOT, 'test', '.shots', 'mobile')
OUT = os.path.join(MOB, '_evidence')
os.makedirs(OUT, exist_ok=True)

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
S = 4          # 切片是 4 倍图（dsf2 × clip scale2）


def font(sz):
    for p in (FONT, '/System/Library/Fonts/Supplemental/Songti.ttc'):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()


# (标题, 切片文件, y0, y1, 说明)   y 是切片内的像素坐标（4 倍图）
# tile 写 '连排:03,04,05,06,07,08' 就是把这几屏并排拼成一条，用来看「一连多少屏都是它」
ITEMS = [
    ('① 今日 · 倒计时卡', '390_home_light/01.png', 380, 1230,
     '桌面的三栏英雄区原样搬到手机上：三块挤在同一行 ——「距统考 · 目标日」被顶到上面居中，'
     '「--  天 / 设定倒数天数」卡在左边，「今日课节已结束」甩到右边。主次读不出来，还白占 180px 高。'),
    ('② 今日 · 要闻墙（最严重）', '连排:03,04,05,06,07,08', 0, 0,
     '下面是今日页连续 6 屏的实拍 —— 屏屏都是新闻。央视接口一次返回 80 条，'
     '代码里一条不落地全渲染出来、还是单列：今日页因此在手机上是 18 屏 / 12900px，'
     '真正要看的时间轴和考勤被埋在头一屏。桌面同样有此问题，只是没人往下滚。'),
    ('③ 考勤 · 本节小结', '390_att_light/01.png', 640, 1760,
     '一段 4 行的说明文字占了近半屏，手机上全是在讲「一键全部正常只会改这个时段」这类桌面才需要的解释。'
     '上面那行筛选（日期 + 班级 + 时段）也占了两行。'),
    ('④ 考勤 · 状态列', '390_att_light/01.png', 1790, 2950,
     '桌面是 4 列（序号 / 姓名 / 时段 / 状态），手机上时段列被隐藏、只剩 3 列。'
     '状态只能点印章一个个轮：正常→迟到→病假→事假，想标「事假」最多要点 4 下。'
     '20 个学生就要点几十下 —— 这就是您说的「一个一个选很耽搁时间」。'),
    ('⑤ 名册 / 作业 · 页头文案', '390_roster_light/01.png', 0, 300,
     '页头说明是写给桌面的：「左选班 → 右看人」「建号与周末班收进右栏『更多』」。'
     '作业页同样：「左『今日检查』逐人勾选 · 右『布置作业』发给多个班」。手机上根本没有左右两栏。'),
    ('⑥ 课表 · 大课表', '390_timetable_light/03.png', 1850, 2700,
     '表格最小宽 660px、单元格最小 124px × 8 列 ≈ 992px。手机上右半边被切掉，'
     '底部只有一条很细的横向滚动条，看不出「可以左右滑」，最后一天的课等于看不见。'),
]

PAD, GAP, CAP_H, W = 26, 30, 116, 1240
f_cap = font(30)


def build_block(rel, y0, y1):
    """返回一张已经缩到 W 宽的图。rel 支持 '连排:a,b,c'。"""
    if rel.startswith('连排:'):
        names = rel.split(':', 1)[1].split(',')
        ims = [Image.open(os.path.join(MOB, '_tiles', '390_home_light', n + '.png')).convert('RGB')
               for n in names]
        cw = W // len(ims)
        ch = int(ims[0].size[1] * cw / ims[0].size[0])
        strip = Image.new('RGB', (cw * len(ims), ch), (240, 238, 234))
        for i, im in enumerate(ims):
            strip.paste(im.resize((cw, ch), Image.LANCZOS), (i * cw, 0))
        return strip
    im = Image.open(os.path.join(MOB, '_tiles', rel)).convert('RGB')
    crop = im.crop((0, y0, im.size[0], min(y1, im.size[1])))
    h = max(1, int(crop.size[1] * W / crop.size[0]))
    return crop.resize((W, h), Image.LANCZOS)


def wrap(draw, text, f, maxw):
    lines, cur = [], ''
    for ch in text:
        if ch == '\n':
            lines.append(cur); cur = ''; continue
        if draw.textlength(cur + ch, font=f) > maxw:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


total_h = PAD
blocks = []
for title, rel, y0, y1, desc in ITEMS:
    crop = build_block(rel, y0, y1)
    blocks.append((title, crop, desc))
    total_h += CAP_H + crop.size[1] + GAP

sheet = Image.new('RGB', (W + PAD * 2, total_h + PAD), (247, 245, 240))
d = ImageDraw.Draw(sheet)
y = PAD
for title, crop, desc in blocks:
    d.text((PAD, y), title, font=font(40), fill=(30, 28, 24))
    ty = y + 52
    for ln in wrap(d, desc, f_cap, W) [:3]:
        d.text((PAD, ty), ln, font=f_cap, fill=(112, 104, 92))
        ty += 34
    y += CAP_H
    sheet.paste(crop, (PAD, y))
    d.rectangle([PAD - 1, y - 1, PAD + W, y + crop.size[1]], outline=(206, 200, 190))
    y += crop.size[1] + GAP

out = os.path.join(OUT, '手机端体检.png')
sheet.save(out)
print(f'{out}\n  {sheet.size[0]}×{sheet.size[1]}')
