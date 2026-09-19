#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""品牌素材处理：把砺蕴字标与圆盘图标转成多种配色与透明版本。
用法：python3 test/make_brand.py <输出目录>
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

GOLD = (201, 171, 124)      # 古铜金 #C9AB7C
LIGHT = (246, 245, 242)     # 暖灰米白 #F6F5F2
INK = (30, 28, 24)          # 深墨 #1E1C18

ENGINE = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/brand"
os.makedirs(OUT, exist_ok=True)


def recolor(src, dst, color, keep_alpha=True, scale=None, trim=True):
    """把源图的前景整体换成目标色，保留 alpha（用于透明底字标）。
    trim=True 时裁掉四周透明空白，让笔画充满画布。"""
    im = Image.open(src).convert("RGBA")
    if scale:
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    a = np.array(im)
    alpha = a[:, :, 3].astype(np.float32)
    if alpha.max() == 0:
        raise SystemExit("源图无 alpha：%s" % src)
    # 用原 alpha 做遮罩：有笔迹的地方上色，边缘保留抗锯齿
    out = np.zeros_like(a)
    out[:, :, 0], out[:, :, 1], out[:, :, 2] = color
    out[:, :, 3] = alpha
    img = Image.fromarray(out)

    if trim:
        m = alpha > 8
        ys, xs = np.where(m)
        img = img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))

    img.save(dst)
    print("  %-30s %dx%d  比例 %.2f" % (os.path.basename(dst), img.width, img.height, img.width / img.height))


def make_disc(src, dst, gold=GOLD, dark=INK, threshold=96, size=1024, trim=True):
    """把深底金盘图转成透明底：亮的（圆盘）保留并统一配色，暗的（底+负空间竖条）透明。
    trim=True 时裁掉四周透明空白，让圆盘充满画布，避免在版面里显得偏小。"""
    im = Image.open(src).convert("RGB")
    if size and im.width != size:
        im = im.resize((size, size), Image.LANCZOS)
    a = np.array(im).astype(np.float32)
    lum = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    mask = lum > threshold
    out = np.zeros((a.shape[0], a.shape[1], 4), dtype=np.uint8)
    out[:, :, 0], out[:, :, 1], out[:, :, 2] = gold
    out[:, :, 3] = np.where(mask, 255, 0).astype(np.uint8)
    img = Image.fromarray(out)

    if trim:
        ys, xs = np.where(mask)
        top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        side = max(bottom - top, right - left)
        cy, cx = (top + bottom) // 2, (left + right) // 2
        box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
        img = img.crop(box)

    r, g, b, al = img.split()
    al = al.filter(ImageFilter.GaussianBlur(0.6))
    img = Image.merge("RGBA", (r, g, b, al))
    img.save(dst)
    print("  %-30s %dx%d  圆盘占画布 %.1f%%" % (os.path.basename(dst), img.width, img.height,
                                          (np.array(img)[:, :, 3] > 128).mean() * 100))


def blur_copy(src, dst, radius=18, size=None):
    im = Image.open(src).convert("RGBA")
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    im.filter(ImageFilter.GaussianBlur(radius)).save(dst)
    print("  %-30s %dx%d  模糊半径 %d" % (os.path.basename(dst), im.width, im.height, radius))


print("== 砺蕴字标（行书）==")
SCRIPT = os.path.join(ENGINE, "assets", "logo-liyun.png")
recolor(SCRIPT, os.path.join(OUT, "liyun_script_gold.png"), GOLD)
recolor(SCRIPT, os.path.join(OUT, "liyun_script_light.png"), LIGHT)
recolor(SCRIPT, os.path.join(OUT, "liyun_script_ink.png"), INK)

print("== 砺蕴圆盘（磨石·破石出声）==")
ICON = os.path.join(ENGINE, "icon.png")
make_disc(ICON, os.path.join(OUT, "liyun_disc_gold.png"), gold=GOLD, threshold=96)
make_disc(ICON, os.path.join(OUT, "liyun_disc_light.png"), gold=LIGHT, threshold=96)

def make_badge(src, dst, size=1024, blur=0, inset=1.0):
    """方形 logo -> 圆形徽章（圆外透明）。inset<1 时把源图按比例缩小，
    保证原图自带的圆形边界被完整包住，不出现切边。"""
    im = Image.open(src).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * inset)
    disp = im.resize((inner, inner), Image.LANCZOS)
    canvas.paste(disp, ((size - inner) // 2, (size - inner) // 2), disp)

    # 圆形遮罩
    m = Image.new("L", (size * 4, size * 4), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(m).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    m = m.resize((size, size), Image.LANCZOS)
    canvas.putalpha(Image.composite(canvas.getchannel("A"), Image.new("L", (size, size), 0), m))

    if blur:
        canvas = canvas.filter(ImageFilter.GaussianBlur(blur))
    canvas.save(dst)
    print("  %-30s %dx%d%s" % (os.path.basename(dst), size, size, "  模糊 %d" % blur if blur else ""))


print("== 博艺徽章 ==")
BOYI = "/Users/xielihui/Desktop/博艺/WechatIMG2160.jpg"
make_badge(BOYI, os.path.join(OUT, "boyi_badge_1024.png"), size=1024)
make_badge(BOYI, os.path.join(OUT, "boyi_badge_512.png"), size=512)
make_badge(BOYI, os.path.join(OUT, "boyi_badge_blur.png"), size=1024, blur=30)

print("\n输出目录：", OUT)
