import os
from PIL import Image, ImageDraw, ImageFont

BASE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/预览"
srcs = [
    ("朱砂红玉璧", "国风_v7_朱砂红玉璧.png"),
    ("石青青花", "国风_v7_石青青花.png"),
    ("墨金印章", "国风_v7_墨金印章.png"),
    ("黛青印", "国风_v7_黛青印.png"),
]
CUT = 0.085
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"


def clean(im):
    w, h = im.size
    return im.crop((int(w * CUT), int(h * CUT), int(w * (1 - CUT)), int(h * (1 - CUT))))


def rounded(im, r):
    s = im.size[0]
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(m)
    return out


font = ImageFont.truetype(FONT, 22, index=0)
cleaned = []
for name, fn in srcs:
    c = clean(Image.open(os.path.join(BASE, fn)).convert('RGB'))
    cleaned.append((name, c))

# 2×2 总览
cell, pad, label_h = 360, 30, 42
cols, rows = 2, 2
W = cols * cell + (cols + 1) * pad
H = rows * cell + (rows + 1) * pad + label_h
cv = Image.new('RGB', (W, H), (242, 236, 221))
d = ImageDraw.Draw(cv)
for i, (name, c) in enumerate(cleaned):
    r, cI = divmod(i, cols)
    x = pad + cI * (cell + pad)
    y = pad + r * (cell + pad)
    cv.paste(c.resize((cell, cell), Image.LANCZOS), (x, y))
    d.text((x, y + cell + 8), name, fill=(60, 50, 40), font=font)
cv.save(os.path.join(BASE, "国风_v7_总览.png"))

# 真机尺寸验证
sm, gap = 120, 44
sb_w = len(cleaned) * sm + (len(cleaned) + 1) * gap
sb_h = sm + 30 + 26
sb = Image.new('RGB', (sb_w, sb_h), (242, 236, 221))
dd = ImageDraw.Draw(sb)
for i, (name, c) in enumerate(cleaned):
    x = gap + i * (sm + gap)
    small = c.resize((sm, sm), Image.LANCZOS)
    r = rounded(small, int(sm * 0.22))
    sb.paste(r, (x, 0), r)
    dd.text((x + sm // 2 - 12, sm + 8), name[:2], fill=(60, 50, 40), font=font)
    tiny = c.resize((56, 56), Image.LANCZOS)
    rt = rounded(tiny, int(56 * 0.22))
    sb.paste(rt, (x + sm - 56, sm + 8 + 14), rt)
sb.save(os.path.join(BASE, "国风_v7_真机.png"))
print("done", [n for n, _ in srcs])
