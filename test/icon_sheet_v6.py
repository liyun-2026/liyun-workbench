import os
from PIL import Image, ImageDraw, ImageFont

BASE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/预览"
srcs = [
    ("C1 绸缎浪·规整环", "Flat_2D_mobile_app_icon__squar_2026-09-20T14-07-14.png"),
    ("C2 声波律动环·绸缎浪", "Flat_2D_mobile_app_icon__squar_2026-09-20T14-07-41.png"),
    ("C3 波动环·绸缎浪", "Flat_2D_mobile_app_icon__squar_2026-09-20T14-07-12.png"),
    ("C4 绸缎浪·回声重影", "Flat_2D_mobile_app_icon__squar_2026-09-20T14-07-13.png"),
]
CUT = 0.085  # 裁四边去 AI 水印
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
    im = Image.open(os.path.join(BASE, fn)).convert('RGB')
    c = clean(im)
    cleaned.append((name, c))
    c.save(os.path.join(BASE, f"图标_v6_{name.split()[0]}.png"))

# ── 2×2 总览 ──
cell, pad, label_h = 360, 30, 42
cols, rows = 2, 2
W = cols * cell + (cols + 1) * pad
H = rows * cell + (rows + 1) * pad + label_h
cv = Image.new('RGB', (W, H), (246, 245, 242))
d = ImageDraw.Draw(cv)
for i, (name, c) in enumerate(cleaned):
    r, cI = divmod(i, cols)
    x = pad + cI * (cell + pad)
    y = pad + r * (cell + pad)
    cv.paste(c.resize((cell, cell), Image.LANCZOS), (x, y))
    d.text((x, y + cell + 8), name, fill=(60, 56, 48), font=font)
cv.save(os.path.join(BASE, "图标_v6_总览.png"))

# ── 真机尺寸验证（圆角方 120 + 56）──
sm, gap = 120, 44
sb_w = len(cleaned) * sm + (len(cleaned) + 1) * gap
sb_h = sm + 30 + 26
sb = Image.new('RGB', (sb_w, sb_h), (246, 245, 242))
dd = ImageDraw.Draw(sb)
for i, (name, c) in enumerate(cleaned):
    x = gap + i * (sm + gap)
    small = c.resize((sm, sm), Image.LANCZOS)
    r = rounded(small, int(sm * 0.22))
    sb.paste(r, (x, 0), r)
    dd.text((x + sm // 2 - 12, sm + 8), name.split()[0], fill=(60, 56, 48), font=font)
    # 56px 小尺寸
    tiny = c.resize((56, 56), Image.LANCZOS)
    rt = rounded(tiny, int(56 * 0.22))
    sb.paste(rt, (x + sm - 56, sm + 8 + 14), rt)
sb.save(os.path.join(BASE, "图标_v6_真机.png"))
print("done", [n for n, _ in srcs])
