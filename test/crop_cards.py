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
  # 打卡页：卡里有个大色圈，自动找白卡会把它切断，所以一律手工定框。
  # 顶部统一 y=212（打卡卡的顶边在 228，留一点边），底边按内容长度各给一档。
  'm-sign-step1.png':  [('扫码路口',   26, 212, 814, 1042)],
  'm-sign-manual.png': [('手输动态码', 26, 212, 814, 1038)],
  # 定位失败那一页 v47 多长出一块「位置密钥」输入框（keyBox 见 _geo.fail），
  # 底边从 1022 放到 1390 才框得住；框不住的话手册上就写着「填进框里」
  # 而图里根本没有那个框。
  'm-sign-geofail.png':[('定位失败',   26, 212, 814, 1390)],
  # v48 起打卡圈下面不再挂「重新打卡」按钮，卡片一下短了一截（底边 1096 → 870）
  'm-sign-done.png':   [('已打卡',     26, 212, 814, 870)],
  'm-sign-late.png':   [('迟到',       26, 212, 814, 870)],
  # v47 新页：给老师发消息（发一条消息 卡）
  'm-msg.png':         [('发一条消息', 26, 220, 814, 892)],
  # v47 新页：班干部视角（这两张卡片是竖长的名单；底边切在 1700，
  # 再往下就把底部那条 tabbar 带进来了）
  'm-quant-officer.png':[('全班加扣分', 26, 455, 814, 1700)],
  'm-hw-entry.png':    [('登记今晚作业', 26, 218, 814, 1700)],
  # 扫一扫取景窗：整块深色区，白卡检测完全找不到。
  # 上边界取到 888，是为了把上面那排按钮整行留全（从 936 起会把按钮切一半）。
  'm-sign-scan.png':   [('取景窗',     26, 888, 814, 1652)],
  # 底部弹出的「全部功能」抽屉：从底边一直抽到 ~1810，整个面板一次裁出来
  'm-drawer.png':      [('全部功能',    0, 1268, 840, 1815)],
  # 教务办公室那块展示板（1600x900）—— 整屏 + 中栏拆三块 + 左右栏各一块
  'board.png': [
      ('整屏',           0,    0, 1600,  900),
      ('中栏打卡码',   545,   95, 1055,  884),
      ('二维码',       565,  140, 1035,  540),
      ('数字码倒计时', 540,  540, 1060,  726),
      ('应到实到',     540,  720, 1060,  884),
      ('左栏今日课表',   0,   58,  330,  215),
      ('右栏班级量化', 1070,  58, 1300,  212),
      ('右栏还没到',   1070,  200, 1300,  305),
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
