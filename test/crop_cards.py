"""
从学生端手机截图里自动切出「卡片」局部图，给每个子功能配一张放大的图。
  python test/crop_cards.py
输出：test/.shots/stutut/crops/<页面>_<序号>.png，并打印每张卡片的 y 区间便于命名。
"""
import os, numpy as np
from PIL import Image

SRC = os.path.join(os.path.dirname(__file__), '.shots', 'stutut')
OUT = os.path.join(SRC, 'crops')
os.makedirs(OUT, exist_ok=True)

XPAD = 26          # 左右留白裁剪
MIN_H = 90         # 太矮的条不算卡片
GAP = 6            # 允许的白带中断

PAGES = {
  'm-home.png': ['打卡', '教务通知', '今天上什么课', '今日作业'],
  'm-home-scroll.png': ['打卡尾', '教务通知', '今天上什么课', '今日作业'],
  'm-sign.png': ['打卡', '我这个月的打卡', '请假', '我请过的假'],
  'm-sign-scroll.png': ['打卡尾', '我这个月的打卡', '请假', '我请过的假'],
  'm-exam.png': ['我的出场序号', '我的模考成绩'],
  'm-quant.png': ['班级总分', '我的加扣分'],
  'm-settings.png': ['我的账号', '危险操作'],
  'm-gather.png': ['征集一', '征集二'],
  'm-hw.png': ['作业列表'],
  'm-table.png': ['课表'],
  'm-news.png': ['新闻列表'],
}

# 自动检测不到的，手工定框（左,上,右,下 像素）
MANUAL = {
  'm-profile.png': [
      ('六项指标', 26, 224, 814, 690),
      ('三科强弱', 26, 690, 814, 1170),
      ('考勤明细', 26, 1170, 814, 1460),
      ('老师评语', 26, 1450, 814, 1700),
  ],
}


def bands(im):
    a = np.array(im.convert('RGB')).astype(np.int16)
    h, w, _ = a.shape
    core = a[:, XPAD: w - XPAD]
    # 一行是不是「白卡」：核心区域中位数接近纯白，且不是深色 tabbar
    med = np.median(core.reshape(h, -1, 3).mean(axis=2), axis=1)
    white = med > 250
    out, y = [], 0
    while y < h:
        if white[y]:
            y0 = y
            gap = 0
            while y < h and (white[y] or gap < GAP):
                gap = gap + 1 if not white[y] else 0
                y += 1
            y1 = y - gap
            if y1 - y0 >= MIN_H:
                out.append((y0, y1))
        else:
            y += 1
    return out, w

for f, names in PAGES.items():
    p = os.path.join(SRC, f)
    if not os.path.exists(p):
        print('缺文件', f); continue
    im = Image.open(p)
    bs, w = bands(im)
    print(f'\n{f}  ({w}x{im.size[1]})  找到 {len(bs)} 条卡带')
    for i, (y0, y1) in enumerate(bs):
        y0 = max(0, y0 - 4); y1 = min(im.size[1], y1 + 4)
        crop = im.crop((XPAD, y0, w - XPAD, y1))
        nm = names[i] if i < len(names) else f'card{i+1}'
        base = os.path.splitext(f)[0]
        dst = os.path.join(OUT, f'{base}__{i+1:02d}_{nm}.png')
        crop.save(dst)
        print(f'   [{i+1}] y {y0:>4}-{y1:>4} (h={y1-y0:>4}) -> {os.path.basename(dst)}')

print('\n✅ 裁切完成 ->', OUT)

for f, items in MANUAL.items():
    p = os.path.join(SRC, f)
    if not os.path.exists(p): continue
    im = Image.open(p); base = os.path.splitext(f)[0]
    for nm, x0, y0, x1, y1 in items:
        crop = im.crop((x0, y0, x1, y1))
        dst = os.path.join(OUT, f'{base}__{nm}.png')
        crop.save(dst)
        print(f'   手工 {nm}: y {y0}-{y1} -> {os.path.basename(dst)}')
print('✅ 手工裁切完成')
