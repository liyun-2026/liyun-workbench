import os
from PIL import Image, ImageDraw, ImageFont

BASE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/预览"
# (显示名, 输出短名, 源文件名)
srcs = [
    ("1 声纹扩散", "1_声纹扩散", "v9_1_声纹扩散.png"),
    ("2 声纹环", "2_声纹环", "v9_4_声纹环.png"),
    ("3 均衡器标签", "3_均衡器标签", "v9_A2_均衡器标签.png"),
    ("4 声波横贯", "4_声波横贯", "v9_7_正弦横贯.png"),
    ("5 唱针·磨", "5_唱针", "v9_A3_唱针.png"),
    ("6 局部唱盘", "6_局部唱盘", "v9_A9_局部唱盘.png"),
    ("7 古铜·沉墨", "7_古铜沉墨", "v9_6_古铜沉墨.png"),
    ("8 青花", "8_青花", "v9_A5_青花.png"),
]
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"


def bg_sample(im):
    """取整图边缘像素的中位色作为背景色（图标内容居中，四周留白）。"""
    w, h = im.size
    px = []
    step = max(1, w // 80)
    for x in range(0, w, step):
        px.append(im.getpixel((x, 0)))
        px.append(im.getpixel((x, h - 1)))
    for y in range(0, h, step):
        px.append(im.getpixel((0, y)))
        px.append(im.getpixel((w - 1, y)))
    px.sort(key=lambda c: c[0] + c[1] + c[2])
    return px[len(px) // 2]


def dewatermark(im):
    """右下角 AI 水印在内容之外的背景区。

    背景可能带渐变，纯色填充会露出方块，所以取水印区**正上方 6px 的窄条**
    沿纵向拉伸后贴回去 —— 渐变可无缝续上。
    """
    im = im.convert('RGB')
    w, h = im.size
    x0, y0 = int(w * 0.78), int(h * 0.85)
    strip = im.crop((x0, y0 - 6, w, y0))
    im.paste(strip.resize((w - x0, h - y0), Image.LANCZOS), (x0, y0))
    return im


def rounded(im, r):
    s = im.size[0]
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(m)
    return out


font = ImageFont.truetype(FONT, 26, index=0)
font2 = ImageFont.truetype(FONT, 20, index=0)

cleaned = []
for name, short, fn in srcs:
    p = os.path.join(BASE, fn)
    c = dewatermark(Image.open(p))
    c.save(os.path.join(BASE, "砺蕴图标_v9_" + short + ".png"))
    cleaned.append((name, short, c))

# 总览：4 列 × 2 行
cell, pad, label_h = 360, 32, 46
cols, rows = 4, 2
W = cols * cell + (cols + 1) * pad
H = rows * (cell + label_h) + (rows + 1) * pad
cv = Image.new('RGB', (W, H), (242, 236, 221))
d = ImageDraw.Draw(cv)
for i, (name, short, c) in enumerate(cleaned):
    r, cI = divmod(i, cols)
    x = pad + cI * (cell + pad)
    y = pad + r * (cell + label_h + pad)
    cv.paste(c.resize((cell, cell), Image.LANCZOS), (x, y))
    d.text((x, y + cell + 12), name, fill=(60, 50, 40), font=font)
cv.save(os.path.join(BASE, "砺蕴图标_v9_总览.png"))

# 真机尺寸：120 圆角方 + 56 小图
sm, gap = 150, 42
sb_w = len(cleaned) * sm + (len(cleaned) + 1) * gap
sb_h = sm + 76
sb = Image.new('RGB', (sb_w, sb_h), (242, 236, 221))
dd = ImageDraw.Draw(sb)
for i, (name, short, c) in enumerate(cleaned):
    x = gap + i * (sm + gap)
    small = c.resize((sm, sm), Image.LANCZOS)
    rr = rounded(small, int(sm * 0.22))
    sb.paste(rr, (x, 8), rr)
    tiny = c.resize((56, 56), Image.LANCZOS)
    rt = rounded(tiny, int(56 * 0.22))
    sb.paste(rt, (x + sm - 56, sm - 40), rt)
    dd.text((x + 4, sm + 24), name, fill=(60, 50, 40), font=font2)
sb.save(os.path.join(BASE, "砺蕴图标_v9_真机.png"))

print("done")
for name, short, _ in cleaned:
    print("  ", name, "->", "砺蕴图标_v9_" + short + ".png")
