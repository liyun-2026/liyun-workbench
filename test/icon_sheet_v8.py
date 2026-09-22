import os
from PIL import Image, ImageDraw, ImageFont

BASE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/预览"
srcs = [
    ("A 墨玉 · 宣纸", "宣纸墨玉", "Flat_2D_mobile_app_icon__squar_2026-09-21T15-00-49.png"),
    ("B 沉墨 · 月白", "沉墨月白", "Flat_2D_mobile_app_icon__squar_2026-09-21T15-01-15.png"),
    ("C 古铜 · 暖白", "古铜暖白", "Flat_2D_mobile_app_icon__squar_2026-09-21T15-01-38.png"),
    ("D 朱砂 · 宣纸", "朱砂宣纸", "Flat_2D_mobile_app_icon__squar_2026-09-21T15-01-57.png"),
]
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"


def dewatermark(im):
    """右下角有 AI 生成水印，位于圆盘之外的背景区；用采样到的背景色填掉，不动圆盘。"""
    im = im.convert('RGB')
    w, h = im.size
    px = list(im.crop((6, 6, 26, 26)).getdata())
    bg = tuple(sum(c[i] for c in px) // len(px) for i in range(3))
    ImageDraw.Draw(im).rectangle([int(w * 0.83), int(h * 0.87), w, h], fill=bg)
    return im


def rounded(im, r):
    s = im.size[0]
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(m)
    return out


font = ImageFont.truetype(FONT, 22, index=0)
font2 = ImageFont.truetype(FONT, 20, index=0)
cleaned = []
for name, short, fn in srcs:
    c = dewatermark(Image.open(os.path.join(BASE, fn)))
    c.save(os.path.join(BASE, "砺蕴图标_v8_" + short + ".png"))
    cleaned.append((name, short, c))

# 2×2 总览
cell, pad, label_h = 380, 34, 44
cols, rows = 2, 2
W = cols * cell + (cols + 1) * pad
H = rows * (cell + label_h) + (rows + 1) * pad
cv = Image.new('RGB', (W, H), (242, 236, 221))
d = ImageDraw.Draw(cv)
for i, (name, short, c) in enumerate(cleaned):
    r, cI = divmod(i, cols)
    x = pad + cI * (cell + pad)
    y = pad + r * (cell + label_h + pad)
    cv.paste(c.resize((cell, cell), Image.LANCZOS), (x, y))
    d.text((x, y + cell + 10), name, fill=(60, 50, 40), font=font)
cv.save(os.path.join(BASE, "砺蕴图标_v8_总览.png"))

# 真机尺寸验证（120 圆角方 + 56 小图）
sm, gap = 150, 46
sb_w = len(cleaned) * sm + (len(cleaned) + 1) * gap
sb_h = sm + 30 + 30 + 40
sb = Image.new('RGB', (sb_w, sb_h), (242, 236, 221))
dd = ImageDraw.Draw(sb)
for i, (name, short, c) in enumerate(cleaned):
    x = gap + i * (sm + gap)
    small = c.resize((sm, sm), Image.LANCZOS)
    rr = rounded(small, int(sm * 0.22))
    sb.paste(rr, (x, 0), rr)
    tiny = c.resize((56, 56), Image.LANCZOS)
    rt = rounded(tiny, int(56 * 0.22))
    sb.paste(rt, (x + sm - 56, sm + 6), rt)
    dd.text((x + 6, sm + 34), name, fill=(60, 50, 40), font=font2)
sb.save(os.path.join(BASE, "砺蕴图标_v8_真机.png"))
print("done", [n for n, _, _ in cleaned])
